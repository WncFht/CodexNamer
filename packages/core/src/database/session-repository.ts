import type Database from "better-sqlite3";
import type {
  MaterializedSession,
  RenameSource,
  SessionDetail,
  SessionIndexEntry,
  SessionRevision,
  SessionSummary,
  SessionStatusEstimate,
  WorkspaceSummary
} from "@codexnamer/shared";

import { buildWorkspaceSummaries } from "./overview-query-service.js";
import { isDirtySinceRename } from "../revision.js";
import { workspaceIdForCwd, workspaceLabelForCwd } from "../util.js";
import { type SessionRow, toBoolean } from "./shared.js";

export function getSessionByRolloutPath(db: Database.Database, rolloutPath: string): MaterializedSession | undefined {
  const row = db
    .prepare(
      `SELECT thread_id, rollout_path, cwd, project_name, created_at, updated_at,
              model_provider, model, first_user_message, last_user_message,
              last_agent_message, task_complete_count, token_total
       FROM sessions WHERE rollout_path = ?`
    )
    .get(rolloutPath) as SessionRow | undefined;

  if (!row) {
    return undefined;
  }

  return {
    threadId: row.thread_id,
    rolloutPath: row.rollout_path,
    cwd: row.cwd ?? undefined,
    projectName: row.project_name ?? undefined,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
    modelProvider: row.model_provider ?? undefined,
    model: row.model ?? undefined,
    firstUserMessage: row.first_user_message ?? undefined,
    lastUserMessage: row.last_user_message ?? undefined,
    lastAgentMessage: row.last_agent_message ?? undefined,
    taskCompleteCount: row.task_complete_count,
    tokenTotal: row.token_total
  };
}

export function getRevision(db: Database.Database, threadId: string): SessionRevision | undefined {
  const row = db
    .prepare(
      `SELECT current_revision, last_seen_rollout_size, last_seen_rollout_mtime,
              last_material_change_at, last_task_complete_count, last_agent_message_fingerprint
       FROM session_revisions WHERE thread_id = ?`
    )
    .get(threadId) as Record<string, unknown> | undefined;

  if (!row) {
    return undefined;
  }

  return {
    currentRevision: row.current_revision as string,
    lastSeenRolloutSize: row.last_seen_rollout_size as number,
    lastSeenRolloutMtime: (row.last_seen_rollout_mtime as string | null) ?? undefined,
    lastMaterialChangeAt: (row.last_material_change_at as string | null) ?? undefined,
    lastTaskCompleteCount: row.last_task_complete_count as number,
    lastAgentMessageFingerprint: (row.last_agent_message_fingerprint as string | null) ?? undefined
  };
}

export function getCursor(
  db: Database.Database,
  rolloutPath: string
): { lastOffset: number; lastSize: number; lastMtime?: string } | undefined {
  const row = db
    .prepare(
      `SELECT last_offset, last_size, last_mtime
       FROM ingest_cursors WHERE rollout_path = ?`
    )
    .get(rolloutPath) as Record<string, unknown> | undefined;

  if (!row) {
    return undefined;
  }

  return {
    lastOffset: row.last_offset as number,
    lastSize: row.last_size as number,
    lastMtime: (row.last_mtime as string | null) ?? undefined
  };
}

function getRenameStateForDirtyCheck(db: Database.Database, threadId: string) {
  return db.prepare(`SELECT last_applied_revision FROM rename_state WHERE thread_id = ?`).get(threadId) as
    | Record<string, unknown>
    | undefined;
}

