import fs from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";
import type {
  AiBackend,
  AiRequestLogDetail,
  AiRequestLogRecord,
  AiRequestLogReport,
  AiRequestStatus,
  AiRequestTransport,
  EffectiveConfig,
  MaterializedSession,
  OverviewReport,
  RenameHistoryRecord,
  RenameHistoryKind,
  RenameSuggestion,
  RenameSource,
  RenameStateRecord,
  SessionDetail,
  SessionIndexEntry,
  SessionRevision,
  SessionSummary,
  SessionStatusEstimate,
  WorkspaceSummary
} from "@codexnamer/shared";

import {
  finishAiRequestLog as finishAiRequestLogEntry,
  getAiRequestLogDetail as getAiRequestLogDetailView,
  getAiRequestLogReport as getAiRequestLogReportView,
  startAiRequestLog as startAiRequestLogEntry
} from "./database/ai-request-logs.js";
import {
  buildWorkspaceSummaries,
  getOverviewReport as buildOverviewReport
} from "./database/overview-report.js";
import { isDirtySinceRename } from "./revision.js";
import { workspaceIdForCwd, workspaceLabelForCwd } from "./util.js";

type SessionRow = {
  thread_id: string;
  rollout_path: string;
  cwd: string | null;
  project_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  model_provider: string | null;
  model: string | null;
  first_user_message: string | null;
  last_user_message: string | null;
  last_agent_message: string | null;
  task_complete_count: number;
  token_total: number;
  latest_official_name: string | null;
  latest_official_name_updated_at: string | null;
  status_estimate: string | null;
  archived_hint: number;
  current_revision: string | null;
  current_candidate_name: string | null;
  current_candidate_rule_signature: string | null;
  dirty_since_rename: number | null;
  force_rewrite: number | null;
  last_applied_name: string | null;
  last_applied_source: RenameSource | null;
  last_applied_revision: string | null;
  last_applied_at: string | null;
  last_applied_rule_signature: string | null;
  frozen: number | null;
};

function toBoolean(value: number | null | undefined): boolean {
  return value === 1;
}

export class StateDatabase {
  private readonly db: Database.Database;

  constructor(public readonly dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.migrate();
  }

