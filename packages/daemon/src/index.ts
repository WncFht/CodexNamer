#!/usr/bin/env node

import path from "node:path";

import chokidar from "chokidar";

import { CodexSessionManager } from "@codex-session-manager/core";

function parseArgs(argv: string[]): { once: boolean; intervalSeconds: number } {
  const once = argv.includes("--once");
  const intervalIndex = argv.indexOf("--interval");
  const intervalSeconds =
    intervalIndex >= 0 && argv[intervalIndex + 1]
      ? Number(argv[intervalIndex + 1])
      : 300;

  return {
    once,
    intervalSeconds: Number.isFinite(intervalSeconds) ? intervalSeconds : 300
  };
}

export class SessionSweepDaemon {
  private timer?: NodeJS.Timeout;
  private pendingTimer?: NodeJS.Timeout;

  constructor(
    private readonly manager: CodexSessionManager,
    private readonly intervalSeconds: number
  ) {}

  async runOnce(): Promise<void> {
    const sweep = await this.manager.runAutoRenameSweep({
      intervalSeconds: this.intervalSeconds,
      processId: process.pid
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
      execution: this.manager.config.rename.autoApply === "idle-finalize" ? "auto-apply" : "preview-only"
    };
    console.log(JSON.stringify({ type: "daemon_sweep", summary, previews, applied: sweep.applied }, null, 2));
  }

  private scheduleSoon(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
    }

    this.pendingTimer = setTimeout(() => {
      void this.runOnce();
    }, 1000);
  }

  async start(): Promise<void> {
    await this.runOnce();

    const codexHome = this.manager.config.general.codexHome;
    const watcher = chokidar.watch(
      [
        path.join(codexHome, "sessions", "**", "*.jsonl"),
        path.join(codexHome, "session_index.jsonl")
      ],
      {
        ignoreInitial: true
      }
    );

    watcher.on("add", () => this.scheduleSoon());
    watcher.on("change", () => this.scheduleSoon());

    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalSeconds * 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manager = await CodexSessionManager.create({ operator: "daemon" });
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
}

void main();