export function upsertSession(
  db: Database.Database,
  params: {
    session: MaterializedSession;
    revision: SessionRevision;
    cursor: { rolloutPath: string; lastOffset: number; lastSize: number; lastMtime?: string; lastScanAt?: string };
  }
): void {
  const { session, revision, cursor } = params;
  const transaction = db.transaction(() => {
    db
      .prepare(
        `INSERT INTO sessions (
          thread_id, rollout_path, cwd, project_name, created_at, updated_at,
          model_provider, model, first_user_message, last_user_message,
          last_agent_message, task_complete_count, token_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          rollout_path = excluded.rollout_path,
          cwd = excluded.cwd,
          project_name = excluded.project_name,
          created_at = COALESCE(excluded.created_at, sessions.created_at),
          updated_at = excluded.updated_at,
          model_provider = COALESCE(excluded.model_provider, sessions.model_provider),
          model = COALESCE(excluded.model, sessions.model),
          first_user_message = COALESCE(sessions.first_user_message, excluded.first_user_message),
          last_user_message = COALESCE(excluded.last_user_message, sessions.last_user_message),
          last_agent_message = COALESCE(excluded.last_agent_message, sessions.last_agent_message),
          task_complete_count = excluded.task_complete_count,
          token_total = excluded.token_total`
      )
      .run(
        session.threadId,
        session.rolloutPath,
        session.cwd ?? null,
        session.projectName ?? null,
        session.createdAt ?? null,
        session.updatedAt ?? null,
        session.modelProvider ?? null,
        session.model ?? null,
        session.firstUserMessage ?? null,
        session.lastUserMessage ?? null,
        session.lastAgentMessage ?? null,
        session.taskCompleteCount,
        session.tokenTotal
      );

    db
      .prepare(
        `INSERT INTO session_revisions (
          thread_id, current_revision, last_seen_rollout_size, last_seen_rollout_mtime,
          last_material_change_at, last_task_complete_count, last_agent_message_fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          current_revision = excluded.current_revision,
          last_seen_rollout_size = excluded.last_seen_rollout_size,
          last_seen_rollout_mtime = excluded.last_seen_rollout_mtime,
          last_material_change_at = excluded.last_material_change_at,
          last_task_complete_count = excluded.last_task_complete_count,
          last_agent_message_fingerprint = excluded.last_agent_message_fingerprint`
      )
      .run(
        session.threadId,
        revision.currentRevision,
        revision.lastSeenRolloutSize,
        revision.lastSeenRolloutMtime ?? null,
        revision.lastMaterialChangeAt ?? null,
        revision.lastTaskCompleteCount,
        revision.lastAgentMessageFingerprint ?? null
      );

    db
      .prepare(
        `INSERT INTO ingest_cursors (rollout_path, last_offset, last_size, last_mtime, last_scan_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(rollout_path) DO UPDATE SET
          last_offset = excluded.last_offset,
          last_size = excluded.last_size,
          last_mtime = excluded.last_mtime,
          last_scan_at = excluded.last_scan_at`
      )
      .run(
        cursor.rolloutPath,
        cursor.lastOffset,
        cursor.lastSize,
        cursor.lastMtime ?? null,
        cursor.lastScanAt ?? null
      );

    db
      .prepare(
        `INSERT INTO rename_state (thread_id, dirty_since_rename)
         VALUES (?, 1)
         ON CONFLICT(thread_id) DO NOTHING`
      )
      .run(session.threadId);

    const renameState = getRenameStateForDirtyCheck(db, session.threadId);
    const dirty = isDirtySinceRename(revision.currentRevision, (renameState?.last_applied_revision as string | null) ?? undefined);
    db.prepare(`UPDATE rename_state SET dirty_since_rename = ? WHERE thread_id = ?`).run(dirty ? 1 : 0, session.threadId);
  });

  transaction();
}

export function updateOfficialNames(db: Database.Database, snapshot: Map<string, SessionIndexEntry>): void {
  const transaction = db.transaction(() => {
    for (const entry of snapshot.values()) {
      db
        .prepare(
          `UPDATE sessions
           SET latest_official_name = ?, latest_official_name_updated_at = ?
           WHERE thread_id = ?`
        )
        .run(entry.threadName, entry.updatedAt, entry.id);
    }
  });

  transaction();
}

export function updateStatusEstimate(db: Database.Database, threadId: string, status: SessionStatusEstimate): void {
  db.prepare(`UPDATE sessions SET status_estimate = ? WHERE thread_id = ?`).run(status, threadId);
}

