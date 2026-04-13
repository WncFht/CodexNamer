import type {
  RenameHistoryKind,
  RenameHistoryRecord,
  RenameSource,
  RenameStateRecord,
} from "@codexnamer/shared";
import type Database from "better-sqlite3";

import { toBoolean } from "./shared.js";

export function getRenameState(
  db: Database.Database,
  threadId: string,
): RenameStateRecord | undefined {
  const row = db.prepare(`SELECT * FROM rename_state WHERE thread_id = ?`).get(threadId) as
    | Record<string, unknown>
    | undefined;

  if (!row) {
    return undefined;
  }

  return {
    threadId,
    currentCandidateName: (row.current_candidate_name as string | null) ?? undefined,
    currentCandidateSource: (row.current_candidate_source as RenameSource | null) ?? undefined,
    currentCandidateGeneratedAt: (row.current_candidate_generated_at as string | null) ?? undefined,
    currentCandidateRuleSignature:
      (row.current_candidate_rule_signature as string | null) ?? undefined,
    lastAutoName: (row.last_auto_name as string | null) ?? undefined,
    lastManualName: (row.last_manual_name as string | null) ?? undefined,
    lastAppliedName: (row.last_applied_name as string | null) ?? undefined,
    lastAppliedSource: (row.last_applied_source as RenameSource | null) ?? undefined,
    lastAppliedAt: (row.last_applied_at as string | null) ?? undefined,
    lastAppliedRevision: (row.last_applied_revision as string | null) ?? undefined,
    lastAppliedRuleSignature: (row.last_applied_rule_signature as string | null) ?? undefined,
    dirtySinceRename: toBoolean(row.dirty_since_rename as number | null),
    forceRewrite: toBoolean(row.force_rewrite as number | null),
    frozen: toBoolean(row.frozen as number | null),
    autoApplyCount: Number(row.auto_apply_count ?? 0),
    lastAutoApplyAttemptAt: (row.last_auto_apply_attempt_at as string | null) ?? undefined,
    lastAutoApplySuccessAt: (row.last_auto_apply_success_at as string | null) ?? undefined,
    lastSkipReason: (row.last_skip_reason as string | null) ?? undefined,
  };
}

export function saveCandidate(
  db: Database.Database,
  threadId: string,
  suggestion: { name: string; source: RenameSource; generatedAt: string; ruleSignature?: string },
): void {
  db.prepare(
    `INSERT INTO rename_state (
       thread_id, current_candidate_name, current_candidate_source, current_candidate_generated_at,
       current_candidate_rule_signature, dirty_since_rename
     )
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(thread_id) DO UPDATE SET
       current_candidate_name = excluded.current_candidate_name,
       current_candidate_source = excluded.current_candidate_source,
       current_candidate_generated_at = excluded.current_candidate_generated_at,
       current_candidate_rule_signature = excluded.current_candidate_rule_signature`,
  ).run(
    threadId,
    suggestion.name,
    suggestion.source,
    suggestion.generatedAt,
    suggestion.ruleSignature ?? null,
  );
}

export function clearCandidate(db: Database.Database, threadId: string): void {
  db.prepare(
    `UPDATE rename_state
     SET current_candidate_name = NULL,
         current_candidate_source = NULL,
         current_candidate_generated_at = NULL,
         current_candidate_rule_signature = NULL
     WHERE thread_id = ?`,
  ).run(threadId);
}

export function clearAllCandidates(db: Database.Database): void {
  db.prepare(
    `UPDATE rename_state
     SET current_candidate_name = NULL,
         current_candidate_source = NULL,
         current_candidate_generated_at = NULL,
         current_candidate_rule_signature = NULL`,
  ).run();
}

