import { describe, expect, it } from "vitest";

import { deriveRuntimeDisplay } from "../packages/web/src/runtime-display.js";
import type { DaemonControlStatus, OverviewResponse } from "../packages/web/src/types.js";

function createOverview(runtime: Partial<OverviewResponse["runtime"]>): OverviewResponse {
  return {
    sessions: {
      total: 0,
      workspaces: 0,
      dirty: 0,
      clean: 0,
      frozen: 0,
      named: 0,
      withCandidate: 0
    },
    runtime: {
      configuredAutoApply: "idle-finalize",
      actualExecution: "preview-only",
      daemonAutoApply: false,
      daemonStatus: "stale",
      explain: "stale",
      ...runtime
    },
    workload: {
      totalTokens: 0,
      totalTasks: 0,
      dirtyTokens: 0,
      activeTokens: 0,
      candidateReadyTokens: 0,
      finalizeReadyTokens: 0,
      appliedTokens: 0,
      averageTokensPerSession: 0,
      averageTokensPerDirtySession: 0,
      averageTitleLength: 0,
      topWorkspacesByTokens: []
    },
    pipeline: {
      discovered: 0,
      active: 0,
      candidateReady: 0,
      finalizeReady: 0,
      applied: 0,
      idle: 0,
      archivedHint: 0,
      missing: 0
    },
    renameHistory: {
      total: 0,
      applied: 0,
      skipped: 0,
      failed: 0,
      previewOnly: 0,
      aiApplied: 0,
      manualApplied: 0,
      autoApplied: 0
    },
    replay: {
      recentRuns: []
    },
    activity: {
      windowDays: 14,
      buckets: []
    }
  };
}

function createDaemon(status: Partial<DaemonControlStatus>): DaemonControlStatus {
  return {
    running: false,
    apiProcessId: 1,
    command: {
      cwd: "/tmp",
      executable: "node",
      scriptPath: "/tmp/daemon.js",
      args: []
    },
    recentLogs: [],
    ...status
  };
}

describe("runtime display overlay", () => {
  it("shows sweep-running when controller is alive but overview heartbeat is stale", () => {
    const result = deriveRuntimeDisplay(
      createOverview({
        configuredAutoApply: "idle-finalize",
        actualExecution: "preview-only",
        daemonStatus: "stale"
      }),
      createDaemon({
        running: true,
        pid: 123
      })
    );

    expect(result.sweepRunning).toBe(true);
    expect(result.execution).toBe("sweep-running");
    expect(result.daemonStatus).toBe("controller-running");
  });

  it("keeps auto-apply display once a fresh heartbeat exists", () => {
    const result = deriveRuntimeDisplay(
      createOverview({
        configuredAutoApply: "idle-finalize",
        actualExecution: "auto-apply",
        daemonStatus: "running",
        daemonAutoApply: true
      }),
      createDaemon({
        running: true,
        pid: 123
      })
    );

    expect(result.sweepRunning).toBe(false);
    expect(result.execution).toBe("auto-apply");
    expect(result.daemonStatus).toBe("running");
  });
});
