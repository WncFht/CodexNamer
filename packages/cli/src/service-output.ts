import type { ListeningPortOwner } from "./port-owner.js";
import type {
  CommandStatusSummary,
  ManagedServiceActionResult,
  ManagedServiceCommandFailure,
  ManagedServiceCommandStatus,
  ManagedServiceHealth,
  ManagedServiceInstallResult,
  ManagedServiceLifecyclePhase,
  ManagedServiceStatusResult,
} from "./service-manager.js";
import type { TerminalStyleOptions } from "./terminal-style.js";
import { bold, dim, tone } from "./terminal-style.js";

function formatBoolean(value: boolean | undefined): string {
  return value ? "yes" : "no";
}

function formatHealth(
  health: ManagedServiceHealth | undefined,
  options?: TerminalStyleOptions,
): string {
  if (!health) {
    return tone("unknown", "muted", options);
  }
  if (health.healthy) {
    return tone(
      health.statusCode ? `healthy (HTTP ${health.statusCode})` : "healthy",
      "success",
      options,
    );
  }
  const details = [health.statusCode ? `HTTP ${health.statusCode}` : undefined, health.error]
    .filter(Boolean)
    .join("; ");
  return tone(details ? `unhealthy (${details})` : "unhealthy", "danger", options);
}

function formatPortOwner(owner: ListeningPortOwner): string {
  const target =
    owner.command && owner.pid
      ? `${owner.command} (pid ${owner.pid})`
      : owner.command
        ? owner.command
        : owner.pid
          ? `pid ${owner.pid}`
          : "unknown process";
  return owner.source ? `${target} via ${owner.source}` : target;
}

function summarizeLogTailLines(lines: string[] | undefined): string[] | undefined {
  if (!lines || lines.length === 0) {
    return undefined;
  }

  const prioritized = lines.filter(
    (line) =>
      /EADDRINUSE|listen EADDRINUSE|getcwd|Operation not permitted|ENOENT|EACCES|address already in use/i.test(
        line,
      ) || /^Error:/i.test(line),
  );

  const source = prioritized.length > 0 ? prioritized : lines;
  return [...new Set(source)].slice(-4);
}

function formatSupervisorSummary(params: {
  platformStatus?: CommandStatusSummary;
  commandStatus?: ManagedServiceCommandStatus;
}): string {
  const { platformStatus, commandStatus } = params;
  if (!platformStatus?.loaded) {
    const detail =
      commandStatus?.error ??
      (typeof commandStatus?.exitCode === "number" ? `exit ${commandStatus.exitCode}` : undefined);
    return detail ? `not loaded (${detail})` : "not loaded";
  }

  const parts = [
    `running=${formatBoolean(platformStatus.running)}`,
    platformStatus.state ? `state=${platformStatus.state}` : undefined,
    platformStatus.active ? `active=${platformStatus.active}` : undefined,
    platformStatus.status ? `status=${platformStatus.status}` : undefined,
    typeof platformStatus.pid === "number" ? `pid=${platformStatus.pid}` : undefined,
    typeof platformStatus.lastExitCode === "number"
      ? `lastExitCode=${platformStatus.lastExitCode}`
      : undefined,
  ].filter(Boolean);

  return parts.join(", ");
}

function pushLine(
  lines: string[],
  label: string,
  value: string | undefined,
  options?: TerminalStyleOptions,
): void {
  if (!value) {
    return;
  }
  lines.push(`  ${dim(`${label.padEnd(14)} `, options)}${value}`);
}

function pushLogTail(
  lines: string[],
  label: string,
  tail: string[] | undefined,
  options?: TerminalStyleOptions,
): void {
  if (!tail || tail.length === 0) {
    return;
  }
  lines.push(`  ${dim(`${label}:`, options)}`);
  for (const line of tail) {
    lines.push(`    ${line}`);
  }
}

function actionHeading(
  icon: string,
  title: string,
  toneName: "success" | "warning" | "danger" | "info",
  options?: TerminalStyleOptions,
): string {
  return `${tone(icon, toneName, options)} ${bold(title, options)}`;
}

function formatPlatformLabel(platform: string): string {
  return platform === "linux"
    ? "linux / systemd --user"
    : platform === "macos"
      ? "macOS / LaunchAgent"
      : "windows / Task Scheduler";
}

function formatPhaseLabel(phase: ManagedServiceLifecyclePhase): string {
  return phase === "install" ? "install --start" : phase === "restart" ? "restart" : "start";
}

export function formatManagedServiceInstallResult(
  result: ManagedServiceInstallResult,
  options?: TerminalStyleOptions,
): string {
  const lines = [actionHeading("✔", "Managed service installed", "success", options)];
  pushLine(lines, "platform", formatPlatformLabel(result.platform), options);
  pushLine(lines, "url", tone(result.url, "info", options), options);
  pushLine(lines, "config", result.configPath, options);
  pushLine(lines, "descriptor", result.descriptorPath, options);
  pushLine(lines, "shell launcher", result.shellLauncherPath, options);
  pushLine(lines, "powershell", result.powerShellLauncherPath, options);
  pushLine(
    lines,
    "daemon",
    result.autoStartDaemon
      ? tone("enabled", "success", options)
      : tone("disabled", "warning", options),
    options,
  );
  pushLine(
    lines,
    "started now",
    result.started ? tone("yes", "success", options) : tone("no", "warning", options),
    options,
  );
  if (result.started) {
    pushLine(lines, "health", formatHealth(result.health, options), options);
  }
  pushLine(lines, "next", tone("npm run cli -- service status", "info", options), options);
  return lines.join("\n");
}