function getLatestRenameHistoryRow(
  db: Database.Database,
  threadId: string,
): Record<string, unknown> | undefined {
  return db
    .prepare(
      `SELECT kind, old_name, new_name, source, status, reason, applied_at, applied_revision, operator, rule_signature
     FROM rename_history
     WHERE thread_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    )
    .get(threadId) as Record<string, unknown> | undefined;
}

export function recordRename(
  db: Database.Database,
  params: {
    threadId: string;
    newName: string;
    source: RenameSource;
    kind: RenameHistoryKind;
    status: "applied" | "skipped" | "failed" | "preview_only";
    reason?: string;
    operator: string;
    appliedAt: string;
    appliedRevision?: string;
    ruleSignature?: string;
    autoApply?: boolean;
    persistAppliedState?: boolean;
  },
): void {
  const previous = getRenameState(db, params.threadId);
  const transaction = db.transaction(() => {
    const oldName = previous?.lastAppliedName ?? null;
    const reason = params.reason ?? null;
    const appliedRevision = params.appliedRevision ?? null;
    const latest = getLatestRenameHistoryRow(db, params.threadId);
    const isDuplicateLatestHistory =
      latest &&
      latest.kind === params.kind &&
      (latest.old_name ?? null) === oldName &&
      latest.new_name === params.newName &&
      latest.source === params.source &&
      latest.status === params.status &&
      (latest.reason ?? null) === reason &&
      latest.applied_at === params.appliedAt &&
      (latest.applied_revision ?? null) === appliedRevision &&
      (latest.rule_signature ?? null) === (params.ruleSignature ?? null) &&
      (latest.operator ?? null) === params.operator;

    if (!isDuplicateLatestHistory) {
      db.prepare(
        `INSERT INTO rename_history (
          thread_id, kind, old_name, new_name, source, status, reason, applied_at, applied_revision, operator, rule_signature
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        params.threadId,
        params.kind,
        oldName,
        params.newName,
        params.source,
        params.status,
        reason,
        params.appliedAt,
        appliedRevision,
        params.operator,
        params.ruleSignature ?? null,
      );
    }

    if (params.status === "applied" || params.persistAppliedState) {
      db.prepare(
        `INSERT INTO rename_state (
          thread_id, last_applied_name, last_applied_source, last_applied_at,
          last_applied_revision, last_applied_rule_signature, dirty_since_rename, force_rewrite, auto_apply_count,
          last_auto_name, last_manual_name, last_auto_apply_success_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          last_applied_name = excluded.last_applied_name,
          last_applied_source = excluded.last_applied_source,
          last_applied_at = excluded.last_applied_at,
          last_applied_revision = excluded.last_applied_revision,
          last_applied_rule_signature = excluded.last_applied_rule_signature,
          dirty_since_rename = 0,
          force_rewrite = 0,
          auto_apply_count = excluded.auto_apply_count,
          last_auto_name = excluded.last_auto_name,
          last_manual_name = excluded.last_manual_name,
          last_auto_apply_success_at = excluded.last_auto_apply_success_at`,
      ).run(
        params.threadId,
        params.newName,
        params.source,
        params.appliedAt,
        params.appliedRevision ?? null,
        params.ruleSignature ?? null,
        params.autoApply ? (previous?.autoApplyCount ?? 0) + 1 : (previous?.autoApplyCount ?? 0),
        params.autoApply ? params.newName : (previous?.lastAutoName ?? null),
        params.source === "manual" ? params.newName : (previous?.lastManualName ?? null),
        params.autoApply ? params.appliedAt : (previous?.lastAutoApplySuccessAt ?? null),
      );

      db.prepare(
        `UPDATE sessions
         SET latest_official_name = ?, latest_official_name_updated_at = ?
         WHERE thread_id = ?`,
      ).run(params.newName, params.appliedAt, params.threadId);
    }
  });

  transaction();
}

export function listNonAcceptedNamedThreadIds(
  db: Database.Database,
  acceptedSources: RenameSource[],
): Set<string> {
  const rows = db
    .prepare(
      `SELECT thread_id
     FROM rename_state
     WHERE last_applied_name IS NOT NULL
       AND COALESCE(last_applied_source, '') NOT IN (${acceptedSources.map(() => "?").join(", ")})`,
    )
    .all(...acceptedSources) as Array<Record<string, unknown>>;

  return new Set(
    rows
      .map((row) => (typeof row.thread_id === "string" ? row.thread_id : undefined))
      .filter((value): value is string => Boolean(value)),
  );
}

export function getRenameHistory(db: Database.Database, threadId: string): RenameHistoryRecord[] {
  return db
    .prepare(
      `SELECT kind, old_name, new_name, source, status, reason, applied_at, applied_revision, operator, rule_signature
       FROM rename_history WHERE thread_id = ? ORDER BY applied_at DESC`,
    )
    .all(threadId)
    .map((row) => {
      const item = row as Record<string, unknown>;
      return {
        kind: item.kind as RenameHistoryKind,
        oldName: (item.old_name as string | null) ?? undefined,
        newName: item.new_name as string,
        source: item.source as RenameSource,
        status: item.status as RenameHistoryRecord["status"],
        reason: (item.reason as string | null) ?? undefined,
        appliedAt: item.applied_at as string,
        appliedRevision: (item.applied_revision as string | null) ?? undefined,
        ruleSignature: (item.rule_signature as string | null) ?? undefined,
        operator: (item.operator as string | null) ?? undefined,
      } satisfies RenameHistoryRecord;
    });
}