  static async create(dbPath: string): Promise<StateDatabase> {
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    return new StateDatabase(dbPath);
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        thread_id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        cwd TEXT,
        project_name TEXT,
        created_at TEXT,
        updated_at TEXT,
        model_provider TEXT,
        model TEXT,
        first_user_message TEXT,
        last_user_message TEXT,
        last_agent_message TEXT,
        task_complete_count INTEGER NOT NULL DEFAULT 0,
        token_total INTEGER NOT NULL DEFAULT 0,
        latest_official_name TEXT,
        latest_official_name_updated_at TEXT,
        status_estimate TEXT,
        archived_hint INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS session_revisions (
        thread_id TEXT PRIMARY KEY,
        current_revision TEXT NOT NULL,
        last_seen_rollout_size INTEGER,
        last_seen_rollout_mtime TEXT,
        last_material_change_at TEXT,
        last_task_complete_count INTEGER,
        last_agent_message_fingerprint TEXT
      );

      CREATE TABLE IF NOT EXISTS rename_state (
        thread_id TEXT PRIMARY KEY,
        current_candidate_name TEXT,
        current_candidate_source TEXT,
        current_candidate_generated_at TEXT,
        current_candidate_rule_signature TEXT,
        last_auto_name TEXT,
        last_manual_name TEXT,
        last_applied_name TEXT,
        last_applied_source TEXT,
        last_applied_at TEXT,
        last_applied_revision TEXT,
        last_applied_rule_signature TEXT,
        dirty_since_rename INTEGER NOT NULL DEFAULT 0,
        force_rewrite INTEGER NOT NULL DEFAULT 0,
        manual_override INTEGER NOT NULL DEFAULT 0,
        frozen INTEGER NOT NULL DEFAULT 0,
        auto_apply_count INTEGER NOT NULL DEFAULT 0,
        last_auto_apply_attempt_at TEXT,
        last_auto_apply_success_at TEXT,
        last_skip_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS rename_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        old_name TEXT,
        new_name TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        applied_at TEXT NOT NULL,
        applied_revision TEXT,
        rule_signature TEXT,
        operator TEXT
      );

      CREATE TABLE IF NOT EXISTS ingest_cursors (
        rollout_path TEXT PRIMARY KEY,
        last_offset INTEGER NOT NULL DEFAULT 0,
        last_size INTEGER NOT NULL DEFAULT 0,
        last_mtime TEXT,
        last_scan_at TEXT
      );

      CREATE TABLE IF NOT EXISTS maintenance_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_request_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        project_name TEXT,
        backend TEXT NOT NULL,
        transport TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        base_url TEXT,
        model TEXT,
        prompt_chars INTEGER,
        prompt_text TEXT,
        request_payload_json TEXT,
        response_chars INTEGER,
        response_text TEXT,
        response_payload_json TEXT,
        result_json TEXT,
        error TEXT,
        metadata_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_ai_request_logs_started_at ON ai_request_logs(started_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_request_logs_status ON ai_request_logs(status);
    `);
    this.ensureColumn("rename_state", "force_rewrite", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("rename_state", "current_candidate_rule_signature", "TEXT");
    this.ensureColumn("rename_state", "last_applied_rule_signature", "TEXT");
    this.dropColumnIfExists("rename_state", "manual_override");
    this.ensureColumn("rename_history", "rule_signature", "TEXT");
    this.ensureColumn("ai_request_logs", "prompt_text", "TEXT");
    this.ensureColumn("ai_request_logs", "request_payload_json", "TEXT");
    this.ensureColumn("ai_request_logs", "response_text", "TEXT");
    this.ensureColumn("ai_request_logs", "response_payload_json", "TEXT");
    this.ensureColumn("ai_request_logs", "result_json", "TEXT");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const exists = (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<Record<string, unknown>>).some(
      (row) => row.name === column
    );
    if (!exists) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private dropColumnIfExists(table: string, column: string): void {
    const exists = (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<Record<string, unknown>>).some(
      (row) => row.name === column
    );
    if (exists) {
      this.db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    }
  }

  getSessionByRolloutPath(rolloutPath: string): MaterializedSession | undefined {
    const row = this.db
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

  getRevision(threadId: string): SessionRevision | undefined {
    const row = this.db
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

  getCursor(rolloutPath: string): { lastOffset: number; lastSize: number; lastMtime?: string } | undefined {
    const row = this.db
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

  upsertSession(params: {
    session: MaterializedSession;
    revision: SessionRevision;
    cursor: { rolloutPath: string; lastOffset: number; lastSize: number; lastMtime?: string; lastScanAt?: string };
  }): void {
    const { session, revision, cursor } = params;
    const transaction = this.db.transaction(() => {
      this.db
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

      this.db
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

      this.db
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

      this.db
        .prepare(
          `INSERT INTO rename_state (thread_id, dirty_since_rename)
           VALUES (?, 1)
           ON CONFLICT(thread_id) DO NOTHING`
        )
        .run(session.threadId);

      const renameState = this.getRenameState(session.threadId);
      const dirty = isDirtySinceRename(revision.currentRevision, renameState?.lastAppliedRevision);
      this.db
        .prepare(`UPDATE rename_state SET dirty_since_rename = ? WHERE thread_id = ?`)
        .run(dirty ? 1 : 0, session.threadId);
    });

    transaction();
  }

  updateOfficialNames(snapshot: Map<string, SessionIndexEntry>): void {
    const transaction = this.db.transaction(() => {
      for (const entry of snapshot.values()) {
        this.db
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

  getRenameState(threadId: string): RenameStateRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM rename_state WHERE thread_id = ?`)
      .get(threadId) as Record<string, unknown> | undefined;

    if (!row) {
      return undefined;
    }

    return {
      threadId,
      currentCandidateName: (row.current_candidate_name as string | null) ?? undefined,
      currentCandidateSource: (row.current_candidate_source as RenameSource | null) ?? undefined,
      currentCandidateGeneratedAt: (row.current_candidate_generated_at as string | null) ?? undefined,
      currentCandidateRuleSignature: (row.current_candidate_rule_signature as string | null) ?? undefined,
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
      lastSkipReason: (row.last_skip_reason as string | null) ?? undefined
    };
  }

  saveCandidate(threadId: string, suggestion: { name: string; source: RenameSource; generatedAt: string; ruleSignature?: string }): void {
    this.db
      .prepare(
        `INSERT INTO rename_state (
           thread_id, current_candidate_name, current_candidate_source, current_candidate_generated_at,
           current_candidate_rule_signature, dirty_since_rename
         )
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT(thread_id) DO UPDATE SET
           current_candidate_name = excluded.current_candidate_name,
           current_candidate_source = excluded.current_candidate_source,
           current_candidate_generated_at = excluded.current_candidate_generated_at,
           current_candidate_rule_signature = excluded.current_candidate_rule_signature`
      )
      .run(threadId, suggestion.name, suggestion.source, suggestion.generatedAt, suggestion.ruleSignature ?? null);
  }

