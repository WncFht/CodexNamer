import fs from "node:fs/promises";

import type {
  ScanReport,
  SessionDetail,
  SessionListQuery,
  SessionSummary,
  SessionsResponse,
  WorkspaceSummary,
} from "@codexnamer/shared";

import { estimateSessionStatus } from "../auto-rename.js";
import { buildSessionRevision } from "../revision.js";
import {
  discoverRolloutFiles,
  ingestRolloutFile,
  readSessionTranscript,
  readSessionTranscriptPage,
} from "../rollout.js";
import {
  applyOfficialNamingPolicy,
  applyRuleSignatureState,
  filterVisibleRenameHistory,
  getBlockedOfficialNameThreadIds,
} from "./naming-policy.js";
import type { ManagerServiceContext } from "./shared.js";

function normalizeSearchValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

function filterAndSortSessions(
  sessions: SessionSummary[],
  query: SessionListQuery,
  options?: {
    loadDetailText?: (threadId: string) =>
      | {
          firstUserMessage?: string;
          lastUserMessage?: string;
          lastAgentMessage?: string;
        }
      | undefined;
  },
): SessionSummary[] {
  const project = normalizeSearchValue(query.project);
  const provider = normalizeSearchValue(query.provider);
  const workspace = normalizeSearchValue(query.workspace);
  const search = normalizeSearchValue(query.search);
  const filtered: SessionSummary[] = [];

  for (const item of sessions) {
    if (query.frozen !== undefined && item.frozen !== query.frozen) {
      continue;
    }
    if (query.status && item.statusEstimate !== query.status) {
      continue;
    }
    if (project && !item.projectName?.toLowerCase().includes(project)) {
      continue;
    }
    if (provider && !item.provider?.toLowerCase().includes(provider)) {
      continue;
    }
    if (workspace) {
      const workspaceHaystack = [item.workspaceId, item.workspaceLabel, item.cwd]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!workspaceHaystack.includes(workspace)) {
        continue;
      }
    }
    if (search) {
      const detail = options?.loadDetailText?.(item.threadId);
      const haystack = [
        item.threadId,
        item.projectName,
        item.workspaceLabel,
        item.workspaceId,
        item.officialName,
        item.candidateName,
        item.provider,
        item.model,
        item.statusEstimate,
        detail?.firstUserMessage,
        detail?.lastUserMessage,
        detail?.lastAgentMessage,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) {
        continue;
      }
    }
    filtered.push(item);
  }

  const sort = query.sort ?? "updatedAt";
  const order = query.order ?? "desc";
  return filtered.sort((left, right) => {
    const leftValue =
      sort === "project"
        ? (left.projectName ?? "")
        : sort === "officialName"
          ? (left.officialName ?? "")
          : (left.updatedAt ?? "");
    const rightValue =
      sort === "project"
        ? (right.projectName ?? "")
        : sort === "officialName"
          ? (right.officialName ?? "")
          : (right.updatedAt ?? "");

    const compare = String(leftValue).localeCompare(String(rightValue));
    return order === "asc" ? compare : -compare;
  });
}

export async function performScan(context: ManagerServiceContext): Promise<ScanReport> {
  const rolloutFiles = await discoverRolloutFiles(context.config.general.codexHome);
  let updatedSessions = 0;

  for (const rolloutPath of rolloutFiles) {
    const stat = await fs.stat(rolloutPath);
    const previousSession = context.db.getSessionByRolloutPath(rolloutPath);
    const previousCursor = context.db.getCursor(rolloutPath);
    if (
      previousCursor &&
      (previousSession?.tokenTotal ?? 0) > 0 &&
      previousCursor.lastSize === stat.size &&
      previousCursor.lastMtime === stat.mtime.toISOString()
    ) {
      continue;
    }

    const ingest = await ingestRolloutFile({
      rolloutPath,
      stat,
      previousSession,
      previousCursor: previousCursor
        ? {
            rolloutPath,
            lastOffset: previousCursor.lastOffset,
            lastSize: previousCursor.lastSize,
            lastMtime: previousCursor.lastMtime,
          }
        : undefined,
    });

    if (!ingest.session) {
      continue;
    }

    const previousRevision = context.db.getRevision(ingest.session.threadId);
    const revision = buildSessionRevision(
      ingest.session,
      {
        sizeBytes: stat.size,
        mtime: stat.mtime.toISOString(),
      },
      previousRevision,
    );

    context.db.upsertSession({
      session: ingest.session,
      revision,
      cursor: ingest.cursor,
    });

    updatedSessions += 1;
  }

  const sessionIndexSnapshot = await context.readSessionIndexSnapshot();
  context.db.updateOfficialNames(sessionIndexSnapshot.latestByThreadId);

  const now = new Date();
  const blockedOfficialThreadIds = getBlockedOfficialNameThreadIds(context.db, context.config);
  for (const session of context.db.listSessions()) {
    const rawDetail = context.db.getSessionDetail(session.threadId);
    if (!rawDetail) {
      continue;
    }
    const detail = applyOfficialNamingPolicy(rawDetail, blockedOfficialThreadIds);
    context.db.updateStatusEstimate(
      detail.threadId,
      estimateSessionStatus(detail, context.config, now),
    );
  }

  return {
    scannedRollouts: rolloutFiles.length,
    updatedSessions,
  };
}

