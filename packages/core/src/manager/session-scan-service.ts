import fs from "node:fs/promises";

import type {
  ScanReport,
  SessionDetail,
  SessionSummary,
  WorkspaceSummary
} from "@codexnamer/shared";

import { estimateSessionStatus } from "../auto-rename.js";
import {
  applyOfficialNamingPolicy,
  applyRuleSignatureState,
  filterVisibleRenameHistory,
  getBlockedOfficialNameThreadIds
} from "./naming-policy.js";
import { buildSessionRevision } from "../revision.js";
import { discoverRolloutFiles, ingestRolloutFile, readSessionTranscript, readSessionTranscriptPage } from "../rollout.js";
import type { ManagerServiceContext } from "./shared.js";

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
            lastMtime: previousCursor.lastMtime
          }
        : undefined
    });

    if (!ingest.session) {
      continue;
    }

    const previousRevision = context.db.getRevision(ingest.session.threadId);
    const revision = buildSessionRevision(
      ingest.session,
      {
        sizeBytes: stat.size,
        mtime: stat.mtime.toISOString()
      },
      previousRevision
    );

    context.db.upsertSession({
      session: ingest.session,
      revision,
      cursor: ingest.cursor
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
    context.db.updateStatusEstimate(detail.threadId, estimateSessionStatus(detail, context.config, now));
  }

  return {
    scannedRollouts: rolloutFiles.length,
    updatedSessions
  };
}

export async function listSessions(
  context: ManagerServiceContext,
  options?: { dirty?: boolean }
): Promise<SessionSummary[]> {
  await context.scan();
  const blockedOfficialThreadIds = getBlockedOfficialNameThreadIds(context.db, context.config);
  return context.db
    .listSessions()
    .map((session) =>
      applyRuleSignatureState(applyOfficialNamingPolicy(session, blockedOfficialThreadIds), context.currentRuleSignature)
    )
    .filter((session) => (options?.dirty === undefined ? true : session.dirty === options.dirty));
}

export async function listWorkspaces(
  context: ManagerServiceContext,
  options?: { dirty?: boolean }
): Promise<WorkspaceSummary[]> {
  await context.scan();
  return context.db.listWorkspaceSummaries(options);
}

export async function getSessionDetail(
  context: ManagerServiceContext,
  threadId: string,
  options?: { includeTranscript?: boolean }
): Promise<SessionDetail | undefined> {
  await context.scan();
  const detail = context.db.getSessionDetail(threadId);
  if (!detail) {
    return undefined;
  }
  const blockedOfficialThreadIds = getBlockedOfficialNameThreadIds(context.db, context.config);
  const normalizedDetail = applyRuleSignatureState(
    applyOfficialNamingPolicy(detail, blockedOfficialThreadIds),
    context.currentRuleSignature
  );
  return {
    ...normalizedDetail,
    renameHistory: filterVisibleRenameHistory(context.db.getRenameHistory(threadId)),
    transcript: options?.includeTranscript ? await readSessionTranscript(detail.rolloutPath) : undefined
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
  }
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
    query: options?.query
  });
}
