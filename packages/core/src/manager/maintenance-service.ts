import type {
  AutoRenamePreview,
  RenameReplayPreviewResult,
  RenameReplayResult,
  RenameSuggestion,
  SessionDetail,
} from "@codexnamer/shared";

import { evaluateAutoRename } from "../auto-rename.js";
import { compactSessionIndex } from "../session-index.js";
import {
  applyOfficialNamingPolicy,
  collectReservedOfficialNameKeys,
  getBlockedOfficialNameThreadIds,
  summarizeRuleStatus,
} from "./naming-policy.js";
import { apply } from "./rename-command-service.js";
import type { DaemonSweepSnapshot, RenameReplaySnapshot } from "./runtime-state.js";
import { summarizeSweepErrorReason } from "./runtime-state.js";
import type { ManagerServiceContext } from "./shared.js";
import { mapWithConcurrency } from "./shared.js";

export async function compactIndex(
  context: ManagerServiceContext,
  options?: { dryRun?: boolean },
): Promise<Awaited<ReturnType<typeof compactSessionIndex>>> {
  const result = await compactSessionIndex({
    filePath: context.sessionIndexPath,
    dryRun: options?.dryRun,
    backupDir: context.backupDir,
  });
  context.invalidateSessionIndexCache();
  return result;
}

export async function getRenameHistory(context: ManagerServiceContext, threadId: string) {
  await context.scan();
  context.requireSessionDetail(threadId);
  return context.db.getRenameHistory(threadId);
}

export async function freeze(context: ManagerServiceContext, threadId: string): Promise<void> {
  await context.scan();
  context.requireSessionDetail(threadId);
  context.db.setFrozen(threadId, true);
}

export async function unfreeze(context: ManagerServiceContext, threadId: string): Promise<void> {
  await context.scan();
  context.requireSessionDetail(threadId);
  context.db.setFrozen(threadId, false);
}

export async function previewRequeueRenamesSince(
  context: ManagerServiceContext,
  params: {
    since: string;
    basis: "session-updated-at" | "last-applied-at";
  },
): Promise<RenameReplayPreviewResult> {
  await context.scan();

  const sinceDate = new Date(params.since);
  if (Number.isNaN(sinceDate.getTime())) {
    throw new Error("Invalid replay timestamp.");
  }

  const currentRuleSignature = context.currentRuleSignature;
  const candidates = context.db.listRenameReplayCandidatesSince({
    since: sinceDate.toISOString(),
    basis: params.basis,
  });
  const queueCounts = new Map<string, number>();
  const skipCounts = new Map<string, number>();
  const items: RenameReplayPreviewResult["items"] = candidates.map((candidate) => {
    const ruleStatus = summarizeRuleStatus({
      lastAppliedSource: candidate.lastAppliedSource,
      lastAppliedRuleSignature: candidate.lastAppliedRuleSignature,
      currentRuleSignature,
    });
    let action: "queue" | "skip" = "queue";
    let reason: RenameReplayPreviewResult["items"][number]["reason"] = "rule_mismatch";

    if (candidate.frozen) {
      action = "skip";
      reason = "frozen";
    } else if (candidate.lastAppliedSource === "manual") {
      action = "skip";
      reason = "manual_name";
    } else if (!candidate.lastAppliedRuleSignature) {
      action = "queue";
      reason = "legacy_unknown_rule";
    } else if (candidate.lastAppliedRuleSignature === currentRuleSignature && !candidate.dirty) {
      action = "skip";
      reason = "already_latest_rule";
    } else if (candidate.lastAppliedRuleSignature === currentRuleSignature && candidate.dirty) {
      action = "queue";
      reason = "content_changed";
    } else {
      action = "queue";
      reason = "rule_mismatch";
    }

    const counter = action === "queue" ? queueCounts : skipCounts;
    counter.set(reason, (counter.get(reason) ?? 0) + 1);
    return {
      threadId: candidate.threadId,
      updatedAt: candidate.updatedAt,
      officialName: candidate.officialName,
      ruleStatus,
      action,
      reason,
    };
  });

  return {
    since: sinceDate.toISOString(),
    basis: params.basis,
    currentRuleSignature,
    matched: items.length,
    queued: items.filter((item) => item.action === "queue").length,
    skipped: items.filter((item) => item.action === "skip").length,
    queueCounts: Object.fromEntries(queueCounts.entries()),
    skipCounts: Object.fromEntries(skipCounts.entries()),
    items,
  };
}

