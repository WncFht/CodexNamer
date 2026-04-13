import type { RenameSuggestion, SessionDetail } from "@codexnamer/shared";
import { appendSessionIndexRename } from "../session-index.js";
import { toUtcIso } from "../util.js";
import {
  applyOfficialNamingPolicy,
  collectReservedOfficialNameKeys,
  ensureUniqueRenameSuggestion,
  getBlockedOfficialNameThreadIds,
  normalizeComparableName,
} from "./naming-policy.js";
import type { ManagerServiceContext } from "./shared.js";

export async function suggest(
  context: ManagerServiceContext,
  threadId: string,
): Promise<RenameSuggestion> {
  await context.scan();
  const detail = context.requireSessionDetail(threadId);
  const suggestion = await context.resolveSuggestionForDetail(detail);
  context.db.recordRename({
    threadId,
    newName: suggestion.name,
    source: suggestion.source,
    kind: suggestion.source === "manual" ? "manual" : "auto",
    status: "preview_only",
    operator: context.operator,
    appliedAt: suggestion.generatedAt,
    appliedRevision: detail.revision,
    ruleSignature: context.currentRuleSignature,
    autoApply: false,
  });
  return suggestion;
}

export async function apply(
  context: ManagerServiceContext,
  threadId: string,
  options?: {
    autoApply?: boolean;
    skipScan?: boolean;
    detail?: SessionDetail;
  },
): Promise<{ written: boolean; name: string }> {
  if (!options?.skipScan) {
    await context.scan();
  }
  const detail = options?.detail ?? context.requireSessionDetail(threadId);
  const renameState = context.db.getRenameState(threadId);
  const suggestion = await context.resolveSuggestionForDetail(detail);

  const result = await appendSessionIndexRename({
    filePath: context.sessionIndexPath,
    threadId,
    threadName: suggestion.name,
  });
  context.invalidateSessionIndexCache();
  const persistAppliedState =
    !result.written &&
    (renameState?.lastAppliedName !== suggestion.name ||
      renameState?.lastAppliedSource !== suggestion.source ||
      renameState?.lastAppliedRevision !== detail.revision);
  const appliedAt = persistAppliedState ? toUtcIso() : result.entry.updatedAt;
  context.db.recordRename({
    threadId,
    newName: suggestion.name,
    source: suggestion.source,
    kind: suggestion.source === "manual" ? "manual" : "auto",
    status: result.written ? "applied" : "skipped",
    reason: result.written ? undefined : "unchanged",
    operator: context.operator,
    appliedAt,
    appliedRevision: detail.revision,
    ruleSignature: suggestion.source === "manual" ? undefined : context.currentRuleSignature,
    autoApply: options?.autoApply ?? false,
    persistAppliedState,
  });

  return {
    written: result.written,
    name: result.entry.threadName,
  };
}

export async function rename(
  context: ManagerServiceContext,
  threadId: string,
  name: string,
): Promise<{ written: boolean; name: string }> {
  await context.scan();
  const detail = context.requireSessionDetail(threadId);
  const renameState = context.db.getRenameState(threadId);
  const uniqueName = ensureUniqueRenameSuggestion(context.db, context.config, threadId, {
    threadId,
    name,
    source: "manual",
    kind: "chore",
    summary: name,
    generatedAt: new Date().toISOString(),
  }).name;

  const result = await appendSessionIndexRename({
    filePath: context.sessionIndexPath,
    threadId,
    threadName: uniqueName,
  });
  context.invalidateSessionIndexCache();
  const persistAppliedState =
    !result.written &&
    (renameState?.lastAppliedName !== result.entry.threadName ||
      renameState?.lastAppliedSource !== "manual" ||
      renameState?.lastAppliedRevision !== detail.revision);
  const appliedAt = persistAppliedState ? toUtcIso() : result.entry.updatedAt;

  context.db.recordRename({
    threadId,
    newName: result.entry.threadName,
    source: "manual",
    kind: "manual",
    status: result.written ? "applied" : "skipped",
    reason: result.written ? undefined : "unchanged",
    operator: context.operator,
    appliedAt,
    appliedRevision: detail.revision,
    ruleSignature: undefined,
    autoApply: false,
    persistAppliedState,
  });

  return {
    written: result.written,
    name: result.entry.threadName,
  };
}

export async function batchApplyDirty(
  context: ManagerServiceContext,
  options?: { previewOnly?: boolean },
): Promise<
  Array<{
    threadId: string;
    action: "applied" | "skipped" | "preview";
    name?: string;
    reason?: string;
  }>
> {
  await context.scan();
  const dirtySessions = await context.listSessions({ dirty: true });
  const blockedOfficialThreadIds = getBlockedOfficialNameThreadIds(context.db, context.config);
  const reservedNameKeys = collectReservedOfficialNameKeys(context.db, context.config, {
    blockedOfficialThreadIds,
  });
  const results: Array<{
    threadId: string;
    action: "applied" | "skipped" | "preview";
    name?: string;
    reason?: string;
  }> = [];

  for (const session of dirtySessions) {
    const detail = context.db.getSessionDetail(session.threadId);
    if (!detail) {
      continue;
    }
    const normalizedDetail = applyOfficialNamingPolicy(detail, blockedOfficialThreadIds);
    if (normalizedDetail.frozen) {
      results.push({ threadId: normalizedDetail.threadId, action: "skipped", reason: "frozen" });
      continue;
    }
    const suggestion = await context.resolveSuggestionForDetail(normalizedDetail, {
      reservedNameKeys,
      blockedOfficialThreadIds,
    });
    reservedNameKeys.add(normalizeComparableName(suggestion.name));
    if (options?.previewOnly) {
      results.push({
        threadId: normalizedDetail.threadId,
        action: "preview",
        name: suggestion.name,
      });
      continue;
    }

    const applied = await apply(context, normalizedDetail.threadId, {
      skipScan: true,
      detail: normalizedDetail,
    });
    results.push({
      threadId: normalizedDetail.threadId,
      action: applied.written ? "applied" : "skipped",
      name: applied.name,
      reason: applied.written ? undefined : "unchanged",
    });
  }

  return results;
}