  clearCandidate(threadId: string): void {
    this.db
      .prepare(
        `UPDATE rename_state
         SET current_candidate_name = NULL,
             current_candidate_source = NULL,
             current_candidate_generated_at = NULL,
             current_candidate_rule_signature = NULL
         WHERE thread_id = ?`
      )
      .run(threadId);
  }

  clearAllCandidates(): void {
    this.db
      .prepare(
        `UPDATE rename_state
         SET current_candidate_name = NULL,
             current_candidate_source = NULL,
             current_candidate_generated_at = NULL,
             current_candidate_rule_signature = NULL`
      )
      .run();
  }

  private getLatestRenameHistoryRow(threadId: string): Record<string, unknown> | undefined {
    return this.db
      .prepare(
        `SELECT kind, old_name, new_name, source, status, reason, applied_at, applied_revision, operator
         , rule_signature
         FROM rename_history
         WHERE thread_id = ?
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(threadId) as Record<string, unknown> | undefined;
  }

  recordRename(params: {
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
  }): void {
    const previous = this.getRenameState(params.threadId);
    const transaction = this.db.transaction(() => {
      const oldName = previous?.lastAppliedName ?? null;
      const reason = params.reason ?? null;
      const appliedRevision = params.appliedRevision ?? null;
      const latest = this.getLatestRenameHistoryRow(params.threadId);
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
        this.db
          .prepare(
            `INSERT INTO rename_history (
              thread_id, kind, old_name, new_name, source, status, reason, applied_at, applied_revision, operator
            , rule_signature
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
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
            params.ruleSignature ?? null
          );
      }

      if (params.status === "applied" || params.persistAppliedState) {
        this.db
          .prepare(
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
              last_auto_apply_success_at = excluded.last_auto_apply_success_at`
          )
          .run(
            params.threadId,
            params.newName,
            params.source,
            params.appliedAt,
            params.appliedRevision ?? null,
            params.ruleSignature ?? null,
            params.autoApply ? (previous?.autoApplyCount ?? 0) + 1 : previous?.autoApplyCount ?? 0,
            params.autoApply ? params.newName : previous?.lastAutoName ?? null,
            params.source === "manual" ? params.newName : previous?.lastManualName ?? null,
            params.autoApply ? params.appliedAt : previous?.lastAutoApplySuccessAt ?? null
          );

        this.db
          .prepare(
            `UPDATE sessions
             SET latest_official_name = ?, latest_official_name_updated_at = ?
             WHERE thread_id = ?`
          )
          .run(params.newName, params.appliedAt, params.threadId);
      }
    });

    transaction();
  }

  updateStatusEstimate(threadId: string, status: SessionStatusEstimate): void {
    this.db
      .prepare(`UPDATE sessions SET status_estimate = ? WHERE thread_id = ?`)
      .run(status, threadId);
  }

  listSessions(filters?: { dirty?: boolean }): SessionSummary[] {
    const rows = this.db
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

  listWorkspaceSummaries(filters?: { dirty?: boolean }): WorkspaceSummary[] {
    return buildWorkspaceSummaries(this.listSessions(filters));
  }

  getSessionDetail(threadId: string): SessionDetail | undefined {
    const row = this.db
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

  getDirtySessions(): SessionSummary[] {
    return this.listSessions({ dirty: true });
  }

  listNonAcceptedNamedThreadIds(acceptedSources: RenameSource[]): Set<string> {
    const rows = this.db
      .prepare(
        `SELECT thread_id
         FROM rename_state
         WHERE last_applied_name IS NOT NULL
           AND COALESCE(last_applied_source, '') NOT IN (${acceptedSources.map(() => "?").join(", ")})`
      )
      .all(...acceptedSources) as Array<Record<string, unknown>>;

    return new Set(
      rows
        .map((row) => (typeof row.thread_id === "string" ? row.thread_id : undefined))
        .filter((value): value is string => Boolean(value))
    );
  }

  getRenameHistory(threadId: string): RenameHistoryRecord[] {
    return this.db
      .prepare(
        `SELECT kind, old_name, new_name, source, status, reason, applied_at, applied_revision, operator, rule_signature
         FROM rename_history WHERE thread_id = ? ORDER BY applied_at DESC`
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
          operator: (item.operator as string | null) ?? undefined
        } satisfies RenameHistoryRecord;
      });
  }

  startAiRequestLog(params: {
    threadId: string;
    projectName?: string;
    backend: Exclude<AiBackend, "none">;
    transport: AiRequestTransport;
    startedAt: string;
    baseUrl?: string;
    model?: string;
    promptChars?: number;
    promptText?: string;
    requestPayload?: Record<string, unknown>;
    metadata?: Record<string, string>;
  }): number {
    return startAiRequestLogEntry(this.db, params);
  }

  finishAiRequestLog(params: {
    id: number;
    status: Exclude<AiRequestStatus, "running">;
    finishedAt: string;
    durationMs: number;
    responseChars?: number;
    responseText?: string;
    responsePayload?: Record<string, unknown>;
    result?: {
      parsedModelOutput?: Record<string, unknown>;
      finalSuggestion?: RenameSuggestion;
      composition?: {
        mode: EffectiveConfig["naming"]["compositionMode"];
        builder: EffectiveConfig["naming"]["builder"];
        explicitName?: string;
        tagLabel?: string;
        finalName: string;
      };
    };
    error?: string;
    metadata?: Record<string, string>;
  }): void {
    finishAiRequestLogEntry(this.db, params);
  }

  getAiRequestLogReport(options?: {
    limit?: number;
    page?: number;
    search?: string;
    project?: string;
    status?: AiRequestStatus;
    transport?: AiRequestTransport;
  }): AiRequestLogReport {
    return getAiRequestLogReportView(this.db, options);
  }

  getAiRequestLogDetail(id: number): AiRequestLogDetail | undefined {
    return getAiRequestLogDetailView(this.db, id);
  }

  getOverviewReport(options?: {
    nonAcceptedNamedThreadIds?: Set<string>;
    acceptedAppliedSources?: RenameSource[];
  }): OverviewReport {
    return buildOverviewReport(this.db, this.listSessions(), options);
  }

  setFrozen(threadId: string, frozen: boolean): void {
    this.db
      .prepare(
        `INSERT INTO rename_state (thread_id, frozen)
         VALUES (?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET frozen = excluded.frozen`
      )
      .run(threadId, frozen ? 1 : 0);
  }

  listRenameReplayCandidatesSince(params: {
    since: string;
    basis: "session-updated-at" | "last-applied-at";
  }): Array<{
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

    const rows = this.db.prepare(selectSql).all(params.since) as Array<Record<string, unknown>>;
    return rows
      .map((row) => ({
        threadId: row.thread_id as string,
        updatedAt: (row.updated_at as string | null) ?? (row.created_at as string | null) ?? undefined,
        officialName: (row.latest_official_name as string | null) ?? undefined,
        currentRevision: (row.current_revision as string | null) ?? undefined,
        lastAppliedRevision: (row.last_applied_revision as string | null) ?? undefined,
        lastAppliedSource: (row.last_applied_source as RenameSource | null) ?? undefined,
        lastAppliedRuleSignature: (row.last_applied_rule_signature as string | null) ?? undefined,
        frozen: toBoolean(row.frozen as number | null),
        dirty: toBoolean(row.dirty_since_rename as number | null) || toBoolean(row.force_rewrite as number | null)
      }))
      .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
  }

  queueRenameReplayThreadIds(threadIds: string[]): { queued: number; clearedCandidates: number; matchedThreadIds: string[] } {
    if (threadIds.length === 0) {
      return {
        queued: 0,
        clearedCandidates: 0,
        matchedThreadIds: []
      };
    }

    const transaction = this.db.transaction(() => {
      for (const threadId of threadIds) {
        this.db
          .prepare(
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
               current_candidate_rule_signature = NULL`
          )
          .run(threadId);
      }
    });

    transaction();

    return {
      queued: threadIds.length,
      clearedCandidates: threadIds.length,
      matchedThreadIds: threadIds
    };
  }

  vacuum(): void {
    this.db.exec("VACUUM");
  }

  setMaintenanceState(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO maintenance_state (key, value_json)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
      )
      .run(key, JSON.stringify(value));
  }

  getMaintenanceState<T>(key: string): T | undefined {
    const row = this.db
      .prepare(`SELECT value_json FROM maintenance_state WHERE key = ?`)
      .get(key) as Record<string, unknown> | undefined;

    if (!row || typeof row.value_json !== "string") {
      return undefined;
    }

    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      return undefined;
    }
  }
}
