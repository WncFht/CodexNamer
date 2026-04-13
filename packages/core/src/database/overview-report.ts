import type {
  OverviewReport,
  RenameSource,
  SessionStatusEstimate,
  SessionSummary,
  WorkspaceSummary,
} from "@codexnamer/shared";
import type Database from "better-sqlite3";

import { workspaceIdForCwd, workspaceLabelForCwd } from "../util.js";

function toBoolean(value: number | null | undefined): boolean {
  return value === 1;
}

export function buildWorkspaceSummaries(sessions: SessionSummary[]): WorkspaceSummary[] {
  const groups = new Map<string, WorkspaceSummary>();

  for (const session of sessions) {
    const existing = groups.get(session.workspaceId);
    if (existing) {
      existing.sessionCount += 1;
      existing.dirtyCount += session.dirty ? 1 : 0;
      existing.frozenCount += session.frozen ? 1 : 0;
      if (session.projectName && !existing.projects.includes(session.projectName)) {
        existing.projects.push(session.projectName);
      }
      if ((session.updatedAt ?? "") > (existing.latestUpdatedAt ?? "")) {
        existing.latestUpdatedAt = session.updatedAt;
      }
      continue;
    }

    groups.set(session.workspaceId, {
      workspaceId: session.workspaceId,
      workspaceLabel: session.workspaceLabel,
      workspacePath: session.cwd,
      sessionCount: 1,
      dirtyCount: session.dirty ? 1 : 0,
      frozenCount: session.frozen ? 1 : 0,
      latestUpdatedAt: session.updatedAt,
      projects: session.projectName ? [session.projectName] : [],
    });
  }

  return Array.from(groups.values()).sort((left, right) =>
    (right.latestUpdatedAt ?? "").localeCompare(left.latestUpdatedAt ?? ""),
  );
}

