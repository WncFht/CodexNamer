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

export function runtimeProgressExplanation(language: "en-US" | "zh-CN"): string {
  if (language === "zh-CN") {
    return "Daemon 进程已经启动，当前 sweep 仍在进行中。等首轮 sweep 记录到新的 heartbeat 之后，这里就会切换成真正的自动应用状态。";
  }
  return "The daemon process is running and the current sweep is still in progress. Runtime will switch to auto-apply once a sweep heartbeat is recorded.";
}

export function runtimeExecutionTone(
  execution: RuntimeExecutionDisplay
): "success" | "warning" | "manual" {
  if (execution === "auto-apply") {
    return "success";
  }
  if (execution === "sweep-running") {
    return "manual";
  }
  return "warning";
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

export function runtimeDaemonStatusTone(
  status: RuntimeDaemonStatusDisplay
): "success" | "warning" | "manual" {
  if (status === "running" || status === "controller-running") {
    return "success";
  }
  if (status === "stale") {
    return "warning";
  }
  return "manual";
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
