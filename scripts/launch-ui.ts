import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

type UiMode = "web" | "tui";
type ManagedProcessKind = "launcher-web" | "web" | "api";
type ProcessSnapshot = {
  pid: number;
  cwd?: string;
  cmdline: string[];
};
type ManagedProcessSnapshot = ProcessSnapshot & {
  kind: ManagedProcessKind;
};

const DEFAULT_API_HOST = "127.0.0.1";
const DEFAULT_API_PORT = 42110;
const DEFAULT_WEB_PORT = 43110;
const PORT_SCAN_WINDOW = 20;

function parseArgs(argv: string[]): {
  mode: UiMode;
  passthrough: string[];
  explicitApiBase?: string;
} {
  const [modeArg, ...rest] = argv;
  if (modeArg !== "web" && modeArg !== "tui") {
    throw new Error(`Usage: tsx scripts/launch-ui.ts <web|tui> [-- <args...>]`);
  }

  const explicitFlag = rest.find((value) => value.startsWith("--api-base="));
  const apiBaseFromFlag = explicitFlag ? explicitFlag.slice("--api-base=".length) : undefined;
  const apiBaseIndex = rest.findIndex((value) => value === "--api-base");
  const apiBase =
    apiBaseFromFlag ??
    (apiBaseIndex >= 0 ? rest[apiBaseIndex + 1] : undefined) ??
    process.env.CODEXNAMER_API_BASE;

  return {
    mode: modeArg,
    passthrough: rest,
    explicitApiBase: apiBase,
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function isApiHealthy(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_500);
    const response = await fetch(new URL("/api/v1/health", baseUrl), {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

async function readApiCwd(baseUrl: string): Promise<string | undefined> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_500);
    const response = await fetch(new URL("/api/v1/config", baseUrl), {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);
    if (!response.ok) {
      return undefined;
    }
    const payload = (await response.json()) as {
      paths?: {
        cwd?: string;
      };
    };
    return typeof payload.paths?.cwd === "string" ? path.resolve(payload.paths.cwd) : undefined;
  } catch {
    return undefined;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function detectSiblingRepoPath(repoCwd: string): string | undefined {
  const normalizedRepo = path.resolve(repoCwd);
  const repoName = path.basename(normalizedRepo);
  const parentName = path.basename(path.dirname(normalizedRepo));
  if (parentName !== "ai-tools") {
    return undefined;
  }

  const siblingPath = path.resolve(normalizedRepo, "..", "..", repoName);
  return siblingPath === normalizedRepo ? undefined : siblingPath;
}

async function canListen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function spawnChild(
  command: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
): ChildProcess {
  return spawn(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(options?.env ?? {}),
    },
  });
}

function normalizeProcessArg(value: string): string {
  return value.replace(/\\/g, "/");
}

function matchesCommandPath(value: string, targetPath: string): boolean {
  const normalized = normalizeProcessArg(value);
  return normalized === targetPath || normalized.endsWith(`/${targetPath}`);
}

function isLauncherCommand(cmdline: string[], mode: UiMode): boolean {
  return (
    cmdline.some((value) => matchesCommandPath(value, "scripts/launch-ui.ts")) &&
    cmdline.includes(mode)
  );
}

function isApiCommand(cmdline: string[]): boolean {
  return cmdline.some(
    (value) =>
      matchesCommandPath(value, "packages/api/src/index.ts") ||
      matchesCommandPath(value, "packages/api/dist/index.js"),
  );
}

function isWebDevCommand(cmdline: string[]): boolean {
  const normalized = cmdline.map((value) => normalizeProcessArg(value));
  const referencesVite = normalized.some(
    (value) =>
      value === "vite" || value.endsWith("/vite/bin/vite.js") || value.endsWith("/.bin/vite"),
  );
  return referencesVite && !normalized.includes("build") && !normalized.includes("preview");
}

function isRepoOwnedProcess(processCwd: string | undefined, repoCwd: string): boolean {
  if (!processCwd) {
    return false;
  }

  const resolvedProcessCwd = path.resolve(processCwd);
  const resolvedRepoCwd = path.resolve(repoCwd);
  return (
    resolvedProcessCwd === resolvedRepoCwd ||
    resolvedProcessCwd.startsWith(`${resolvedRepoCwd}${path.sep}`)
  );
}

export function classifyManagedProcess(
  snapshot: Pick<ProcessSnapshot, "cwd" | "cmdline">,
  repoCwd: string,
  mode: UiMode,
): ManagedProcessKind | undefined {
  if (!isRepoOwnedProcess(snapshot.cwd, repoCwd)) {
    return undefined;
  }

  if (mode === "web" && isLauncherCommand(snapshot.cmdline, "web")) {
    return "launcher-web";
  }
  if (mode === "web" && isApiCommand(snapshot.cmdline)) {
    return "api";
  }
  if (mode === "web" && isWebDevCommand(snapshot.cmdline)) {
    return "web";
  }

  return undefined;
}

async function listProcPids(): Promise<number[]> {
  if (process.platform !== "linux") {
    return [];
  }

  try {
    const entries = await fs.readdir("/proc", {
      withFileTypes: true,
    });
    return entries
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => Number(entry.name))
      .filter((value) => Number.isInteger(value));
  } catch {
    return [];
  }
}

async function readProcessSnapshot(pid: number): Promise<ProcessSnapshot | undefined> {
  try {
    const [cmdlineRaw, cwd] = await Promise.all([
      fs.readFile(`/proc/${pid}/cmdline`, "utf8"),
      fs.readlink(`/proc/${pid}/cwd`).catch(() => undefined),
    ]);
    const cmdline = cmdlineRaw
      .split("\0")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    return {
      pid,
      cwd,
      cmdline,
    };
  } catch {
    return undefined;
  }
}

async function readParentPid(pid: number): Promise<number | undefined> {
  try {
    const status = await fs.readFile(`/proc/${pid}/status`, "utf8");
    const match = status.match(/^PPid:\s+(\d+)$/m);
    return match ? Number(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

async function collectProtectedProcessIds(startPid: number): Promise<Set<number>> {
  const protectedPids = new Set<number>();
  let currentPid: number | undefined = startPid;

  while (currentPid && currentPid > 1 && !protectedPids.has(currentPid)) {
    protectedPids.add(currentPid);
    currentPid = await readParentPid(currentPid);
  }

  return protectedPids;
}

async function findManagedProcesses(
  mode: UiMode,
  repoCwd: string,
  options?: {
    protectedPids?: Set<number>;
  },
): Promise<ManagedProcessSnapshot[]> {
  const pids = await listProcPids();
  const matches: ManagedProcessSnapshot[] = [];

  for (const pid of pids) {
    if (options?.protectedPids?.has(pid)) {
      continue;
    }

    const snapshot = await readProcessSnapshot(pid);
    if (!snapshot) {
      continue;
    }

    const kind = classifyManagedProcess(snapshot, repoCwd, mode);
    if (!kind) {
      continue;
    }

    matches.push({
      ...snapshot,
      kind,
    });
  }

  return matches;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminateProcesses(processes: ManagedProcessSnapshot[]): Promise<void> {
  const unique = new Map<number, ManagedProcessSnapshot>();
  for (const processInfo of processes) {
    if (!unique.has(processInfo.pid)) {
      unique.set(processInfo.pid, processInfo);
    }
  }

  if (unique.size === 0) {
    return;
  }

  for (const processInfo of unique.values()) {
    console.error(`[codexnamer] Closing stale ${processInfo.kind} process pid=${processInfo.pid}`);
    try {
      process.kill(processInfo.pid, "SIGTERM");
    } catch {
      // Process exited between discovery and termination.
    }
  }

  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const alive = Array.from(unique.keys()).filter((pid) => isProcessAlive(pid));
    if (alive.length === 0) {
      return;
    }
    await delay(200);
  }

  for (const processInfo of unique.values()) {
    if (!isProcessAlive(processInfo.pid)) {
      continue;
    }
    console.error(
      `[codexnamer] Force killing stale ${processInfo.kind} process pid=${processInfo.pid}`,
    );
    try {
      process.kill(processInfo.pid, "SIGKILL");
    } catch {
      // Process already exited.
    }
  }
}

async function cleanupStaleManagedProcesses(mode: UiMode, explicitApiBase?: string): Promise<void> {
  if (mode !== "web") {
    return;
  }

  const repoCwd = process.cwd();
  const protectedPids = await collectProtectedProcessIds(process.pid);
  const matches = await findManagedProcesses(mode, repoCwd, {
    protectedPids,
  });
  const filtered = matches.filter(
    (processInfo) => !(explicitApiBase && processInfo.kind === "api"),
  );

  if (filtered.length === 0) {
    return;
  }

  await terminateProcesses(filtered);
}

async function startApi(host: string, port: number): Promise<ChildProcess> {
  const child = spawnChild(npmCommand(), [
    "run",
    "api",
    "--",
    "--host",
    host,
    "--port",
    String(port),
  ]);

  const startDeadline = Date.now() + 20_000;
  const baseUrl = `http://${host}:${port}`;
  while (Date.now() < startDeadline) {
    if (child.exitCode !== null) {
      throw new Error(`API exited before becoming healthy on ${baseUrl}.`);
    }
    if (await isApiHealthy(baseUrl)) {
      return child;
    }
    await delay(500);
  }

  child.kill("SIGTERM");
  throw new Error(`Timed out waiting for API to become healthy on ${baseUrl}.`);
}

async function ensureApi(baseUrlOverride?: string): Promise<{
  baseUrl: string;
  child?: ChildProcess;
  reused: boolean;
}> {
  const expectedCwd = process.cwd();

  if (baseUrlOverride) {
    if (await isApiHealthy(baseUrlOverride)) {
      return {
        baseUrl: baseUrlOverride,
        reused: true,
      };
    }
    throw new Error(`Configured API base is not healthy: ${baseUrlOverride}`);
  }

  for (let offset = 0; offset <= PORT_SCAN_WINDOW; offset += 1) {
    const port = DEFAULT_API_PORT + offset;
    const baseUrl = `http://${DEFAULT_API_HOST}:${port}`;
    if (await isApiHealthy(baseUrl)) {
      const apiCwd = await readApiCwd(baseUrl);
      if (apiCwd && apiCwd === path.resolve(expectedCwd)) {
        return {
          baseUrl,
          reused: true,
        };
      }
      console.error(
        `[codexnamer] Skipping healthy API at ${baseUrl} because it is bound to ${apiCwd ?? "<unknown cwd>"}.`,
      );
    }

    if (await canListen(DEFAULT_API_HOST, port)) {
      try {
        const child = await startApi(DEFAULT_API_HOST, port);
        return {
          baseUrl,
          child,
          reused: false,
        };
      } catch {
        if (await isApiHealthy(baseUrl)) {
          return {
            baseUrl,
            reused: true,
          };
        }
      }
    }
  }

  throw new Error(
    `Unable to find a usable API port in ${DEFAULT_API_PORT}-${DEFAULT_API_PORT + PORT_SCAN_WINDOW}.`,
  );
}

function withApiBaseArgs(mode: UiMode, passthrough: string[], apiBase: string): string[] {
  if (mode === "tui") {
    const hasExplicitApiBase = passthrough.some(
      (value, index) =>
        value.startsWith("--api-base=") ||
        (value === "--api-base" && typeof passthrough[index + 1] === "string"),
    );
    return hasExplicitApiBase ? passthrough : [...passthrough, "--api-base", apiBase];
  }
  return passthrough;
}

async function main(): Promise<void> {
  const { mode, passthrough, explicitApiBase } = parseArgs(process.argv.slice(2));
  const repoCwd = process.cwd();
  const webPort = process.env.CODEXNAMER_WEB_PORT ?? String(DEFAULT_WEB_PORT);
  const siblingRepoPath = detectSiblingRepoPath(repoCwd);
  console.error(`[codexnamer] Launch mode: ${mode}`);
  console.error(`[codexnamer] Repo cwd: ${repoCwd}`);
  if (mode === "web") {
    console.error(`[codexnamer] Requested web URL: http://127.0.0.1:${webPort}/`);
  }
  if (siblingRepoPath && (await pathExists(siblingRepoPath))) {
    console.error(`[codexnamer] Another same-name repo exists at: ${siblingRepoPath}`);
  }
  await cleanupStaleManagedProcesses(mode, explicitApiBase);
  const api = await ensureApi(explicitApiBase);

  const child = spawnChild(
    npmCommand(),
    mode === "web"
      ? ["run", "web:raw", "--", ...withApiBaseArgs(mode, passthrough, api.baseUrl)]
      : ["run", "tui:raw", "--", ...withApiBaseArgs(mode, passthrough, api.baseUrl)],
    {
      env:
        mode === "web"
          ? {
              CODEXNAMER_API_BASE: api.baseUrl,
              CODEXNAMER_WEB_PORT: process.env.CODEXNAMER_WEB_PORT ?? String(DEFAULT_WEB_PORT),
            }
          : {
              CODEXNAMER_API_BASE: api.baseUrl,
            },
    },
  );

  if (api.reused) {
    console.error(`[codexnamer] Reusing API at ${api.baseUrl} for repo ${repoCwd}`);
  } else {
    console.error(`[codexnamer] Started API at ${api.baseUrl} for repo ${repoCwd}`);
  }
  if (mode === "web") {
    console.error(
      `[codexnamer] Launching web dev server on http://127.0.0.1:${webPort}/ via API ${api.baseUrl}`,
    );
  }

  const terminate = (signal: NodeJS.Signals) => {
    child.kill(signal);
    if (api.child) {
      api.child.kill(signal);
    }
  };

  process.on("SIGINT", () => terminate("SIGINT"));
  process.on("SIGTERM", () => terminate("SIGTERM"));

  child.on("exit", (code, signal) => {
    if (api.child) {
      api.child.kill("SIGTERM");
    }
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  void main().catch((error) => {
    console.error(`[codexnamer] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