export function getOverviewReport(
  db: Database.Database,
  sessions: SessionSummary[],
  options?: {
    nonAcceptedNamedThreadIds?: Set<string>;
    acceptedAppliedSources?: RenameSource[];
  },
): OverviewReport {
  const workspaces = buildWorkspaceSummaries(sessions);
  const nonAcceptedNamedThreadIds = options?.nonAcceptedNamedThreadIds ?? new Set<string>();
  const acceptedAppliedSources = options?.acceptedAppliedSources ?? ["ai", "manual"];
  const workloadRows = db
    .prepare(
      `SELECT s.thread_id, s.cwd, s.project_name, s.token_total, s.task_complete_count, s.status_estimate,
              COALESCE(rs.dirty_since_rename, 0) AS dirty_since_rename,
              COALESCE(rs.force_rewrite, 0) AS force_rewrite
       FROM sessions s
       LEFT JOIN rename_state rs ON rs.thread_id = s.thread_id`,
    )
    .all() as Array<Record<string, unknown>>;
  const pipeline: OverviewReport["pipeline"] = {
    discovered: 0,
    active: 0,
    candidateReady: 0,
    finalizeReady: 0,
    applied: 0,
    idle: 0,
    archivedHint: 0,
    missing: 0,
  };

  for (const session of sessions) {
    switch (session.statusEstimate) {
      case "discovered":
        pipeline.discovered += 1;
        break;
      case "active":
        pipeline.active += 1;
        break;
      case "candidate_ready":
        pipeline.candidateReady += 1;
        break;
      case "finalize_ready":
        pipeline.finalizeReady += 1;
        break;
      case "applied":
        pipeline.applied += 1;
        break;
      case "idle":
        pipeline.idle += 1;
        break;
      case "archived_hint":
        pipeline.archivedHint += 1;
        break;
      case "missing":
        pipeline.missing += 1;
        break;
      default:
        break;
    }
  }

  const topWorkspaceMap = new Map<
    string,
    OverviewReport["workload"]["topWorkspacesByTokens"][number]
  >();
  let totalTokens = 0;
  let totalTasks = 0;
  let dirtyTokens = 0;
  let activeTokens = 0;
  let candidateReadyTokens = 0;
  let finalizeReadyTokens = 0;
  let appliedTokens = 0;

  for (const row of workloadRows) {
    const tokenTotal = Number(row.token_total ?? 0);
    const taskCompleteCount = Number(row.task_complete_count ?? 0);
    const cwd = (row.cwd as string | null) ?? undefined;
    const projectName = (row.project_name as string | null) ?? undefined;
    const statusEstimate = (row.status_estimate as SessionStatusEstimate | null) ?? undefined;
    const threadId = (row.thread_id as string | null) ?? undefined;
    const isDirty =
      toBoolean((row.dirty_since_rename as number | null) ?? 0) ||
      toBoolean((row.force_rewrite as number | null) ?? 0) ||
      (threadId ? nonAcceptedNamedThreadIds.has(threadId) : false);
    const workspaceId = workspaceIdForCwd(cwd);
    const workspaceLabel = workspaceLabelForCwd(cwd, projectName);

    totalTokens += tokenTotal;
    totalTasks += taskCompleteCount;

    if (isDirty) {
      dirtyTokens += tokenTotal;
    }

    switch (statusEstimate) {
      case "active":
        activeTokens += tokenTotal;
        break;
      case "candidate_ready":
        candidateReadyTokens += tokenTotal;
        break;
      case "finalize_ready":
        finalizeReadyTokens += tokenTotal;
        break;
      case "applied":
        appliedTokens += tokenTotal;
        break;
      default:
        break;
    }

    const existingWorkspace = topWorkspaceMap.get(workspaceId);
    if (existingWorkspace) {
      existingWorkspace.sessions += 1;
      existingWorkspace.tokens += tokenTotal;
    } else {
      topWorkspaceMap.set(workspaceId, {
        workspaceId,
        workspaceLabel,
        sessions: 1,
        tokens: tokenTotal,
      });
    }
  }

  const activityWindowDays = 14;
  const bucketStart = new Date();
  bucketStart.setUTCHours(0, 0, 0, 0);
  bucketStart.setUTCDate(bucketStart.getUTCDate() - (activityWindowDays - 1));
  const renameHistoryRows = db
    .prepare(
      `SELECT id, thread_id, kind, source, status, applied_at
       FROM rename_history
       ORDER BY applied_at DESC, id DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  const acceptedAppliedSourceSet = new Set(acceptedAppliedSources);
  const latestHistoryByThread = new Map<string, Record<string, unknown>>();
  const latestAcceptedAppliedByThread = new Map<string, Record<string, unknown>>();

  for (const row of renameHistoryRows) {
    const threadId = typeof row.thread_id === "string" ? row.thread_id : undefined;
    if (!threadId) {
      continue;
    }
    if (!latestHistoryByThread.has(threadId)) {
      latestHistoryByThread.set(threadId, row);
    }
    if (
      !latestAcceptedAppliedByThread.has(threadId) &&
      row.status === "applied" &&
      typeof row.source === "string" &&
      acceptedAppliedSourceSet.has(row.source as RenameSource)
    ) {
      latestAcceptedAppliedByThread.set(threadId, row);
    }
  }

  const renameHistorySummary = {
    total: latestHistoryByThread.size,
    applied: latestAcceptedAppliedByThread.size,
    skipped: 0,
    failed: 0,
    previewOnly: 0,
    aiApplied: 0,
    manualApplied: 0,
    autoApplied: 0,
    lastAppliedAt: undefined as string | undefined,
  };

  for (const row of latestHistoryByThread.values()) {
    switch (row.status) {
      case "skipped":
        renameHistorySummary.skipped += 1;
        break;
      case "failed":
        renameHistorySummary.failed += 1;
        break;
      case "preview_only":
        renameHistorySummary.previewOnly += 1;
        break;
      default:
        break;
    }
  }

  const activityByDate = new Map<
    string,
    {
      applied: number;
      previewOnly: number;
      skipped: number;
      failed: number;
      autoApplied: number;
      manualApplied: number;
      aiApplied: number;
    }
  >();

  for (const row of latestAcceptedAppliedByThread.values()) {
    if (row.source === "ai") {
      renameHistorySummary.aiApplied += 1;
    }
    if (row.source === "manual") {
      renameHistorySummary.manualApplied += 1;
    }
    if (row.kind === "auto" && row.source === "ai") {
      renameHistorySummary.autoApplied += 1;
    }
    if (typeof row.applied_at === "string") {
      if (
        !renameHistorySummary.lastAppliedAt ||
        row.applied_at > renameHistorySummary.lastAppliedAt
      ) {
        renameHistorySummary.lastAppliedAt = row.applied_at;
      }
    }
  }

  for (const row of latestHistoryByThread.values()) {
    const appliedAt = typeof row.applied_at === "string" ? row.applied_at : undefined;
    if (!appliedAt || appliedAt < bucketStart.toISOString()) {
      continue;
    }
    const day = appliedAt.slice(0, 10);
    const bucket = activityByDate.get(day) ?? {
      applied: 0,
      previewOnly: 0,
      skipped: 0,
      failed: 0,
      autoApplied: 0,
      manualApplied: 0,
      aiApplied: 0,
    };
    if (
      row.status === "applied" &&
      typeof row.source === "string" &&
      acceptedAppliedSourceSet.has(row.source as RenameSource)
    ) {
      bucket.applied += 1;
      if (row.source === "ai") {
        bucket.aiApplied += 1;
      }
      if (row.kind === "auto" && row.source === "ai") {
        bucket.autoApplied += 1;
      }
      if (row.kind === "manual") {
        bucket.manualApplied += 1;
      }
    } else if (row.status === "preview_only") {
      bucket.previewOnly += 1;
    } else if (row.status === "skipped") {
      bucket.skipped += 1;
    } else if (row.status === "failed") {
      bucket.failed += 1;
    }
    activityByDate.set(day, bucket);
  }

  const activityBuckets: OverviewReport["activity"]["buckets"] = [];
  for (let index = 0; index < activityWindowDays; index += 1) {
    const date = new Date(bucketStart);
    date.setUTCDate(bucketStart.getUTCDate() + index);
    const day = date.toISOString().slice(0, 10);
    const row = activityByDate.get(day);
    activityBuckets.push({
      date: day,
      label: `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`,
      applied: Number(row?.applied ?? 0),
      previewOnly: Number(row?.previewOnly ?? 0),
      skipped: Number(row?.skipped ?? 0),
      failed: Number(row?.failed ?? 0),
      autoApplied: Number(row?.autoApplied ?? 0),
      manualApplied: Number(row?.manualApplied ?? 0),
      aiApplied: Number(row?.aiApplied ?? 0),
    });
  }

  const dirtySessionCount = sessions.filter(
    (item) => item.dirty || nonAcceptedNamedThreadIds.has(item.threadId),
  ).length;
  const acceptedOfficialNames = sessions
    .filter((item) => Boolean(item.officialName) && !nonAcceptedNamedThreadIds.has(item.threadId))
    .map((item) => item.officialName ?? "");
  const averageTitleLength =
    acceptedOfficialNames.length > 0
      ? Math.round(
          acceptedOfficialNames.reduce((sum, name) => sum + name.trim().length, 0) /
            acceptedOfficialNames.length,
        )
      : 0;

  return {
    sessions: {
      total: sessions.length,
      workspaces: workspaces.length,
      dirty: sessions.filter((item) => item.dirty || nonAcceptedNamedThreadIds.has(item.threadId))
        .length,
      clean: sessions.filter((item) => !item.dirty && !nonAcceptedNamedThreadIds.has(item.threadId))
        .length,
      frozen: sessions.filter((item) => item.frozen).length,
      named: sessions.filter(
        (item) => Boolean(item.officialName) && !nonAcceptedNamedThreadIds.has(item.threadId),
      ).length,
      withCandidate: sessions.filter((item) => Boolean(item.candidateName)).length,
    },
    runtime: {
      configuredAutoApply: "unknown",
      actualExecution: "preview-only",
      daemonAutoApply: false,
      daemonStatus: "not_seen",
      currentRuleSignature: "",
      lastSweepAt: undefined,
      lastSweepIntervalSeconds: undefined,
      lastSweepSummary: undefined,
      recentSweeps: [],
      explain:
        "The current daemon scans sessions and prints preview evaluations, but it does not call apply().",
    },
    ruleCoverage: {
      currentSignature: "",
      latest: 0,
      outdated: 0,
      manual: 0,
      unknown: 0,
    },
    workload: {
      totalTokens,
      totalTasks,
      dirtyTokens,
      activeTokens,
      candidateReadyTokens,
      finalizeReadyTokens,
      appliedTokens,
      averageTokensPerSession: sessions.length > 0 ? Math.round(totalTokens / sessions.length) : 0,
      averageTokensPerDirtySession:
        dirtySessionCount > 0 ? Math.round(dirtyTokens / dirtySessionCount) : 0,
      averageTitleLength,
      topWorkspacesByTokens: Array.from(topWorkspaceMap.values())
        .sort((left, right) => {
          if (right.tokens !== left.tokens) {
            return right.tokens - left.tokens;
          }
          return right.sessions - left.sessions;
        })
        .slice(0, 6),
    },
    pipeline,
    renameHistory: {
      total: renameHistorySummary.total,
      applied: renameHistorySummary.applied,
      skipped: renameHistorySummary.skipped,
      failed: renameHistorySummary.failed,
      previewOnly: renameHistorySummary.previewOnly,
      aiApplied: renameHistorySummary.aiApplied,
      manualApplied: renameHistorySummary.manualApplied,
      autoApplied: renameHistorySummary.autoApplied,
      lastAppliedAt: renameHistorySummary.lastAppliedAt,
    },
    replay: {
      lastRunAt: undefined,
      recentRuns: [],
    },
    activity: {
      windowDays: activityWindowDays,
      buckets: activityBuckets,
    },
  };
}
