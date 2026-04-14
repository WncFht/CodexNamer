import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startApiServer, waitForShutdown } from "@codexnamer/api";
import { loadEffectiveConfig, resolveConfigPaths } from "@codexnamer/core";
import type { ListeningPortOwner } from "./port-owner.js";
import { inspectListeningPortOwner } from "./port-owner.js";

const SERVICE_CONFIG_FILENAME = "service-config.json";
const POSIX_LAUNCHER_FILENAME = "run-service.sh";
const WINDOWS_LAUNCHER_FILENAME = "run-service.ps1";
const LINUX_UNIT_NAME = "codexnamer.service";
const MAC_LABEL = "dev.codexnamer.agent";
const WINDOWS_TASK_NAME = "CodexNamer";

export type ManagedServicePlatform = "linux" | "macos" | "windows";

export type ServiceCommandOptions = {
  cwd?: string;
  configPath?: string;
  host?: string;
  port?: string | number;
  webRoot?: string;
  daemon?: boolean;
  start?: boolean;
};

export type ManagedServiceRuntimeConfig = {
  version: 1;
  platform: ManagedServicePlatform;
  installedAt: string;
  cwd: string;
  configPath?: string;
  stateDir: string;
  host: string;
  port: number;
  webRoot: string;
  autoStartDaemon: boolean;
  url: string;
};

export type ManagedServicePaths = {
  serviceDir: string;
  serviceConfigPath: string;
  shellLauncherPath: string;
  powerShellLauncherPath: string;
  logsDir: string;
  stdoutLogPath: string;
  stderrLogPath: string;
  linuxUnitPath: string;
  macPlistPath: string;
};

export type ManagedServiceRuntimeBundlePaths = {
  runtimeDir: string;
  nodeModulesDir: string;
  cliEntryPath: string;
  webRoot: string;
};

export type ManagedServiceDescriptor = {
  descriptorPath: string;
  descriptorText: string;
  shellLauncherText: string;
  powerShellLauncherText: string;
};

type CommandResult = {
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  ok: boolean;
  error?: string;
};

type InstalledService = {
  runtime: ManagedServiceRuntimeConfig;
  paths: ManagedServicePaths;
};

export type ManagedServiceHealth = {
  healthy: boolean;
  statusCode?: number;
  error?: string;
};

export type CommandStatusSummary = {
  loaded?: boolean;
  running?: boolean;
  state?: string;
  pid?: number;
  lastExitCode?: number;
  active?: string;
  status?: string;
};

export type ManagedServiceCommandStatus = {
  command: string;
  args: string[];
  exitCode: number | null;
  ok: boolean;
  error?: string;
};

export type ManagedServiceLogTail = {
  stdout?: string[];
  stderr?: string[];
};

export type ManagedServiceInstallResult = {
  installed: true;
  platform: ManagedServicePlatform;
  url: string;
  configPath: string;
  shellLauncherPath: string;
  powerShellLauncherPath: string;
  descriptorPath: string;
  autoStartDaemon: boolean;
  started: boolean;
  health?: ManagedServiceHealth;
};

export type ManagedServiceActionResult = {
  started?: boolean;
  stopped?: boolean;
  restarted?: boolean;
  removed?: boolean;
  alreadyRunning?: boolean;
  reason?: string;
  platform?: ManagedServicePlatform;
  url?: string;
  health?: ManagedServiceHealth;
};

export type ManagedServiceLifecyclePhase = "install" | "start" | "restart";

export type ManagedServiceCommandFailure = {
  kind: "port-in-use" | "start-failed";
  phase: ManagedServiceLifecyclePhase;
  runtime: ManagedServiceRuntimeConfig;
  health?: ManagedServiceHealth;
  commandStatus?: ManagedServiceCommandStatus;
  platformStatus?: CommandStatusSummary;
  portOwner?: ListeningPortOwner;
  logTail?: ManagedServiceLogTail;
};

export class ManagedServiceCommandError extends Error {
  constructor(
    message: string,
    public readonly failure: ManagedServiceCommandFailure,
  ) {
    super(message);
    this.name = "ManagedServiceCommandError";
  }
}

