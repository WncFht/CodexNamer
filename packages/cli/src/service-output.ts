import type { ListeningPortOwner } from "./port-owner.js";
import type {
  CommandStatusSummary,
  ManagedServiceActionResult,
  ManagedServiceCommandStatus,
  ManagedServiceHealth,
  ManagedServiceInstallResult,
  ManagedServiceStatusResult,
} from "./service-manager.js";

function formatBoolean(value: boolean | undefined): string {
  return value ? "yes" : "no";
}

function formatHealth(health: ManagedServiceHealth | undefined): string {
  if (!health) {
    return "unknown";
  }
  if (health.healthy) {
    return health.statusCode ? `healthy (HTTP ${health.statusCode})` : "healthy";
  }
  const details = [health.statusCode ? `HTTP ${health.statusCode}` : undefined, health.error]
    .filter(Boolean)
    .join("; ");
  return details ? `unhealthy (${details})` : "unhealthy";
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

function pushLine(lines: string[], label: string, value: string | undefined): void {
  if (!value) {
    return;
  }
  lines.push(`- ${label}: ${value}`);
}

function pushLogTail(lines: string[], label: string, tail: string[] | undefined): void {
  if (!tail || tail.length === 0) {
    return;
  }
  lines.push(`- ${label}:`);
  for (const line of tail) {
    lines.push(`  ${line}`);
  }
}

export function formatManagedServiceInstallResult(result: ManagedServiceInstallResult): string {
  const lines = ["[codexnamer] Managed service installed."];
  pushLine(lines, "platform", result.platform);
  pushLine(lines, "url", result.url);
  pushLine(lines, "config", result.configPath);
  pushLine(lines, "descriptor", result.descriptorPath);
  pushLine(lines, "shell launcher", result.shellLauncherPath);
  pushLine(lines, "powershell launcher", result.powerShellLauncherPath);
  pushLine(lines, "daemon auto-start", result.autoStartDaemon ? "enabled" : "disabled");
  pushLine(lines, "started now", result.started ? "yes" : "no");
  if (result.started) {
    pushLine(lines, "health", formatHealth(result.health));
  }
  lines.push("- next: npm run cli -- service status");
  return lines.join("\n");
}

export function formatManagedServiceActionResult(
  action: "start" | "stop" | "restart" | "uninstall",
  result: ManagedServiceActionResult,
): string {
  if (action === "uninstall" && result.removed === false && result.reason === "not-installed") {
    return "[codexnamer] Managed service is not installed.";
  }

  const title =
    action === "start"
      ? "[codexnamer] Managed service started."
      : action === "stop"
        ? "[codexnamer] Managed service stopped."
        : action === "restart"
          ? "[codexnamer] Managed service restarted."
          : "[codexnamer] Managed service uninstalled.";

  const lines = [title];
  pushLine(lines, "platform", result.platform);
  pushLine(lines, "url", result.url);
  if (action === "start" || action === "restart") {
    pushLine(lines, "health", formatHealth(result.health));
  }
  if (action !== "uninstall") {
    lines.push("- next: npm run cli -- service status");
  }
  return lines.join("\n");
}

export function formatManagedServiceStatusResult(result: ManagedServiceStatusResult): string {
  if (!result.installed) {
    return [
      "[codexnamer] Managed service is not installed.",
      `- service: ${result.serviceName}`,
      "- install: npm run cli -- service install --start",
    ].join("\n");
  }

  const lines = ["[codexnamer] Managed service status"];
  pushLine(lines, "platform", result.platform);
  pushLine(lines, "service", result.serviceName);
  pushLine(lines, "url", result.url);
  pushLine(lines, "health", formatHealth(result.health));
  pushLine(
    lines,
    "supervisor",
    formatSupervisorSummary({
      platformStatus: result.platformStatus,
      commandStatus: result.commandStatus,
    }),
  );
  pushLine(lines, "cwd", result.runtime.cwd);
  pushLine(lines, "web root", result.runtime.webRoot);
  pushLine(lines, "state dir", result.runtime.stateDir);
  pushLine(lines, "installed at", result.runtime.installedAt);
  pushLine(lines, "daemon auto-start", result.runtime.autoStartDaemon ? "enabled" : "disabled");
  pushLine(lines, "stdout log", result.logs.stdout);
  pushLine(lines, "stderr log", result.logs.stderr);
  if (result.portOwner) {
    pushLine(lines, "detected listener", formatPortOwner(result.portOwner));
  }
  pushLogTail(lines, "recent stderr", result.logTail?.stderr);
  pushLogTail(lines, "recent stdout", result.logTail?.stdout);
  return lines.join("\n");
}

export function formatManagedServiceJsonResult(
  result: ManagedServiceInstallResult | ManagedServiceActionResult | ManagedServiceStatusResult,
): string {
  return JSON.stringify(result, null, 2);
}
