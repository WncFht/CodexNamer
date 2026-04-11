import type { EffectiveConfig, OverviewReport } from "@codexnamer/shared";

import { RenameInferenceError } from "../provider.js";

export type DaemonSweepSnapshot = {
  lastSweepAt: string;
  intervalSeconds: number;
  processId?: number;
  summary: {
    total: number;
    dirtyTotal: number;
    pending: number;
    suggest: number;
    apply: number;
    skip: number;
    failedSuggestions: number;
    autoApplied: number;
    unchanged: number;
    scan: {
      scannedRollouts: number;
      updatedSessions: number;
    };
    execution: "preview-only" | "auto-apply";
  };
  recentSweeps: Array<{
    at: string;
    total: number;
    dirtyTotal: number;
    pending: number;
    suggest: number;
    apply: number;
    skip: number;
    failedSuggestions: number;
    autoApplied: number;
    unchanged: number;
    execution: "preview-only" | "auto-apply";
  }>;
};

export type RenameReplaySnapshot = {
  lastRunAt?: string;
  recentRuns: Array<{
    requestedAt: string;
    since: string;
    basis: "session-updated-at" | "last-applied-at";
    queued: number;
    clearedCandidates: number;
    skipped: number;
    skipCounts?: Record<string, number>;
  }>;
};

export function summarizeSweepErrorReason(error: unknown): string {
  if (error instanceof RenameInferenceError) {
    return error.code;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    "code" in error &&
    error.name === "RenameInferenceError" &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  if (error instanceof Error) {
    return error.message || "error";
  }
  return "error";
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "EPERM") {
      return true;
    }
    return false;
  }
}

export function resolveDaemonStatus(
  config: EffectiveConfig,
  daemonState: DaemonSweepSnapshot | undefined
): OverviewReport["runtime"]["daemonStatus"] {
  if (!daemonState?.lastSweepAt) {
    return "not_seen";
  }

  const lastSweepAt = Date.parse(daemonState.lastSweepAt);
  if (!Number.isFinite(lastSweepAt)) {
    return "stale";
  }

  if (typeof daemonState.processId === "number" && Number.isFinite(daemonState.processId)) {
    if (!isProcessAlive(Math.trunc(daemonState.processId))) {
      return "stale";
    }
  }

  const intervalSeconds = Math.max(1, Math.trunc(daemonState.intervalSeconds || config.watch.scanIntervalSeconds));
  const staleAfterMs = Math.max(intervalSeconds * 2_500, 30_000);
  return Date.now() - lastSweepAt <= staleAfterMs ? "running" : "stale";
}

export function describeRuntimeState(params: {
  configuredAutoApply: EffectiveConfig["rename"]["autoApply"];
  daemonStatus: OverviewReport["runtime"]["daemonStatus"];
  actualExecution: OverviewReport["runtime"]["actualExecution"];
  summary?: OverviewReport["runtime"]["lastSweepSummary"];
}): string {
  const summaryCopy = params.summary
    ? `Last sweep handled ${params.summary.total}/${params.summary.dirtyTotal} dirty sessions, left ${params.summary.pending} pending, and auto-applied ${params.summary.autoApplied}.`
    : "";
  if (params.actualExecution === "auto-apply") {
    return `${summaryCopy} Auto-apply is live for finalize-ready sessions.`.trim();
  }

  if (params.configuredAutoApply === "idle-finalize") {
    if (params.daemonStatus === "running") {
      return `${summaryCopy} A daemon heartbeat is active, but the latest sweep is still preview-only.`.trim();
    }
    if (params.daemonStatus === "stale") {
      return `${summaryCopy} Auto-apply is configured, but the daemon heartbeat is stale.`.trim();
    }
    if (params.daemonStatus === "not_seen") {
      return "Auto-apply is configured, but no daemon heartbeat has been recorded yet.";
    }
  }

  if (params.daemonStatus === "running") {
    return `${summaryCopy} The daemon is running, but auto-apply is disabled, so sessions remain preview-only.`.trim();
  }

  return "No active daemon heartbeat is visible. The runtime stays preview-only until a daemon sweep starts.";
}
