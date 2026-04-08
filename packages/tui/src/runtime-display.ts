import type { DaemonControlStatus, OverviewResponse } from "./types.js";

export type RuntimeExecutionDisplay = OverviewResponse["runtime"]["actualExecution"] | "sweep-running";
export type RuntimeDaemonStatusDisplay = OverviewResponse["runtime"]["daemonStatus"] | "controller-running";

export function deriveRuntimeDisplay(
  overview: OverviewResponse | null,
  daemon: DaemonControlStatus | null
): {
  execution: RuntimeExecutionDisplay;
  daemonStatus: RuntimeDaemonStatusDisplay;
  sweepRunning: boolean;
} {
  const configuredAutoApply = overview?.runtime.configuredAutoApply;
  const baseExecution = overview?.runtime.actualExecution ?? "preview-only";
  const baseDaemonStatus = overview?.runtime.daemonStatus ?? "not_seen";
  const controllerRunning = Boolean(daemon?.running);
  const sweepRunning =
    controllerRunning && configuredAutoApply === "idle-finalize" && baseExecution !== "auto-apply";

  if (!sweepRunning) {
    return {
      execution: baseExecution,
      daemonStatus: baseDaemonStatus,
      sweepRunning: false
    };
  }

  return {
    execution: "sweep-running",
    daemonStatus: "controller-running",
    sweepRunning: true
  };
}

export function runtimeExecutionLabel(
  execution: RuntimeExecutionDisplay,
  language: "en-US" | "zh-CN"
): string {
  if (language === "zh-CN") {
    if (execution === "auto-apply") {
      return "自动应用中";
    }
    if (execution === "sweep-running") {
      return "后台扫瞄中";
    }
    return "仅预览";
  }

  if (execution === "auto-apply") {
    return "auto-apply";
  }
  if (execution === "sweep-running") {
    return "sweep-running";
  }
  return "preview-only";
}

export function runtimeDaemonStatusLabel(
  status: RuntimeDaemonStatusDisplay,
  language: "en-US" | "zh-CN"
): string {
  if (language === "zh-CN") {
    if (status === "controller-running") {
      return "运行中（首轮 sweep）";
    }
    if (status === "running") {
      return "运行中";
    }
    if (status === "stale") {
      return "心跳过期";
    }
    return "未检测到";
  }

  if (status === "controller-running") {
    return "running (sweep in progress)";
  }
  if (status === "running") {
    return "running";
  }
  if (status === "stale") {
    return "stale";
  }
  return "not seen";
}