export async function requeueRenamesSince(
  context: ManagerServiceContext,
  params: {
    since: string;
    basis: "session-updated-at" | "last-applied-at";
  },
): Promise<RenameReplayResult> {
  const preview = await previewRequeueRenamesSince(context, params);
  const threadIds = preview.items
    .filter((item) => item.action === "queue")
    .map((item) => item.threadId);
  const result = context.db.queueRenameReplayThreadIds(threadIds);

  const requestedAt = new Date().toISOString();
  const previousState = context.db.getMaintenanceState<RenameReplaySnapshot>("rename_replay");
  context.db.setMaintenanceState("rename_replay", {
    lastRunAt: requestedAt,
    recentRuns: [
      {
        requestedAt,
        since: preview.since,
        basis: params.basis,
        queued: result.queued,
        clearedCandidates: result.clearedCandidates,
        skipped: preview.skipped,
        skipCounts: preview.skipCounts,
      },
      ...(previousState?.recentRuns ?? []),
    ].slice(0, 8),
  } satisfies RenameReplaySnapshot);

  return {
    since: preview.since,
    basis: params.basis,
    queued: result.queued,
    clearedCandidates: result.clearedCandidates,
    matchedThreadIds: result.matchedThreadIds,
    skipped: preview.skipped,
    skipCounts: preview.skipCounts,
  };
}

