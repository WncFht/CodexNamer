import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { DoctorReport, OverviewReport } from "@codexnamer/shared";

import { inspectRenameProvider } from "../provider.js";
import { readSessionIndex } from "../session-index.js";
import {
  ACCEPTED_OFFICIAL_RENAME_SOURCES,
  applyOfficialNamingPolicy,
  applyRuleSignatureState,
  getBlockedOfficialNameThreadIds,
} from "./naming-policy.js";
import type { DaemonSweepSnapshot, RenameReplaySnapshot } from "./runtime-state.js";
import { describeRuntimeState, resolveDaemonStatus } from "./runtime-state.js";
import type { ManagerServiceContext } from "./shared.js";

export async function doctor(context: ManagerServiceContext): Promise<DoctorReport> {
  const stats = await readSessionIndex(context.sessionIndexPath);
  const sessionsDir = path.join(context.config.general.codexHome, "sessions");
  const dbPath = path.join(context.config.general.stateDir, "app.db");

  const [codexHomeExists, sessionsDirExists, dbExists] = await Promise.all([
    fs
      .stat(context.config.general.codexHome)
      .then(() => true)
      .catch(() => false),
    fs
      .stat(sessionsDir)
      .then(() => true)
      .catch(() => false),
    fs
      .stat(dbPath)
      .then(() => true)
      .catch(() => false),
  ]);

  const sessionIndexReadable = await fs
    .access(context.sessionIndexPath)
    .then(() => true)
    .catch(() => false);

  const sessionIndexWritable = await fs
    .access(path.dirname(context.sessionIndexPath), fsConstants.W_OK)
    .then(() => true)
    .catch(() => false);

  return {
    codexHomeExists,
    sessionsDirExists,
    sessionIndexReadable,
    sessionIndexWritable,
    dbPath,
    dbExists,
    stats: stats.stats,
    autoRename: {
      ...context.config.watch,
      autoApply: context.config.rename.autoApply,
    },
    provider: inspectRenameProvider(context.config) as unknown as Record<string, unknown>,
  };
}

export async function overview(context: ManagerServiceContext): Promise<OverviewReport> {
  await context.scan();
  const blockedOfficialThreadIds = getBlockedOfficialNameThreadIds(context.db, context.config);
  const report = context.db.getOverviewReport({
    nonAcceptedNamedThreadIds: blockedOfficialThreadIds,
    acceptedAppliedSources: [...ACCEPTED_OFFICIAL_RENAME_SOURCES],
  });
  const currentRuleSignature = context.currentRuleSignature;
  const sessions = context.db
    .listSessions()
    .map((session) =>
      applyRuleSignatureState(
        applyOfficialNamingPolicy(session, blockedOfficialThreadIds),
        currentRuleSignature,
      ),
    );
  const ruleCoverage = sessions.reduce(
    (summary, session) => {
      switch (session.ruleStatus) {
        case "latest":
          summary.latest += 1;
          break;
        case "outdated":
          summary.outdated += 1;
          break;
        case "manual":
          summary.manual += 1;
          break;
        default:
          summary.unknown += 1;
          break;
      }
      return summary;
    },
    {
      currentSignature: currentRuleSignature,
      latest: 0,
      outdated: 0,
      manual: 0,
      unknown: 0,
    } satisfies OverviewReport["ruleCoverage"],
  );
  const daemonState = context.db.getMaintenanceState<DaemonSweepSnapshot>("daemon_runtime");
  const replayState = context.db.getMaintenanceState<RenameReplaySnapshot>("rename_replay");
  const daemonStatus = resolveDaemonStatus(context.config, daemonState);
  const actualExecution =
    daemonStatus === "running" && daemonState?.summary.execution === "auto-apply"
      ? "auto-apply"
      : "preview-only";
  const daemonAutoApply = actualExecution === "auto-apply";
  return {
    ...report,
    runtime: {
      configuredAutoApply: context.config.rename.autoApply,
      actualExecution,
      daemonAutoApply,
      daemonStatus,
      currentRuleSignature,
      lastSweepAt: daemonState?.lastSweepAt,
      lastSweepIntervalSeconds: daemonState?.intervalSeconds,
      lastSweepSummary: daemonState?.summary,
      recentSweeps: Array.isArray(daemonState?.recentSweeps) ? daemonState.recentSweeps : [],
      explain: describeRuntimeState({
        configuredAutoApply: context.config.rename.autoApply,
        daemonStatus,
        actualExecution,
        summary: daemonState?.summary,
      }),
    },
    ruleCoverage,
    replay: {
      lastRunAt: replayState?.lastRunAt,
      recentRuns: Array.isArray(replayState?.recentRuns) ? replayState.recentRuns : [],
    },
  };
}