export async function listSessions(
  context: ManagerServiceContext,
  options?: { dirty?: boolean },
): Promise<SessionSummary[]> {
  await context.scan();
  const blockedOfficialThreadIds = getBlockedOfficialNameThreadIds(context.db, context.config);
  return context.db
    .listSessions()
    .map((session) =>
      applyRuleSignatureState(
        applyOfficialNamingPolicy(session, blockedOfficialThreadIds),
        context.currentRuleSignature,
      ),
    )
    .filter((session) => (options?.dirty === undefined ? true : session.dirty === options.dirty));
}

export async function querySessions(
  context: ManagerServiceContext,
  query: SessionListQuery,
): Promise<SessionsResponse> {
  const allSessions = await listSessions(context, {
    dirty: query.dirty,
  });
  const workspaces = await listWorkspaces(context, {
    dirty: query.dirty,
  });
  const filteredSessions = filterAndSortSessions(allSessions, query, {
    loadDetailText: (threadId) => context.db.getSessionDetail(threadId),
  });
  const total = filteredSessions.length;
  const items =
    typeof query.limit === "number" ? filteredSessions.slice(0, query.limit) : filteredSessions;

  return {
    items,
    total,
    workspaces,
    counts: {
      dirty: allSessions.filter((item) => item.dirty).length,
      frozen: allSessions.filter((item) => item.frozen).length,
    },
    nextCursor: null,
  };
}

export async function listWorkspaces(
  context: ManagerServiceContext,
  options?: { dirty?: boolean },
): Promise<WorkspaceSummary[]> {
  await context.scan();
  return context.db.listWorkspaceSummaries(options);
}

export async function getSessionDetail(
  context: ManagerServiceContext,
  threadId: string,
  options?: { includeTranscript?: boolean },
): Promise<SessionDetail | undefined> {
  await context.scan();
  const detail = context.db.getSessionDetail(threadId);
  if (!detail) {
    return undefined;
  }
  const blockedOfficialThreadIds = getBlockedOfficialNameThreadIds(context.db, context.config);
  const normalizedDetail = applyRuleSignatureState(
    applyOfficialNamingPolicy(detail, blockedOfficialThreadIds),
    context.currentRuleSignature,
  );
  return {
    ...normalizedDetail,
    renameHistory: filterVisibleRenameHistory(context.db.getRenameHistory(threadId)),
    transcript: options?.includeTranscript
      ? await readSessionTranscript(detail.rolloutPath)
      : undefined,
  };
}

export async function getSessionTranscriptPage(
  context: ManagerServiceContext,
  threadId: string,
  options?: {
    page?: number;
    pageSize?: number;
    includeHidden?: boolean;
    role?: "all" | "user" | "assistant" | "tool" | "system";
    query?: string;
  },
) {
  await context.scan();
  const detail = context.db.getSessionDetail(threadId);
  if (!detail) {
    throw new Error(`Unknown session: ${threadId}`);
  }

  return readSessionTranscriptPage({
    rolloutPath: detail.rolloutPath,
    page: options?.page,
    pageSize: options?.pageSize,
    includeHidden: options?.includeHidden,
    role: options?.role,
    query: options?.query,
  });
}