export function isManagedServiceCommandError(error: unknown): error is ManagedServiceCommandError {
  return error instanceof ManagedServiceCommandError;
}

export type ManagedServiceStatusResult =
  | {
      installed: false;
      serviceName: string;
    }
  | {
      installed: true;
      platform: ManagedServicePlatform;
      serviceName: string;
      url: string;
      configPath: string;
      logs: {
        stdout: string;
        stderr: string;
      };
      runtime: ManagedServiceRuntimeConfig;
      commandStatus: ManagedServiceCommandStatus;
      platformStatus: CommandStatusSummary;
      health: ManagedServiceHealth;
      portOwner?: ListeningPortOwner;
      logTail?: ManagedServiceLogTail;
    };

function resolveCurrentBundledWebRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
}

function resolveSourceNodeModulesRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../node_modules");
}

function quoteForPosixShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function resolvePort(portValue: string | number | undefined, fallback: number): number {
  if (typeof portValue === "number" && Number.isFinite(portValue)) {
    return portValue;
  }
  if (typeof portValue === "string" && portValue.length > 0) {
    const parsed = Number(portValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function resolveServeWebRoot(explicitWebRoot?: string): string | undefined {
  if (explicitWebRoot) {
    const resolved = path.resolve(explicitWebRoot);
    return existsSync(path.join(resolved, "index.html")) ? resolved : undefined;
  }

  const bundledRoot = resolveCurrentBundledWebRoot();
  return existsSync(path.join(bundledRoot, "index.html")) ? bundledRoot : undefined;
}

function assertSupportedMacLaunchAgentInvocation(): void {
  if (process.platform !== "darwin") {
    return;
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (uid !== 0) {
    return;
  }
  throw new Error(
    "macOS LaunchAgent commands must be run as the logged-in user, not with sudo. Re-run the same `npm run cli -- service ...` command without sudo.",
  );
}

function runCommand(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exitCode = typeof result.status === "number" ? result.status : null;
  return {
    command,
    args,
    exitCode,
    stdout,
    stderr,
    ok: !result.error && exitCode === 0,
    error: result.error?.message,
  };
}

function assertCommandOk(result: CommandResult, context: string): void {
  if (result.ok) {
    return;
  }
  const detail = result.error ?? result.stderr.trim() ?? result.stdout.trim() ?? "unknown error";
  throw new Error(`${context} failed: ${detail}`);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function plistEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(`"`, "&quot;")
    .replaceAll("'", "&apos;");
}

export function resolveManagedServicePlatform(
  platform: NodeJS.Platform = process.platform,
): ManagedServicePlatform {
  switch (platform) {
    case "linux":
      return "linux";
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      throw new Error(`Unsupported platform for managed service install: ${platform}`);
  }
}

export function resolveManagedServicePaths(params: {
  stateDir: string;
  homeDir?: string;
}): ManagedServicePaths {
  const homeDir = params.homeDir ?? os.homedir();
  const serviceDir = path.join(params.stateDir, "service");
  const logsDir = path.join(serviceDir, "logs");
  return {
    serviceDir,
    serviceConfigPath: path.join(serviceDir, SERVICE_CONFIG_FILENAME),
    shellLauncherPath: path.join(serviceDir, POSIX_LAUNCHER_FILENAME),
    powerShellLauncherPath: path.join(serviceDir, WINDOWS_LAUNCHER_FILENAME),
    logsDir,
    stdoutLogPath: path.join(logsDir, "service.stdout.log"),
    stderrLogPath: path.join(logsDir, "service.stderr.log"),
    linuxUnitPath: path.join(homeDir, ".config", "systemd", "user", LINUX_UNIT_NAME),
    macPlistPath: path.join(homeDir, "Library", "LaunchAgents", `${MAC_LABEL}.plist`),
  };
}

export function resolveManagedServiceRuntimeBundlePaths(
  paths: ManagedServicePaths,
): ManagedServiceRuntimeBundlePaths {
  const runtimeDir = path.join(paths.serviceDir, "runtime");
  const nodeModulesDir = path.join(runtimeDir, "node_modules");
  return {
    runtimeDir,
    nodeModulesDir,
    cliEntryPath: path.join(nodeModulesDir, "@codexnamer", "cli", "dist", "index.js"),
    webRoot: path.join(runtimeDir, "web-dist"),
  };
}

export function buildManagedServiceDescriptor(params: {
  platform: ManagedServicePlatform;
  runtime: ManagedServiceRuntimeConfig;
  paths: ManagedServicePaths;
  cliEntryPath: string;
  nodePath: string;
}): ManagedServiceDescriptor {
  const shellLauncherText =
    [
      "#!/usr/bin/env sh",
      "set -eu",
      `mkdir -p ${quoteForPosixShell(params.paths.logsDir)}`,
      `cd ${quoteForPosixShell(params.paths.serviceDir)}`,
      `exec ${quoteForPosixShell(params.nodePath)} ${quoteForPosixShell(params.cliEntryPath)} service-host --config ${quoteForPosixShell(params.paths.serviceConfigPath)}`,
    ].join("\n") + "\n";

  const powerShellLauncherText =
    [
      "$ErrorActionPreference = 'Stop'",
      `New-Item -ItemType Directory -Force -Path ${quoteForPowerShell(params.paths.logsDir)} | Out-Null`,
      `Set-Location -LiteralPath ${quoteForPowerShell(params.paths.serviceDir)}`,
      `& ${quoteForPowerShell(params.nodePath)} ${quoteForPowerShell(params.cliEntryPath)} service-host --config ${quoteForPowerShell(params.paths.serviceConfigPath)} 1>> ${quoteForPowerShell(params.paths.stdoutLogPath)} 2>> ${quoteForPowerShell(params.paths.stderrLogPath)}`,
      "exit $LASTEXITCODE",
    ].join("\r\n") + "\r\n";

  if (params.platform === "linux") {
    return {
      descriptorPath: params.paths.linuxUnitPath,
      descriptorText:
        [
          "[Unit]",
          "Description=CodexNamer local service",
          "After=default.target",
          "",
          "[Service]",
          "Type=simple",
          `WorkingDirectory=${params.paths.serviceDir}`,
          `ExecStart=/bin/sh ${params.paths.shellLauncherPath}`,
          "Restart=on-failure",
          "RestartSec=5",
          "",
          "[Install]",
          "WantedBy=default.target",
        ].join("\n") + "\n",
      shellLauncherText,
      powerShellLauncherText,
    };
  }

  if (params.platform === "macos") {
    const programArgs = ["/bin/sh", params.paths.shellLauncherPath]
      .map((value) => `    <string>${plistEscape(value)}</string>`)
      .join("\n");
    return {
      descriptorPath: params.paths.macPlistPath,
      descriptorText:
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
          '<plist version="1.0">',
          "<dict>",
          "  <key>Label</key>",
          `  <string>${plistEscape(MAC_LABEL)}</string>`,
          "  <key>ProgramArguments</key>",
          "  <array>",
          programArgs,
          "  </array>",
          "  <key>RunAtLoad</key>",
          "  <true/>",
          "  <key>KeepAlive</key>",
          "  <true/>",
          "  <key>WorkingDirectory</key>",
          `  <string>${plistEscape(params.paths.serviceDir)}</string>`,
          "  <key>StandardOutPath</key>",
          `  <string>${plistEscape(params.paths.stdoutLogPath)}</string>`,
          "  <key>StandardErrorPath</key>",
          `  <string>${plistEscape(params.paths.stderrLogPath)}</string>`,
          "</dict>",
          "</plist>",
        ].join("\n") + "\n",
      shellLauncherText,
      powerShellLauncherText,
    };
  }

  return {
    descriptorPath: WINDOWS_TASK_NAME,
    descriptorText: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${params.paths.powerShellLauncherPath}"`,
    shellLauncherText,
    powerShellLauncherText,
  };
}

async function buildInstallContext(options?: ServiceCommandOptions): Promise<{
  platform: ManagedServicePlatform;
  runtime: ManagedServiceRuntimeConfig;
  paths: ManagedServicePaths;
  descriptor: ManagedServiceDescriptor;
  runtimeBundlePaths: ManagedServiceRuntimeBundlePaths;
  sourceWebRoot: string;
}> {
  const configPaths = await resolveConfigPaths({
    cwd: os.homedir(),
    configPath: options?.configPath,
  });
  const effective = await loadEffectiveConfig({
    cwd: configPaths.cwd,
    configPath: configPaths.userConfigPath,
  });
  const platform = resolveManagedServicePlatform();
  if (platform === "macos") {
    assertSupportedMacLaunchAgentInvocation();
  }
  const sourceWebRoot = resolveServeWebRoot(options?.webRoot);
  if (!sourceWebRoot) {
    throw new Error(
      "No built Web UI found. Run `npm run web:build` first or pass `--web-root <path>` with a directory containing index.html.",
    );
  }

  const paths = resolveManagedServicePaths({
    stateDir: effective.general.stateDir,
  });
  const runtimeBundlePaths = resolveManagedServiceRuntimeBundlePaths(paths);
  const runtime: ManagedServiceRuntimeConfig = {
    version: 1,
    platform,
    installedAt: new Date().toISOString(),
    cwd: configPaths.cwd,
    configPath: configPaths.userConfigPath,
    stateDir: effective.general.stateDir,
    host: options?.host ?? "127.0.0.1",
    port: resolvePort(options?.port, 42110),
    webRoot: runtimeBundlePaths.webRoot,
    autoStartDaemon: options?.daemon !== false,
    url: `http://${options?.host ?? "127.0.0.1"}:${resolvePort(options?.port, 42110)}`,
  };
  const descriptor = buildManagedServiceDescriptor({
    platform,
    runtime,
    paths,
    cliEntryPath: runtimeBundlePaths.cliEntryPath,
    nodePath: process.execPath,
  });

  return {
    platform,
    runtime,
    paths,
    descriptor,
    runtimeBundlePaths,
    sourceWebRoot,
  };
}

async function writeInstallArtifacts(context: {
  runtime: ManagedServiceRuntimeConfig;
  paths: ManagedServicePaths;
  descriptor: ManagedServiceDescriptor;
  runtimeBundlePaths: ManagedServiceRuntimeBundlePaths;
  sourceWebRoot: string;
}): Promise<void> {
  await fs.mkdir(context.paths.serviceDir, { recursive: true });
  await fs.mkdir(context.paths.logsDir, { recursive: true });
  await fs.rm(context.runtimeBundlePaths.runtimeDir, { recursive: true, force: true });
  await fs.mkdir(context.runtimeBundlePaths.runtimeDir, { recursive: true });

  const sourceNodeModulesDir = resolveSourceNodeModulesRoot();
  if (!existsSync(sourceNodeModulesDir)) {
    throw new Error(
      `Managed service runtime dependencies were not found at ${sourceNodeModulesDir}. Run \`npm install\` first.`,
    );
  }

  await fs.cp(sourceNodeModulesDir, context.runtimeBundlePaths.nodeModulesDir, {
    recursive: true,
    dereference: true,
  });
  await fs.cp(context.sourceWebRoot, context.runtimeBundlePaths.webRoot, {
    recursive: true,
  });

  await Promise.all([
    fs.writeFile(context.paths.stdoutLogPath, "", "utf8"),
    fs.writeFile(context.paths.stderrLogPath, "", "utf8"),
  ]);
  await fs.writeFile(
    context.paths.serviceConfigPath,
    JSON.stringify(context.runtime, null, 2) + "\n",
    "utf8",
  );
  await fs.writeFile(context.paths.shellLauncherPath, context.descriptor.shellLauncherText, "utf8");
  await fs.chmod(context.paths.shellLauncherPath, 0o755);
  await fs.writeFile(
    context.paths.powerShellLauncherPath,
    context.descriptor.powerShellLauncherText,
    "utf8",
  );

  if (context.runtime.platform === "linux") {
    await fs.mkdir(path.dirname(context.paths.linuxUnitPath), { recursive: true });
    await fs.writeFile(context.paths.linuxUnitPath, context.descriptor.descriptorText, "utf8");
    return;
  }

  if (context.runtime.platform === "macos") {
    await fs.mkdir(path.dirname(context.paths.macPlistPath), { recursive: true });
    await fs.writeFile(context.paths.macPlistPath, context.descriptor.descriptorText, "utf8");
  }
}

async function getServiceConfigCandidates(options?: ServiceCommandOptions): Promise<string[]> {
  assertSupportedMacLaunchAgentInvocation();
  const candidates = new Set<string>();
  const addStateDir = (stateDir: string | undefined) => {
    if (!stateDir) {
      return;
    }
    candidates.add(path.join(stateDir, "service", SERVICE_CONFIG_FILENAME));
  };

  try {
    const config = await loadEffectiveConfig({
      cwd: options?.cwd,
      configPath: options?.configPath,
    });
    addStateDir(config.general.stateDir);
  } catch {
    // ignore config resolution failures; status may still find an existing install
  }

  try {
    const config = await loadEffectiveConfig({
      cwd: os.homedir(),
      configPath: options?.configPath,
    });
    addStateDir(config.general.stateDir);
  } catch {
    // ignore secondary resolution failures
  }

  addStateDir(path.join(os.homedir(), ".local", "state", "codexnamer"));

  return [...candidates];
}

async function loadInstalledService(
  options?: ServiceCommandOptions,
): Promise<InstalledService | undefined> {
  const candidates = await getServiceConfigCandidates(options);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    const runtime = JSON.parse(await fs.readFile(candidate, "utf8")) as ManagedServiceRuntimeConfig;
    const paths = resolveManagedServicePaths({
      stateDir: runtime.stateDir,
    });
    return {
      runtime,
      paths,
    };
  }
  return undefined;
}

function currentLaunchctlDomain(): string {
  assertSupportedMacLaunchAgentInvocation();
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (typeof uid !== "number") {
    throw new Error("launchctl user domain is unavailable on this platform");
  }
  return `gui/${uid}`;
}

function queryPlatformStatus(runtime: ManagedServiceRuntimeConfig): CommandResult {
  if (runtime.platform === "linux") {
    return runCommand("systemctl", ["--user", "status", "--no-pager", LINUX_UNIT_NAME]);
  }
  if (runtime.platform === "macos") {
    return runCommand("launchctl", ["print", `${currentLaunchctlDomain()}/${MAC_LABEL}`]);
  }
  return runCommand("schtasks", ["/Query", "/TN", WINDOWS_TASK_NAME, "/FO", "LIST", "/V"]);
}

async function probeServiceHealth(
  runtime: ManagedServiceRuntimeConfig,
): Promise<ManagedServiceHealth> {
  try {
    const controller = new AbortController();
    const timeoutMs = 1500;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(new URL("/api/v1/health", runtime.url), {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return {
      healthy: response.ok,
      statusCode: response.status,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Health probe timed out after 1500ms."
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      healthy: false,
      error: message,
    };
  }
}

function parseMacLaunchctlSummary(stdout: string): CommandStatusSummary {
  const pidMatch = stdout.match(/\bpid = (\d+)/);
  const stateMatch = stdout.match(/\bstate = ([^\n]+)/);
  const lastExitCodeMatch = stdout.match(/\blast exit code = (\d+)/);
  return {
    loaded: true,
    running: Boolean(pidMatch),
    pid: pidMatch ? Number(pidMatch[1]) : undefined,
    state: stateMatch?.[1]?.trim(),
    lastExitCode: lastExitCodeMatch ? Number(lastExitCodeMatch[1]) : undefined,
  };
}

function parseLinuxSystemctlSummary(stdout: string): CommandStatusSummary {
  const activeMatch = stdout.match(/Active:\s+([^(]+)(?:\s+\(([^)]+)\))?/);
  const pidMatch = stdout.match(/Main PID:\s+(\d+)/);
  return {
    loaded: true,
    running: activeMatch?.[1]?.trim() === "active",
    active: activeMatch?.[1]?.trim(),
    state: activeMatch?.[2]?.trim(),
    pid: pidMatch ? Number(pidMatch[1]) : undefined,
  };
}

function parseWindowsTaskSummary(stdout: string): CommandStatusSummary {
  const statusMatch = stdout.match(/Status:\s+([^\r\n]+)/i);
  return {
    loaded: true,
    running: statusMatch?.[1]?.trim().toLowerCase() === "running",
    status: statusMatch?.[1]?.trim(),
  };
}

export function summarizePlatformStatus(
  runtime: ManagedServiceRuntimeConfig,
  commandStatus: CommandResult,
): CommandStatusSummary {
  if (!commandStatus.ok) {
    return {
      loaded: false,
    };
  }

  if (runtime.platform === "macos") {
    return parseMacLaunchctlSummary(commandStatus.stdout);
  }
  if (runtime.platform === "linux") {
    return parseLinuxSystemctlSummary(commandStatus.stdout);
  }
  return parseWindowsTaskSummary(commandStatus.stdout);
}

async function tailLog(logPath: string, maxLines = 20): Promise<string[]> {
  try {
    const content = await fs.readFile(logPath, "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .slice(-maxLines);
  } catch {
    return [];
  }
}

async function collectManagedServiceDiagnostics(
  installed: InstalledService,
  options?: { includeLogs?: boolean },
): Promise<{
  health: ManagedServiceHealth;
  commandStatus: ManagedServiceCommandStatus;
  platformStatus: CommandStatusSummary;
  portOwner?: ListeningPortOwner;
  logTail?: ManagedServiceLogTail;
}> {
  const [commandStatusResult, health] = await Promise.all([
    Promise.resolve(queryPlatformStatus(installed.runtime)),
    probeServiceHealth(installed.runtime),
  ]);
  const commandStatus: ManagedServiceCommandStatus = {
    command: commandStatusResult.command,
    args: commandStatusResult.args,
    exitCode: commandStatusResult.exitCode,
    ok: commandStatusResult.ok,
    error: commandStatusResult.error,
  };
  const platformStatus = summarizePlatformStatus(installed.runtime, commandStatusResult);
  const portOwner = health.healthy ? undefined : inspectListeningPortOwner(installed.runtime.port);

  if (!options?.includeLogs) {
    return {
      health,
      commandStatus,
      platformStatus,
      portOwner,
    };
  }

  if (health.healthy) {
    return {
      health,
      commandStatus,
      platformStatus,
      portOwner,
    };
  }

  const [stderrTail, stdoutTail] = await Promise.all([
    tailLog(installed.paths.stderrLogPath),
    tailLog(installed.paths.stdoutLogPath),
  ]);
  const logTail =
    stderrTail.length > 0 || stdoutTail.length > 0
      ? {
          ...(stdoutTail.length > 0 ? { stdout: stdoutTail } : {}),
          ...(stderrTail.length > 0 ? { stderr: stderrTail } : {}),
        }
      : undefined;

  return {
    health,
    commandStatus,
    platformStatus,
    portOwner,
    logTail,
  };
}

async function preflightManagedServiceStart(
  installed: InstalledService,
  phase: ManagedServiceLifecyclePhase,
): Promise<ManagedServiceHealth | undefined> {
  const diagnostics = await collectManagedServiceDiagnostics(installed);
  if (diagnostics.health.healthy) {
    return diagnostics.health;
  }

  if (diagnostics.portOwner && diagnostics.platformStatus.running !== true) {
    throw new ManagedServiceCommandError(
      `Cannot ${phase} managed service because ${installed.runtime.url} is already in use.`,
      {
        kind: "port-in-use",
        phase,
        runtime: installed.runtime,
        health: diagnostics.health,
        commandStatus: diagnostics.commandStatus,
        platformStatus: diagnostics.platformStatus,
        portOwner: diagnostics.portOwner,
      },
    );
  }

  return undefined;
}

async function waitForManagedServiceHealth(
  runtime: ManagedServiceRuntimeConfig,
  timeoutMs = 6_000,
): Promise<ManagedServiceHealth> {
  const deadline = Date.now() + timeoutMs;
  let lastHealth: ManagedServiceHealth = {
    healthy: false,
    error: "Service did not become healthy before timeout.",
  };

  while (Date.now() < deadline) {
    lastHealth = await probeServiceHealth(runtime);
    if (lastHealth.healthy) {
      return lastHealth;
    }
    await delay(500);
  }

  return lastHealth;
}

async function ensureManagedServiceHealthy(
  installed: InstalledService,
  phase: ManagedServiceLifecyclePhase,
): Promise<ManagedServiceHealth> {
  const health = await waitForManagedServiceHealth(installed.runtime);
  if (health.healthy) {
    return health;
  }
  const diagnostics = await collectManagedServiceDiagnostics(installed, {
    includeLogs: true,
  });

  try {
    await stopManagedService();
  } catch {
    // best-effort cleanup; keep the install but stop restart loops
  }

  throw new ManagedServiceCommandError(
    `Managed service failed to become healthy at ${installed.runtime.url}.`,
    {
      kind: "start-failed",
      phase,
      runtime: installed.runtime,
      health: diagnostics.health,
      commandStatus: diagnostics.commandStatus,
      platformStatus: diagnostics.platformStatus,
      portOwner: diagnostics.portOwner,
      logTail: diagnostics.logTail,
    },
  );
}

export async function installManagedService(
  options?: ServiceCommandOptions,
): Promise<ManagedServiceInstallResult> {
  const context = await buildInstallContext(options);
  await writeInstallArtifacts(context);

  if (context.platform === "linux") {
    assertCommandOk(runCommand("systemctl", ["--user", "daemon-reload"]), "systemd daemon-reload");
    assertCommandOk(
      runCommand("systemctl", ["--user", "enable", LINUX_UNIT_NAME]),
      "systemd enable",
    );
  } else if (context.platform === "windows") {
    const taskCommand = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${context.paths.powerShellLauncherPath}"`;
    assertCommandOk(
      runCommand("schtasks", [
        "/Create",
        "/TN",
        WINDOWS_TASK_NAME,
        "/SC",
        "ONLOGON",
        "/RL",
        "LIMITED",
        "/TR",
        taskCommand,
        "/F",
      ]),
      "Task Scheduler create",
    );
  }

  const startResult = options?.start ? await startManagedService({ phase: "install" }) : undefined;

  return {
    installed: true,
    platform: context.platform,
    url: context.runtime.url,
    configPath: context.paths.serviceConfigPath,
    shellLauncherPath: context.paths.shellLauncherPath,
    powerShellLauncherPath: context.paths.powerShellLauncherPath,
    descriptorPath: context.descriptor.descriptorPath,
    autoStartDaemon: context.runtime.autoStartDaemon,
    started: Boolean(startResult?.started),
    health: startResult?.health,
  };
}

export async function startManagedService(options?: {
  phase?: ManagedServiceLifecyclePhase;
}): Promise<ManagedServiceActionResult> {
  const installed = await loadInstalledService();
  if (!installed) {
    throw new Error("No installed managed service found. Run `codexnamer service install` first.");
  }
  const phase = options?.phase ?? "start";
  const existingHealth = await preflightManagedServiceStart(installed, phase);
  if (existingHealth?.healthy) {
    return {
      started: true,
      alreadyRunning: true,
      platform: installed.runtime.platform,
      url: installed.runtime.url,
      health: existingHealth,
    };
  }

  if (installed.runtime.platform === "linux") {
    assertCommandOk(runCommand("systemctl", ["--user", "start", LINUX_UNIT_NAME]), "systemd start");
  } else if (installed.runtime.platform === "macos") {
    const bootoutResult = runCommand("launchctl", [
      "bootout",
      `${currentLaunchctlDomain()}/${MAC_LABEL}`,
    ]);
    if (
      !bootoutResult.ok &&
      !/Could not find service/i.test(`${bootoutResult.stdout}\n${bootoutResult.stderr}`)
    ) {
      // ignore only missing-service cases
    }
    assertCommandOk(
      runCommand("launchctl", [
        "bootstrap",
        currentLaunchctlDomain(),
        installed.paths.macPlistPath,
      ]),
      "launchctl bootstrap",
    );
    assertCommandOk(
      runCommand("launchctl", ["kickstart", "-k", `${currentLaunchctlDomain()}/${MAC_LABEL}`]),
      "launchctl kickstart",
    );
  } else {
    assertCommandOk(
      runCommand("schtasks", ["/Run", "/TN", WINDOWS_TASK_NAME]),
      "Task Scheduler run",
    );
  }

  const health = await ensureManagedServiceHealthy(installed, phase);

  return {
    started: true,
    platform: installed.runtime.platform,
    url: installed.runtime.url,
    health,
  };
}

export async function stopManagedService(): Promise<ManagedServiceActionResult> {
  const installed = await loadInstalledService();
  if (!installed) {
    throw new Error("No installed managed service found. Run `codexnamer service install` first.");
  }

  if (installed.runtime.platform === "linux") {
    assertCommandOk(runCommand("systemctl", ["--user", "stop", LINUX_UNIT_NAME]), "systemd stop");
  } else if (installed.runtime.platform === "macos") {
    assertCommandOk(
      runCommand("launchctl", ["bootout", `${currentLaunchctlDomain()}/${MAC_LABEL}`]),
      "launchctl bootout",
    );
  } else {
    assertCommandOk(
      runCommand("schtasks", ["/End", "/TN", WINDOWS_TASK_NAME]),
      "Task Scheduler end",
    );
  }

  return {
    stopped: true,
    platform: installed.runtime.platform,
    url: installed.runtime.url,
  };
}

export async function restartManagedService(): Promise<ManagedServiceActionResult> {
  const installed = await loadInstalledService();
  if (!installed) {
    throw new Error("No installed managed service found. Run `codexnamer service install` first.");
  }

  try {
    await stopManagedService();
  } catch {
    // continue into start; restart should be resilient to already-stopped services
  }
  await startManagedService({ phase: "restart" });
  return {
    restarted: true,
    platform: installed.runtime.platform,
    url: installed.runtime.url,
  };
}

export async function uninstallManagedService(): Promise<ManagedServiceActionResult> {
  const installed = await loadInstalledService();
  if (!installed) {
    return {
      removed: false,
      reason: "not-installed",
    };
  }

  if (installed.runtime.platform === "linux") {
    runCommand("systemctl", ["--user", "stop", LINUX_UNIT_NAME]);
    runCommand("systemctl", ["--user", "disable", LINUX_UNIT_NAME]);
    await fs.rm(installed.paths.linuxUnitPath, { force: true });
    runCommand("systemctl", ["--user", "daemon-reload"]);
  } else if (installed.runtime.platform === "macos") {
    runCommand("launchctl", ["bootout", `${currentLaunchctlDomain()}/${MAC_LABEL}`]);
    await fs.rm(installed.paths.macPlistPath, { force: true });
  } else {
    runCommand("schtasks", ["/Delete", "/TN", WINDOWS_TASK_NAME, "/F"]);
  }

  await fs.rm(installed.paths.serviceDir, { recursive: true, force: true });

  return {
    removed: true,
    platform: installed.runtime.platform,
  };
}

export async function getManagedServiceStatus(): Promise<ManagedServiceStatusResult> {
  const installed = await loadInstalledService();
  if (!installed) {
    return {
      installed: false,
      serviceName:
        process.platform === "linux"
          ? LINUX_UNIT_NAME
          : process.platform === "darwin"
            ? MAC_LABEL
            : WINDOWS_TASK_NAME,
    };
  }

  const diagnostics = await collectManagedServiceDiagnostics(installed, {
    includeLogs: true,
  });

  return {
    installed: true,
    platform: installed.runtime.platform,
    serviceName:
      installed.runtime.platform === "linux"
        ? LINUX_UNIT_NAME
        : installed.runtime.platform === "macos"
          ? MAC_LABEL
          : WINDOWS_TASK_NAME,
    url: installed.runtime.url,
    configPath: installed.paths.serviceConfigPath,
    logs: {
      stdout: installed.paths.stdoutLogPath,
      stderr: installed.paths.stderrLogPath,
    },
    runtime: installed.runtime,
    commandStatus: diagnostics.commandStatus,
    platformStatus: diagnostics.platformStatus,
    health: diagnostics.health,
    portOwner: diagnostics.portOwner,
    logTail: diagnostics.logTail,
  };
}

export async function runManagedServiceHost(configPath: string): Promise<void> {
  const runtime = JSON.parse(await fs.readFile(configPath, "utf8")) as ManagedServiceRuntimeConfig;
  const app = await startApiServer({
    host: runtime.host,
    port: runtime.port,
    webRoot: runtime.webRoot,
    autoStartDaemon: runtime.autoStartDaemon,
    operator: "service-host",
    cwd: runtime.cwd,
    configPath: runtime.configPath,
  });
  await waitForShutdown(app);
}
