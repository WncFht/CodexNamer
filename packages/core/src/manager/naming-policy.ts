import type {
  EffectiveConfig,
  RenameHistoryRecord,
  RenameSuggestion,
  SessionDetail,
  SessionSummary
} from "@codexnamer/shared";

import type { StateDatabase } from "../database.js";

export const ACCEPTED_OFFICIAL_RENAME_SOURCES = ["ai", "manual"] as const;

export function normalizeComparableName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function splitDisambiguationBase(name: string): { root: string; nextIndex: number } {
  const trimmed = name.trim();
  const match = trimmed.match(/^(.*)\s+\((\d+)\)$/);
  if (!match || !match[1]?.trim()) {
    return {
      root: trimmed,
      nextIndex: 2
    };
  }

  return {
    root: match[1].trimEnd(),
    nextIndex: Number(match[2]) + 1
  };
}

function appendDisambiguationSuffix(name: string, index: number, maxLength: number): string {
  const suffix = ` (${index})`;
  const budget = Math.max(1, maxLength - suffix.length);
  const trimmedRoot = name.trim();
  const root = trimmedRoot.length > budget ? trimmedRoot.slice(0, budget).trimEnd() : trimmedRoot;
  return `${root}${suffix}`;
}

export function summarizeRuleStatus(params: {
  lastAppliedSource?: string;
  lastAppliedRuleSignature?: string;
  currentRuleSignature: string;
}): "latest" | "outdated" | "manual" | "unknown" {
  if (params.lastAppliedSource === "manual") {
    return "manual";
  }
  if (!params.lastAppliedRuleSignature) {
    return "unknown";
  }
  return params.lastAppliedRuleSignature === params.currentRuleSignature ? "latest" : "outdated";
}

export function shouldTreatNonAcceptedNamesAsUnnamed(config: EffectiveConfig): boolean {
  return config.ai.backend !== "none";
}

export function isAcceptedOfficialRenameSource(source?: string): boolean {
  return source === "ai" || source === "manual";
}

export function requiresAcceptedRewrite(config: EffectiveConfig, renameState?: { lastAppliedSource?: string }): boolean {
  return (
    shouldTreatNonAcceptedNamesAsUnnamed(config) &&
    Boolean(renameState?.lastAppliedSource) &&
    !isAcceptedOfficialRenameSource(renameState?.lastAppliedSource)
  );
}

export function getNonAcceptedNamedThreadIds(db: StateDatabase, config: EffectiveConfig): Set<string> {
  if (!shouldTreatNonAcceptedNamesAsUnnamed(config)) {
    return new Set<string>();
  }
  return db.listNonAcceptedNamedThreadIds([...ACCEPTED_OFFICIAL_RENAME_SOURCES]);
}

export function getDuplicateAcceptedNamedThreadIds(db: StateDatabase): Set<string> {
  const groups = new Map<string, Array<{ threadId: string; appliedAt?: string }>>();

  for (const session of db.listSessions()) {
    if (!session.officialName) {
      continue;
    }
    const renameState = db.getRenameState(session.threadId);
    if (!isAcceptedOfficialRenameSource(renameState?.lastAppliedSource)) {
      continue;
    }
    const key = normalizeComparableName(session.officialName);
    if (!key) {
      continue;
    }
    const group = groups.get(key) ?? [];
    group.push({
      threadId: session.threadId,
      appliedAt: renameState?.lastAppliedAt
    });
    groups.set(key, group);
  }

  const duplicateThreadIds = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    group
      .sort(
        (left, right) => (left.appliedAt ?? "").localeCompare(right.appliedAt ?? "") || left.threadId.localeCompare(right.threadId)
      )
      .slice(1)
      .forEach((item) => duplicateThreadIds.add(item.threadId));
  }
  return duplicateThreadIds;
}

export function getBlockedOfficialNameThreadIds(db: StateDatabase, config: EffectiveConfig): Set<string> {
  return new Set<string>([...getNonAcceptedNamedThreadIds(db, config), ...getDuplicateAcceptedNamedThreadIds(db)]);
}

export function collectReservedOfficialNameKeys(
  db: StateDatabase,
  config: EffectiveConfig,
  options?: {
    excludeThreadId?: string;
    blockedOfficialThreadIds?: Set<string>;
  }
): Set<string> {
  const blockedOfficialThreadIds = options?.blockedOfficialThreadIds ?? getBlockedOfficialNameThreadIds(db, config);
  const reserved = new Set<string>();

  for (const session of db.listSessions()) {
    if (!session.officialName || session.threadId === options?.excludeThreadId) {
      continue;
    }
    if (blockedOfficialThreadIds.has(session.threadId)) {
      continue;
    }
    reserved.add(normalizeComparableName(session.officialName));
  }

  return reserved;
}

export function ensureUniqueName(
  db: StateDatabase,
  config: EffectiveConfig,
  rawName: string,
  threadId: string,
  options?: {
    reservedNameKeys?: Set<string>;
    blockedOfficialThreadIds?: Set<string>;
  }
): string {
  const trimmed = rawName.trim();
  if (!trimmed) {
    return trimmed;
  }

  const reservedNameKeys = new Set<string>(options?.reservedNameKeys ?? []);
  for (
    const key of collectReservedOfficialNameKeys(db, config, {
      excludeThreadId: threadId,
      blockedOfficialThreadIds: options?.blockedOfficialThreadIds
    })
  ) {
    reservedNameKeys.add(key);
  }

  if (!reservedNameKeys.has(normalizeComparableName(trimmed))) {
    return trimmed;
  }

  const { root, nextIndex } = splitDisambiguationBase(trimmed);
  const maxLength = Math.max(8, config.naming.maxLength);
  let index = nextIndex;
  while (true) {
    const candidate = appendDisambiguationSuffix(root, index, maxLength);
    if (!reservedNameKeys.has(normalizeComparableName(candidate))) {
      return candidate;
    }
    index += 1;
  }
}

export function ensureUniqueRenameSuggestion(
  db: StateDatabase,
  config: EffectiveConfig,
  threadId: string,
  suggestion: RenameSuggestion,
  options?: {
    reservedNameKeys?: Set<string>;
    blockedOfficialThreadIds?: Set<string>;
  }
): RenameSuggestion {
  const uniqueName = ensureUniqueName(db, config, suggestion.name, threadId, options);
  if (uniqueName === suggestion.name) {
    return suggestion;
  }

  return {
    ...suggestion,
    name: uniqueName,
    metadata: {
      ...(suggestion.metadata ?? {}),
      deduplicated: "true"
    }
  };
}

export function applyRuleSignatureState<T extends SessionSummary | SessionDetail>(
  session: T,
  currentRuleSignature: string
): T {
  return {
    ...session,
    currentRuleSignature,
    ruleStatus: summarizeRuleStatus({
      lastAppliedSource: session.lastAppliedSource,
      lastAppliedRuleSignature: session.lastAppliedRuleSignature,
      currentRuleSignature
    })
  };
}

export function applyOfficialNamingPolicy<T extends SessionSummary | SessionDetail>(
  session: T,
  nonAcceptedNamedThreadIds: Set<string>
): T {
  const pendingAcceptedRewrite = nonAcceptedNamedThreadIds.has(session.threadId);
  return {
    ...session,
    officialName: pendingAcceptedRewrite ? undefined : session.officialName,
    dirty: session.dirty || pendingAcceptedRewrite
  };
}

export function filterVisibleRenameHistory(history: RenameHistoryRecord[]): RenameHistoryRecord[] {
  return history.filter((entry) => entry.status === "preview_only" || isAcceptedOfficialRenameSource(entry.source));
}
