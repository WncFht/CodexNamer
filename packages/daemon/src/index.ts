#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { CodexNamer } from "@codexnamer/core";
import chokidar, { type FSWatcher } from "chokidar";

function parseArgs(argv: string[]): { once: boolean; intervalSeconds: number } {
  const once = argv.includes("--once");
  const intervalIndex = argv.indexOf("--interval");
  const intervalSeconds =
    intervalIndex >= 0 && argv[intervalIndex + 1] ? Number(argv[intervalIndex + 1]) : 300;

  return {
    once,
    intervalSeconds: Number.isFinite(intervalSeconds) ? intervalSeconds : 300,
  };
}

export class SessionSweepDaemon {
  private timer?: NodeJS.Timeout;
  private pendingTimer?: NodeJS.Timeout;
  private watcher?: FSWatcher;
  private activeSweep?: Promise<void>;
  private sweepRunning = false;
  private rerunRequested = false;

  constructor(
    private readonly manager: CodexNamer,
    private readonly intervalSeconds: number,
  ) {}

  async runOnce(): Promise<void> {
    const sweep = await this.manager.runAutoRenameSweep({
      intervalSeconds: this.intervalSeconds,
      processId: process.pid,
    });
    const previews = sweep.previews;
    const summary = {
      timestamp: new Date().toISOString(),
      total: previews.length,
      suggest: previews.filter((item) => item.status === "suggest").length,
      apply: previews.filter((item) => item.status === "apply").length,
      skip: previews.filter((item) => item.status === "skip").length,
      autoApplied: sweep.applied.filter((item) => item.written).length,
      unchanged: sweep.applied.filter((item) => !item.written).length,
      execution:
        this.manager.config.rename.autoApply === "idle-finalize" ? "auto-apply" : "preview-only",
    };
    console.log(
      JSON.stringify({ type: "daemon_sweep", summary, previews, applied: sweep.applied }, null, 2),
    );
  }

  private async runManagedSweep(errorLabel: string): Promise<void> {
    const execution = (async () => {
      try {
        await this.runOnce();
      } catch (error) {
        console.error(errorLabel, error);
      }
    })();

    this.activeSweep = execution.finally(() => {
      if (this.activeSweep === execution) {
        this.activeSweep = undefined;
      }
    });

    await this.activeSweep;
  }

  private triggerSweep(): void {
    if (this.sweepRunning) {
      this.rerunRequested = true;
      return;
    }

    this.sweepRunning = true;
    void (async () => {
      try {
        await this.runManagedSweep("[daemon] sweep failed");
      } finally {
        this.sweepRunning = false;
        if (this.rerunRequested) {
          this.rerunRequested = false;
          this.triggerSweep();
        }
      }
    })();
  }

  private scheduleSoon(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
    }

    this.pendingTimer = setTimeout(() => {
      this.triggerSweep();
    }, 1000);
  }

  async start(): Promise<void> {
    await this.runManagedSweep("[daemon] initial sweep failed");

    const codexHome = this.manager.config.general.codexHome;
    this.watcher = chokidar.watch(
      [
        path.join(codexHome, "sessions", "**", "*.jsonl"),
        path.join(codexHome, "session_index.jsonl"),
      ],
      {
        ignoreInitial: true,
      },
    );

    this.watcher.on("add", () => this.scheduleSoon());
    this.watcher.on("change", () => this.scheduleSoon());

    this.timer = setInterval(() => {
      this.triggerSweep();
    }, this.intervalSeconds * 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = undefined;
    }

    this.rerunRequested = false;

    if (this.watcher) {
      const activeWatcher = this.watcher;
      this.watcher = undefined;
      await activeWatcher.close();
    }

    if (this.activeSweep) {
      await this.activeSweep;
    }
  }
}

async function waitForShutdown(daemon: SessionSweepDaemon, manager: CodexNamer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let closing = false;
    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
    const handlers = new Map<NodeJS.Signals, () => void>();

    const cleanup = () => {
      for (const [signal, handler] of handlers) {
        process.off(signal, handler);
      }
      handlers.clear();
    };

    const close = async () => {
      if (closing) {
        return;
      }
      closing = true;
      cleanup();
      try {
        await daemon.stop();
        await manager.close();
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    for (const signal of signals) {
      const handler = () => {
        void close();
      };
      handlers.set(signal, handler);
      process.on(signal, handler);
    }
  });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manager = await CodexNamer.create({ operator: "daemon" });
  const daemon = new SessionSweepDaemon(manager, args.intervalSeconds);

  if (args.once) {
    try {
      await daemon.runOnce();
    } finally {
      await manager.close();
    }
    return;
  }

  await daemon.start();
  await waitForShutdown(daemon, manager);
}

if (isMainModule()) {
  void main().catch((error) => {
    console.error(`[daemon] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