export async function runAutoRenameSweep(
  context: ManagerServiceContext,
  options?: {
    includeCandidateNames?: boolean;
    limit?: number;
    autoApply?: boolean;
    intervalSeconds?: number;
    processId?: number;
    recordRuntime?: boolean;
  },
): Promise<{
  previews: AutoRenamePreview[];
  applied: Array<{ threadId: string; written: boolean; name: string; reason?: string }>;
}> {
  const scanReport = await context.scan();
  const now = new Date();
  const blockedOfficialThreadIds = getBlockedOfficialNameThreadIds(context.db, context.config);
  const reservedNameKeys = collectReservedOfficialNameKeys(context.db, context.config, {
    blockedOfficialThreadIds,
  });
  const previews: AutoRenamePreview[] = [];
  const applied: Array<{ threadId: string; written: boolean; name: string; reason?: string }> = [];
  const dirtySessions = await context.listSessions({ dirty: true });
  const limit =
    typeof options?.limit === "number" && Number.isFinite(options.limit) && options.limit > 0
      ? Math.trunc(options.limit)
      : dirtySessions.length;
  const pending = Math.max(0, dirtySessions.length - limit);
  const autoApplyEnabled =
    (options?.autoApply ?? true) && context.config.rename.autoApply === "idle-finalize";
  const maxConcurrency = Math.max(1, Math.trunc(context.config.ai.maxConcurrency || 1));
  let reservationChain = Promise.resolve();
  const reservationScheduler = async <T>(callback: () => T | Promise<T>): Promise<T> => {
    const scheduled = reservationChain.then(callback);
    reservationChain = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  };
  const workItems: Array<{
    detail: SessionDetail;
    evaluation: ReturnType<typeof evaluateAutoRename>;
  }> = [];

  for (const session of dirtySessions) {
    if (workItems.length >= limit) {
      break;
    }
    const detail = context.db.getSessionDetail(session.threadId);
    if (!detail) {
      continue;
    }
    const normalizedDetail = applyOfficialNamingPolicy(detail, blockedOfficialThreadIds);

    const renameState = context.db.getRenameState(normalizedDetail.threadId);
    const evaluation = evaluateAutoRename(normalizedDetail, context.config, {
      now,
      renameState,
    });
    workItems.push({
      detail: normalizedDetail,
      evaluation,
    });
  }

  const sweepItems = await mapWithConcurrency(workItems, maxConcurrency, async (item) => {
    const shouldResolveSuggestion =
      options?.includeCandidateNames === true ||
      (autoApplyEnabled && item.evaluation.action === "apply");
    let suggestion: RenameSuggestion | undefined;
    let failureReason: string | undefined;
    if (shouldResolveSuggestion && item.evaluation.action !== "skip") {
      try {
        suggestion = await context.resolveSuggestionForDetail(item.detail, {
          saveCandidate: autoApplyEnabled || options?.includeCandidateNames === true,
          reservedNameKeys,
          blockedOfficialThreadIds,
          reservationScheduler,
        });
      } catch (error) {
        failureReason = summarizeSweepErrorReason(error);
      }
    }

    return {
      ...item,
      suggestion,
      failureReason,
    };
  });

  for (const item of sweepItems) {
    const previewStatus = item.failureReason ? "skip" : item.evaluation.action;
    const previewReason = item.failureReason ?? item.evaluation.reason;
    previews.push({
      threadId: item.detail.threadId,
      candidateName: options?.includeCandidateNames ? item.suggestion?.name : undefined,
      status: previewStatus,
      reason: previewReason,
    });

    if (autoApplyEnabled && item.evaluation.action === "apply" && !item.failureReason) {
      try {
        const result = await apply(context, item.detail.threadId, {
          autoApply: true,
          skipScan: true,
          detail: item.detail,
        });
        applied.push({
          threadId: item.detail.threadId,
          written: result.written,
          name: result.name,
          reason: result.written ? undefined : "unchanged",
        });
      } catch (error) {
        applied.push({
          threadId: item.detail.threadId,
          written: false,
          name: item.suggestion?.name ?? item.detail.officialName ?? item.detail.threadId,
          reason: summarizeSweepErrorReason(error),
        });
      }
    }
  }

  const summary = {
    total: previews.length,
    dirtyTotal: dirtySessions.length,
    pending,
    suggest: previews.filter((item) => item.status === "suggest").length,
    apply: previews.filter((item) => item.status === "apply").length,
    skip: previews.filter((item) => item.status === "skip").length,
    failedSuggestions: previews.filter((item) =>
      [
        "request-failed",
        "missing-auth",
        "provider-misconfigured",
        "empty-response",
        "invalid-json",
        "missing-fields",
        "unsupported-backend",
        "error",
      ].includes(item.reason),
    ).length,
    autoApplied: applied.filter((item) => item.written).length,
    unchanged: applied.filter((item) => !item.written).length,
    scan: {
      scannedRollouts: scanReport.scannedRollouts,
      updatedSessions: scanReport.updatedSessions,
    },
    execution: autoApplyEnabled ? "auto-apply" : "preview-only",
  } satisfies DaemonSweepSnapshot["summary"];

  if (options?.recordRuntime !== false) {
    const previousState = context.db.getMaintenanceState<DaemonSweepSnapshot>("daemon_runtime");
    context.db.setMaintenanceState("daemon_runtime", {
      lastSweepAt: now.toISOString(),
      intervalSeconds: Math.max(
        1,
        Math.trunc(options?.intervalSeconds ?? context.config.watch.scanIntervalSeconds),
      ),
      processId:
        typeof options?.processId === "number" && Number.isFinite(options.processId)
          ? Math.trunc(options.processId)
          : undefined,
      summary,
      recentSweeps: [
        {
          at: now.toISOString(),
          total: summary.total,
          dirtyTotal: summary.dirtyTotal,
          pending: summary.pending,
          suggest: summary.suggest,
          apply: summary.apply,
          skip: summary.skip,
          failedSuggestions: summary.failedSuggestions,
          autoApplied: summary.autoApplied,
          unchanged: summary.unchanged,
          execution: summary.execution,
        },
        ...(previousState?.recentSweeps ?? []).filter((item) => item.at !== now.toISOString()),
      ].slice(0, 32),
    } satisfies DaemonSweepSnapshot);
  }

  return {
    previews,
    applied,
  };
}

export async function previewAutoRename(
  context: ManagerServiceContext,
  options?: {
    includeCandidateNames?: boolean;
    limit?: number;
  },
): Promise<AutoRenamePreview[]> {
  const result = await runAutoRenameSweep(context, {
    includeCandidateNames: options?.includeCandidateNames,
    limit: options?.limit,
    autoApply: false,
    recordRuntime: false,
  });
  return result.previews;
}
