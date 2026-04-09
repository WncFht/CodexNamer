import { type ChildProcessByStdio, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

export type DaemonLogEntry = {
  at: string;
  stream: "stdout" | "stderr";
  line: string;
};

export type DaemonControllerStatus = {
  running: boolean;
  pid?: number;
  startedAt?: string;
  stoppedAt?: string;
  intervalSeconds?: number;
  nextSweepAt?: string;
  apiProcessId: number;
  command: {
    cwd: string;
    executable: string;
    scriptPath: string;
    args: string[];
  };
  recentLogs: DaemonLogEntry[];
  lastExitCode?: number;
  lastExitSignal?: string;
  lastError?: string;
};

type DaemonControllerOptions = {
  defaultIntervalSeconds: () => number;
};

const MAX_LOG_LINES = 160;
const STOP_TIMEOUT_MS = 5_000;

function resolveRepoRoot(): string {
  return path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
}

function resolveDaemonScriptPath(): string {
  return path.resolve(fileURLToPath(new URL("../../daemon/dist/index.js", import.meta.url)));
}

export class DaemonProcessController {
  private child?: ChildProcessByStdio<null, Readable, Readable>;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private recentLogs: DaemonLogEntry[] = [];
  private startedAt?: string;
  private stoppedAt?: string;
  private intervalSeconds?: number;
  private lastExitCode?: number;
  private lastExitSignal?: string;
  private lastError?: string;
  private readonly repoRoot = resolveRepoRoot();
  private readonly scriptPath = resolveDaemonScriptPath();

  constructor(private readonly options: DaemonControllerOptions) {}

  getStatus(): DaemonControllerStatus {
    return {
      running: Boolean(this.child && !this.child.killed),
      pid: this.child?.pid,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      intervalSeconds: this.intervalSeconds,
      nextSweepAt: this.computeNextSweepAt(),
      apiProcessId: process.pid,
      command: {
        cwd: this.repoRoot,
        executable: process.execPath,
        scriptPath: this.scriptPath,
        args: this.intervalSeconds ? ["--interval", String(this.intervalSeconds)] : []
      },
      recentLogs: [...this.recentLogs],
      lastExitCode: this.lastExitCode,
      lastExitSignal: this.lastExitSignal,
      lastError: this.lastError
    };
  }

  async start(intervalSeconds?: number): Promise<DaemonControllerStatus> {
    if (this.child && !this.child.killed) {
      return this.getStatus();
    }

    if (!existsSync(this.scriptPath)) {
      throw new Error(`Daemon script not found: ${this.scriptPath}. Build runtime packages before starting it.`);
    }

    const resolvedInterval = Number.isFinite(intervalSeconds)
      ? Math.max(1, Math.trunc(intervalSeconds as number))
      : Math.max(1, Math.trunc(this.options.defaultIntervalSeconds()));
    const args = [this.scriptPath, "--interval", String(resolvedInterval)];
    const child = spawn(process.execPath, args, {
      cwd: this.repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    this.child = child;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.startedAt = new Date().toISOString();
    this.stoppedAt = undefined;
    this.intervalSeconds = resolvedInterval;
    this.lastExitCode = undefined;
    this.lastExitSignal = undefined;
    this.lastError = undefined;
    this.pushLog("stdout", `[controller] spawned daemon pid=${child.pid ?? "unknown"} interval=${resolvedInterval}s`);

    child.stdout.on("data", (chunk: Buffer | string) => {
      this.stdoutBuffer = this.consumeStream("stdout", this.stdoutBuffer, chunk);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      this.stderrBuffer = this.consumeStream("stderr", this.stderrBuffer, chunk);
    });
    child.on("error", (error) => {
      this.lastError = error.message;
      this.pushLog("stderr", `[controller] spawn error: ${error.message}`);
    });
    child.on("exit", (code, signal) => {
      this.flushPendingLines();
      this.lastExitCode = code === null ? undefined : code;
      this.lastExitSignal = signal === null ? undefined : signal;
      this.stoppedAt = new Date().toISOString();
      this.pushLog(
        code === 0 ? "stdout" : "stderr",
        `[controller] daemon exited code=${code ?? "null"} signal=${signal ?? "null"}`
      );
      this.child = undefined;
    });

    return this.getStatus();
  }

  async stop(): Promise<DaemonControllerStatus> {
    const child = this.child;
    if (!child || child.killed) {
      return this.getStatus();
    }

    this.pushLog("stdout", `[controller] stopping daemon pid=${child.pid ?? "unknown"}`);
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      const timeout = setTimeout(() => {
        if (this.child === child) {
          child.kill("SIGKILL");
        }
        finish();
      }, STOP_TIMEOUT_MS);

      child.once("exit", () => {
        clearTimeout(timeout);
        finish();
      });

      child.kill("SIGTERM");
    });

    return this.getStatus();
  }

  async dispose(): Promise<void> {
    await this.stop();
  }

  private consumeStream(stream: "stdout" | "stderr", buffer: string, chunk: Buffer | string): string {
    const text = `${buffer}${typeof chunk === "string" ? chunk : chunk.toString("utf8")}`;
    const lines = text.split(/\r?\n/);
    const remainder = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (trimmed) {
        this.pushLog(stream, trimmed);
      }
    }
    return remainder;
  }

  private flushPendingLines(): void {
    const stdout = this.stdoutBuffer.trim();
    const stderr = this.stderrBuffer.trim();
    if (stdout) {
      this.pushLog("stdout", stdout);
    }
    if (stderr) {
      this.pushLog("stderr", stderr);
    }
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
  }

  private pushLog(stream: "stdout" | "stderr", line: string): void {
    this.recentLogs.push({
      at: new Date().toISOString(),
      stream,
      line
    });
    if (this.recentLogs.length > MAX_LOG_LINES) {
      this.recentLogs.splice(0, this.recentLogs.length - MAX_LOG_LINES);
    }
  }

  private computeNextSweepAt(): string | undefined {
    if (!this.child || this.child.killed || !this.startedAt || !this.intervalSeconds) {
      return undefined;
    }

    const startedAtMs = Date.parse(this.startedAt);
    if (!Number.isFinite(startedAtMs)) {
      return undefined;
    }

    const intervalMs = Math.max(1, Math.trunc(this.intervalSeconds)) * 1000;
    const elapsedMs = Math.max(0, Date.now() - startedAtMs);
    const nextTickIndex = Math.floor(elapsedMs / intervalMs) + 1;
    return new Date(startedAtMs + nextTickIndex * intervalMs).toISOString();
  }
}