export function setFrozen(db: Database.Database, threadId: string, frozen: boolean): void {
  db.prepare(
    `INSERT INTO rename_state (thread_id, frozen)
     VALUES (?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET frozen = excluded.frozen`,
  ).run(threadId, frozen ? 1 : 0);
}

export function listRenameReplayCandidatesSince(
  db: Database.Database,
  params: {
    since: string;
    basis: "session-updated-at" | "last-applied-at";
  },
): Array<{
  threadId: string;
  updatedAt?: string;
  officialName?: string;
  currentRevision?: string;
  lastAppliedRevision?: string;
  lastAppliedSource?: RenameSource;
  lastAppliedRuleSignature?: string;
  frozen: boolean;
  dirty: boolean;
}> {
  const selectSql =
    params.basis === "last-applied-at"
      ? `SELECT s.thread_id, s.updated_at, s.created_at, s.latest_official_name, sr.current_revision,
                rs.last_applied_revision, rs.last_applied_source, rs.last_applied_rule_signature,
                rs.frozen, rs.dirty_since_rename, rs.force_rewrite
         FROM sessions s
         JOIN rename_state rs ON rs.thread_id = s.thread_id
         LEFT JOIN session_revisions sr ON sr.thread_id = s.thread_id
         WHERE rs.last_applied_at IS NOT NULL
           AND rs.last_applied_at >= ?`
      : `SELECT s.thread_id, s.updated_at, s.created_at, s.latest_official_name, sr.current_revision,
                rs.last_applied_revision, rs.last_applied_source, rs.last_applied_rule_signature,
                rs.frozen, rs.dirty_since_rename, rs.force_rewrite
         FROM sessions s
         LEFT JOIN rename_state rs ON rs.thread_id = s.thread_id
         LEFT JOIN session_revisions sr ON sr.thread_id = s.thread_id
         WHERE COALESCE(s.updated_at, s.created_at) >= ?`;

  const rows = db.prepare(selectSql).all(params.since) as Array<Record<string, unknown>>;
  return rows
    .map((row) => ({
      threadId: row.thread_id as string,
      updatedAt:
        (row.updated_at as string | null) ?? (row.created_at as string | null) ?? undefined,
      officialName: (row.latest_official_name as string | null) ?? undefined,
      currentRevision: (row.current_revision as string | null) ?? undefined,
      lastAppliedRevision: (row.last_applied_revision as string | null) ?? undefined,
      lastAppliedSource: (row.last_applied_source as RenameSource | null) ?? undefined,
      lastAppliedRuleSignature: (row.last_applied_rule_signature as string | null) ?? undefined,
      frozen: toBoolean(row.frozen as number | null),
      dirty:
        toBoolean(row.dirty_since_rename as number | null) ||
        toBoolean(row.force_rewrite as number | null),
    }))
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
}

export function queueRenameReplayThreadIds(
  db: Database.Database,
  threadIds: string[],
): { queued: number; clearedCandidates: number; matchedThreadIds: string[] } {
  if (threadIds.length === 0) {
    return {
      queued: 0,
      clearedCandidates: 0,
      matchedThreadIds: [],
    };
  }

  const transaction = db.transaction(() => {
    for (const threadId of threadIds) {
      db.prepare(
        `INSERT INTO rename_state (
           thread_id, dirty_since_rename, force_rewrite, current_candidate_name, current_candidate_source,
           current_candidate_generated_at, current_candidate_rule_signature
         )
         VALUES (?, 1, 1, NULL, NULL, NULL, NULL)
         ON CONFLICT(thread_id) DO UPDATE SET
           dirty_since_rename = 1,
           force_rewrite = 1,
           current_candidate_name = NULL,
           current_candidate_source = NULL,
           current_candidate_generated_at = NULL,
           current_candidate_rule_signature = NULL`,
      ).run(threadId);
    }
  });

  transaction();

  return {
    queued: threadIds.length,
    clearedCandidates: threadIds.length,
    matchedThreadIds: threadIds,
  };
}