export function listSessions(db: Database.Database, filters?: { dirty?: boolean }): SessionSummary[] {
  const rows = db
    .prepare(
      `SELECT s.thread_id, s.cwd, s.project_name, s.first_user_message, s.updated_at, s.latest_official_name,
              s.model_provider, s.model, s.task_complete_count, s.status_estimate,
              rs.current_candidate_name, rs.current_candidate_rule_signature, rs.last_applied_source,
              rs.last_applied_revision, rs.last_applied_rule_signature, rs.frozen, rs.force_rewrite,
              rs.dirty_since_rename
       FROM sessions s
       LEFT JOIN rename_state rs ON rs.thread_id = s.thread_id
       ORDER BY COALESCE(s.updated_at, s.created_at) DESC`
    )
    .all() as Array<Record<string, unknown>>;

  return rows
    .map((row) => ({
      threadId: row.thread_id as string,
      cwd: (row.cwd as string | null) ?? undefined,
      projectName: (row.project_name as string | null) ?? undefined,
      firstUserMessage: (row.first_user_message as string | null) ?? undefined,
      workspaceId: workspaceIdForCwd((row.cwd as string | null) ?? undefined),
      workspaceLabel: workspaceLabelForCwd(
        (row.cwd as string | null) ?? undefined,
        (row.project_name as string | null) ?? undefined
      ),
      updatedAt: (row.updated_at as string | null) ?? undefined,
      officialName: (row.latest_official_name as string | null) ?? undefined,
      candidateName: (row.current_candidate_name as string | null) ?? undefined,
      candidateRuleSignature: (row.current_candidate_rule_signature as string | null) ?? undefined,
      dirty: toBoolean(row.dirty_since_rename as number | null) || toBoolean(row.force_rewrite as number | null),
      frozen: toBoolean(row.frozen as number | null),
      taskCompleteCount: Number(row.task_complete_count ?? 0),
      provider: (row.model_provider as string | null) ?? undefined,
      model: (row.model as string | null) ?? undefined,
      lastAppliedSource: (row.last_applied_source as RenameSource | null) ?? undefined,
      statusEstimate: (row.status_estimate as SessionStatusEstimate | null) ?? undefined,
      lastAppliedRuleSignature: (row.last_applied_rule_signature as string | null) ?? undefined
    }))
    .filter((row) => (filters?.dirty === undefined ? true : row.dirty === filters.dirty));
}

export function listWorkspaceSummaries(db: Database.Database, filters?: { dirty?: boolean }): WorkspaceSummary[] {
  return buildWorkspaceSummaries(listSessions(db, filters));
}

export function getSessionDetail(db: Database.Database, threadId: string): SessionDetail | undefined {
  const row = db
    .prepare(
      `SELECT s.thread_id, s.rollout_path, s.cwd, s.project_name, s.created_at, s.updated_at,
              s.model_provider, s.model, s.first_user_message, s.last_user_message,
              s.last_agent_message, s.task_complete_count, s.token_total, s.latest_official_name,
              s.status_estimate, sr.current_revision, rs.current_candidate_name,
              rs.current_candidate_rule_signature, rs.last_applied_at,
              rs.last_applied_revision, rs.last_applied_rule_signature,
              rs.last_applied_source, rs.frozen, rs.force_rewrite, rs.dirty_since_rename
       FROM sessions s
       LEFT JOIN session_revisions sr ON sr.thread_id = s.thread_id
       LEFT JOIN rename_state rs ON rs.thread_id = s.thread_id
       WHERE s.thread_id = ?`
    )
    .get(threadId) as SessionRow | undefined;

  if (!row) {
    return undefined;
  }

  return {
    threadId: row.thread_id,
    rolloutPath: row.rollout_path,
    cwd: row.cwd ?? undefined,
    projectName: row.project_name ?? undefined,
    workspaceId: workspaceIdForCwd(row.cwd ?? undefined),
    workspaceLabel: workspaceLabelForCwd(row.cwd ?? undefined, row.project_name ?? undefined),
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
    officialName: row.latest_official_name ?? undefined,
    candidateName: row.current_candidate_name ?? undefined,
    candidateRuleSignature: row.current_candidate_rule_signature ?? undefined,
    dirty: toBoolean(row.dirty_since_rename as number | null) || toBoolean(row.force_rewrite as number | null),
    frozen: toBoolean(row.frozen as number | null),
    taskCompleteCount: row.task_complete_count,
    provider: row.model_provider ?? undefined,
    model: row.model ?? undefined,
    lastAppliedSource: row.last_applied_source ?? undefined,
    statusEstimate: (row.status_estimate as SessionStatusEstimate | null) ?? undefined,
    firstUserMessage: row.first_user_message ?? undefined,
    lastUserMessage: row.last_user_message ?? undefined,
    lastAgentMessage: row.last_agent_message ?? undefined,
    tokenTotal: row.token_total,
    revision: row.current_revision ?? undefined,
    lastAppliedAt: row.last_applied_at ?? undefined,
    lastAppliedRevision: row.last_applied_revision ?? undefined,
    lastAppliedRuleSignature: row.last_applied_rule_signature ?? undefined
  };
}

export function getDirtySessions(db: Database.Database): SessionSummary[] {
  return listSessions(db, { dirty: true });
}