export function formatManagedServiceActionResult(
  action: "start" | "stop" | "restart" | "uninstall",
  result: ManagedServiceActionResult,
  options?: TerminalStyleOptions,
): string {
  if (action === "uninstall" && result.removed === false && result.reason === "not-installed") {
    return [
      actionHeading("○", "Managed service is not installed", "warning", options),
      `  ${dim("install         ", options)}${tone("npm run cli -- service install --start", "info", options)}`,
    ].join("\n");
  }

  const title =
    action === "start"
      ? actionHeading("✔", "Managed service started", "success", options)
      : action === "stop"
        ? actionHeading("■", "Managed service stopped", "warning", options)
        : action === "restart"
          ? actionHeading("↻", "Managed service restarted", "info", options)
          : actionHeading("✖", "Managed service uninstalled", "warning", options);

  const lines = [title];
  pushLine(
    lines,
    "platform",
    result.platform ? formatPlatformLabel(result.platform) : undefined,
    options,
  );
  pushLine(lines, "url", result.url ? tone(result.url, "info", options) : undefined, options);
  if (action === "start" || action === "restart") {
    pushLine(lines, "health", formatHealth(result.health, options), options);
  }
  if (action !== "uninstall") {
    pushLine(lines, "next", tone("npm run cli -- service status", "info", options), options);
  }
  return lines.join("\n");
}

export function formatManagedServiceStatusResult(
  result: ManagedServiceStatusResult,
  options?: TerminalStyleOptions,
): string {
  if (!result.installed) {
    return [
      actionHeading("○", "Managed service is not installed", "warning", options),
      `  ${dim("service         ", options)}${result.serviceName}`,
      `  ${dim("install         ", options)}${tone("npm run cli -- service install --start", "info", options)}`,
    ].join("\n");
  }

  const lines = [
    actionHeading(
      result.health.healthy ? "●" : "▲",
      "Managed service status",
      result.health.healthy ? "success" : "warning",
      options,
    ),
  ];
  pushLine(lines, "platform", formatPlatformLabel(result.platform), options);
  pushLine(lines, "service", result.serviceName, options);
  pushLine(lines, "url", tone(result.url, "info", options), options);
  pushLine(lines, "health", formatHealth(result.health, options), options);
  pushLine(
    lines,
    "supervisor",
    formatSupervisorSummary({
      platformStatus: result.platformStatus,
      commandStatus: result.commandStatus,
    }),
    options,
  );
  pushLine(lines, "cwd", result.runtime.cwd, options);
  pushLine(lines, "web root", result.runtime.webRoot, options);
  pushLine(lines, "state dir", result.runtime.stateDir, options);
  pushLine(lines, "installed at", result.runtime.installedAt, options);
  pushLine(
    lines,
    "daemon",
    result.runtime.autoStartDaemon
      ? tone("enabled", "success", options)
      : tone("disabled", "warning", options),
    options,
  );
  pushLine(lines, "stdout log", result.logs.stdout, options);
  pushLine(lines, "stderr log", result.logs.stderr, options);
  if (result.portOwner) {
    pushLine(
      lines,
      "listener",
      tone(formatPortOwner(result.portOwner), "warning", options),
      options,
    );
  }
  if (!result.health.healthy) {
    pushLogTail(lines, "recent stderr", result.logTail?.stderr, options);
    pushLogTail(lines, "recent stdout", result.logTail?.stdout, options);
  }
  return lines.join("\n");
}

export function formatManagedServiceFailure(
  failure: ManagedServiceCommandFailure,
  options?: TerminalStyleOptions,
): string {
  const phaseLabel = formatPhaseLabel(failure.phase);
  const lines = [
    actionHeading(
      "✖",
      failure.phase === "install"
        ? "Managed service installed, but startup failed"
        : "Managed service could not start",
      "danger",
      options,
    ),
  ];

  pushLine(lines, "action", phaseLabel, options);
  pushLine(lines, "platform", formatPlatformLabel(failure.runtime.platform), options);
  pushLine(lines, "url", tone(failure.runtime.url, "info", options), options);
  pushLine(
    lines,
    "reason",
    failure.kind === "port-in-use"
      ? tone("target address is already in use", "danger", options)
      : tone("service never became healthy", "danger", options),
    options,
  );
  pushLine(lines, "health", formatHealth(failure.health, options), options);
  pushLine(
    lines,
    "supervisor",
    formatSupervisorSummary({
      platformStatus: failure.platformStatus,
      commandStatus: failure.commandStatus,
    }),
    options,
  );
  if (failure.portOwner) {
    pushLine(
      lines,
      "listener",
      tone(formatPortOwner(failure.portOwner), "warning", options),
      options,
    );
  }

  const stderrSummary = summarizeLogTailLines(failure.logTail?.stderr);
  const stdoutSummary = summarizeLogTailLines(failure.logTail?.stdout);
  pushLogTail(lines, "stderr summary", stderrSummary, options);
  pushLogTail(lines, "stdout summary", stdoutSummary, options);

  const reinstallCommand = `npm run cli -- service install --start --port ${failure.runtime.port + 1}`;
  if (failure.kind === "port-in-use") {
    pushLine(
      lines,
      "next",
      `stop the current listener, or reinstall on another port with ${tone(reinstallCommand, "info", options)}`,
      options,
    );
  } else {
    pushLine(
      lines,
      "next",
      `inspect ${tone("npm run cli -- service status", "info", options)} or retry with ${tone(reinstallCommand, "info", options)}`,
      options,
    );
  }

  return lines.join("\n");
}

export function formatManagedServiceJsonResult(
  result:
    | ManagedServiceInstallResult
    | ManagedServiceActionResult
    | ManagedServiceStatusResult
    | ManagedServiceCommandFailure,
): string {
  return JSON.stringify(result, null, 2);
}
