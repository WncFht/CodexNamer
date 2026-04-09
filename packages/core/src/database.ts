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
    const groups = new Map<string, WorkspaceSummary>();

    for (const session of this.listSessions(filters)) {
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
        projects: session.projectName ? [session.projectName] : []
      });
    }

    return Array.from(groups.values()).sort((left, right) =>
      (right.latestUpdatedAt ?? "").localeCompare(left.latestUpdatedAt ?? "")
    );
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
    const result = this.db
      .prepare(
        `INSERT INTO ai_request_logs (
          thread_id, project_name, backend, transport, status, started_at, base_url, model, prompt_chars, prompt_text,
          request_payload_json, metadata_json
        ) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.threadId,
        params.projectName ?? null,
        params.backend,
        params.transport,
        params.startedAt,
        params.baseUrl ?? null,
        params.model ?? null,
        params.promptChars ?? null,
        params.promptText ?? null,
        params.requestPayload ? JSON.stringify(params.requestPayload) : null,
        params.metadata ? JSON.stringify(params.metadata) : null
      );

    return Number(result.lastInsertRowid);
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
    const previous = this.db
      .prepare(`SELECT metadata_json FROM ai_request_logs WHERE id = ?`)
      .get(params.id) as Record<string, unknown> | undefined;
    const previousMetadata =
      typeof previous?.metadata_json === "string" && previous.metadata_json
        ? (JSON.parse(previous.metadata_json) as Record<string, string>)
        : {};
    const mergedMetadata = {
      ...previousMetadata,
      ...(params.metadata ?? {})
    };

    this.db
      .prepare(
        `UPDATE ai_request_logs
         SET status = ?, finished_at = ?, duration_ms = ?, response_chars = ?, response_text = ?, response_payload_json = ?,
             result_json = ?, error = ?, metadata_json = ?
         WHERE id = ?`
      )
      .run(
        params.status,
        params.finishedAt,
        Math.max(0, Math.trunc(params.durationMs)),
        params.responseChars ?? null,
        params.responseText ?? null,
        params.responsePayload ? JSON.stringify(params.responsePayload) : null,
        params.result ? JSON.stringify(params.result) : null,
        params.error ?? null,
        Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null,
        params.id
      );
  }

  getAiRequestLogReport(options?: {
    limit?: number;
    page?: number;
    search?: string;
    project?: string;
    status?: AiRequestStatus;
    transport?: AiRequestTransport;
  }): AiRequestLogReport {
    const limit = Math.max(1, Math.trunc(options?.limit ?? 40));
    const page = Math.max(1, Math.trunc(options?.page ?? 1));
    const offset = (page - 1) * limit;
    const whereClauses: string[] = [];
    const whereParams: unknown[] = [];
    const facetClauses: string[] = [];
    const facetParams: unknown[] = [];

    const search = options?.search?.trim().toLowerCase();
    if (search) {
      const pattern = `%${search}%`;
      const searchClause = `LOWER(COALESCE(project_name, '') || ' ' || thread_id || ' ' || COALESCE(model, '') || ' ' || backend || ' ' || transport || ' ' || COALESCE(base_url, '') || ' ' || COALESCE(error, '') || ' ' || COALESCE(metadata_json, '')) LIKE ?`;
      whereClauses.push(searchClause);
      whereParams.push(pattern);
      facetClauses.push(searchClause);
      facetParams.push(pattern);
    }

    if (options?.project) {
      if (options.project === "__none__") {
        whereClauses.push(`COALESCE(NULLIF(TRIM(project_name), ''), '__none__') = '__none__'`);
      } else {
        whereClauses.push(`project_name = ?`);
        whereParams.push(options.project);
      }
    }

    if (options?.status) {
      whereClauses.push(`status = ?`);
      whereParams.push(options.status);
      facetClauses.push(`status = ?`);
      facetParams.push(options.status);
    }

    if (options?.transport) {
      whereClauses.push(`transport = ?`);
      whereParams.push(options.transport);
      facetClauses.push(`transport = ?`);
      facetParams.push(options.transport);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const facetWhereSql = facetClauses.length > 0 ? `WHERE ${facetClauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT id, thread_id, project_name, backend, transport, status, started_at, finished_at, duration_ms,
                base_url, model, prompt_chars, response_chars, result_json, error, metadata_json
         FROM ai_request_logs
         ${whereSql}
         ORDER BY started_at DESC, id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...whereParams, limit, offset) as Array<Record<string, unknown>>;
    const total = Number(
      (
        this.db
          .prepare(`SELECT COUNT(*) AS count FROM ai_request_logs ${whereSql}`)
          .get(...whereParams) as Record<string, unknown>
      ).count ?? 0
    );
    const statusCountsRow = this.db
      .prepare(
        `SELECT
            SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
            SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM ai_request_logs
         ${whereSql}`
      )
      .get(...whereParams) as Record<string, unknown>;
    const projectRows = this.db
      .prepare(
        `SELECT DISTINCT COALESCE(NULLIF(TRIM(project_name), ''), '') AS project_name
         FROM ai_request_logs
         ${facetWhereSql}
         ORDER BY project_name COLLATE NOCASE ASC`
      )
      .all(...facetParams) as Array<Record<string, unknown>>;
    const activeCount = Number(
      (
        this.db
          .prepare(`SELECT COUNT(*) AS count FROM ai_request_logs WHERE status = 'running'`)
          .get() as Record<string, unknown>
      ).count ?? 0
    );
    const lastFinishedAt = (
      this.db
        .prepare(`SELECT finished_at FROM ai_request_logs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, id DESC LIMIT 1`)
        .get() as Record<string, unknown> | undefined
    )?.finished_at as string | undefined;

    return {
      activeCount,
      lastFinishedAt,
      total,
      page,
      pageSize: limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      statusCounts: {
        running: Number(statusCountsRow.running ?? 0),
        succeeded: Number(statusCountsRow.succeeded ?? 0),
        failed: Number(statusCountsRow.failed ?? 0)
      },
      projects: projectRows.map((row) => ((row.project_name as string | null) ?? "")),
      items: rows.map((row) => ({
        id: Number(row.id ?? 0),
        threadId: (row.thread_id as string | null) ?? "",
        projectName: (row.project_name as string | null) ?? undefined,
        backend: row.backend as AiRequestLogRecord["backend"],
        transport: row.transport as AiRequestTransport,
        status: row.status as AiRequestStatus,
        startedAt: (row.started_at as string | null) ?? "",
        finishedAt: (row.finished_at as string | null) ?? undefined,
        durationMs:
          typeof row.duration_ms === "number" ? row.duration_ms : Number.isFinite(Number(row.duration_ms)) ? Number(row.duration_ms) : undefined,
        baseUrl: (row.base_url as string | null) ?? undefined,
        model: (row.model as string | null) ?? undefined,
        promptChars:
          typeof row.prompt_chars === "number" ? row.prompt_chars : Number.isFinite(Number(row.prompt_chars)) ? Number(row.prompt_chars) : undefined,
        responseChars:
          typeof row.response_chars === "number" ? row.response_chars : Number.isFinite(Number(row.response_chars)) ? Number(row.response_chars) : undefined,
        finalName:
          typeof row.result_json === "string" && row.result_json
            ? (((JSON.parse(row.result_json) as AiRequestLogDetail["result"])?.composition?.finalName as string | undefined) ?? undefined)
            : undefined,
        error: (row.error as string | null) ?? undefined,
        metadata:
          typeof row.metadata_json === "string" && row.metadata_json
            ? (JSON.parse(row.metadata_json) as Record<string, string>)
            : undefined
      }))
      };
  }

  getAiRequestLogDetail(id: number): AiRequestLogDetail | undefined {
    const row = this.db
      .prepare(
        `SELECT id, thread_id, project_name, backend, transport, status, started_at, finished_at, duration_ms,
                base_url, model, prompt_chars, prompt_text, request_payload_json, response_chars, response_text,
                response_payload_json, result_json, error, metadata_json
         FROM ai_request_logs
         WHERE id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }

    const result =
      typeof row.result_json === "string" && row.result_json
        ? (JSON.parse(row.result_json) as AiRequestLogDetail["result"])
        : undefined;

    return {
      id: Number(row.id ?? 0),
      threadId: (row.thread_id as string | null) ?? "",
      projectName: (row.project_name as string | null) ?? undefined,
      backend: row.backend as AiRequestLogRecord["backend"],
      transport: row.transport as AiRequestTransport,
      status: row.status as AiRequestStatus,
      startedAt: (row.started_at as string | null) ?? "",
      finishedAt: (row.finished_at as string | null) ?? undefined,
      durationMs:
        typeof row.duration_ms === "number" ? row.duration_ms : Number.isFinite(Number(row.duration_ms)) ? Number(row.duration_ms) : undefined,
      baseUrl: (row.base_url as string | null) ?? undefined,
      model: (row.model as string | null) ?? undefined,
      promptChars:
        typeof row.prompt_chars === "number" ? row.prompt_chars : Number.isFinite(Number(row.prompt_chars)) ? Number(row.prompt_chars) : undefined,
      promptText: (row.prompt_text as string | null) ?? undefined,
      requestPayload:
        typeof row.request_payload_json === "string" && row.request_payload_json
          ? (JSON.parse(row.request_payload_json) as Record<string, unknown>)
          : undefined,
      responseChars:
        typeof row.response_chars === "number" ? row.response_chars : Number.isFinite(Number(row.response_chars)) ? Number(row.response_chars) : undefined,
      finalName: result?.composition?.finalName ?? undefined,
      responseText: (row.response_text as string | null) ?? undefined,
      responsePayload:
        typeof row.response_payload_json === "string" && row.response_payload_json
          ? (JSON.parse(row.response_payload_json) as Record<string, unknown>)
          : undefined,
      result,
      error: (row.error as string | null) ?? undefined,
      metadata:
        typeof row.metadata_json === "string" && row.metadata_json
          ? (JSON.parse(row.metadata_json) as Record<string, string>)
          : undefined
    };
  }

  getOverviewReport(options?: {
    nonAcceptedNamedThreadIds?: Set<string>;
    acceptedAppliedSources?: RenameSource[];
  }): OverviewReport {
    const sessions = this.listSessions();
    const workspaces = this.listWorkspaceSummaries();
    const nonAcceptedNamedThreadIds = options?.nonAcceptedNamedThreadIds ?? new Set<string>();
    const acceptedAppliedSources = options?.acceptedAppliedSources ?? ["ai", "manual"];
    const workloadRows = this.db
      .prepare(
        `SELECT s.thread_id, s.cwd, s.project_name, s.token_total, s.task_complete_count, s.status_estimate,
                COALESCE(rs.dirty_since_rename, 0) AS dirty_since_rename,
                COALESCE(rs.force_rewrite, 0) AS force_rewrite
         FROM sessions s
         LEFT JOIN rename_state rs ON rs.thread_id = s.thread_id`
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
      missing: 0
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
          tokens: tokenTotal
        });
      }
    }

    const activityWindowDays = 14;
    const bucketStart = new Date();
    bucketStart.setUTCHours(0, 0, 0, 0);
    bucketStart.setUTCDate(bucketStart.getUTCDate() - (activityWindowDays - 1));
    const renameHistoryRows = this.db
      .prepare(
        `SELECT id, thread_id, kind, source, status, applied_at
         FROM rename_history
         ORDER BY applied_at DESC, id DESC`
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
      lastAppliedAt: undefined as string | undefined
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
        if (!renameHistorySummary.lastAppliedAt || row.applied_at > renameHistorySummary.lastAppliedAt) {
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
        aiApplied: 0
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
        label: `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(
          date.getUTCDate()
        ).padStart(2, "0")}`,
        applied: Number(row?.applied ?? 0),
        previewOnly: Number(row?.previewOnly ?? 0),
        skipped: Number(row?.skipped ?? 0),
        failed: Number(row?.failed ?? 0),
        autoApplied: Number(row?.autoApplied ?? 0),
        manualApplied: Number(row?.manualApplied ?? 0),
        aiApplied: Number(row?.aiApplied ?? 0)
      });
    }

    const dirtySessionCount = sessions.filter(
      (item) => item.dirty || nonAcceptedNamedThreadIds.has(item.threadId)
    ).length;
    const acceptedOfficialNames = sessions
      .filter((item) => Boolean(item.officialName) && !nonAcceptedNamedThreadIds.has(item.threadId))
      .map((item) => item.officialName ?? "");
    const averageTitleLength =
      acceptedOfficialNames.length > 0
        ? Math.round(
            acceptedOfficialNames.reduce((sum, name) => sum + name.trim().length, 0) /
              acceptedOfficialNames.length
          )
        : 0;

    return {
      sessions: {
        total: sessions.length,
        workspaces: workspaces.length,
        dirty: sessions.filter((item) => item.dirty || nonAcceptedNamedThreadIds.has(item.threadId)).length,
        clean: sessions.filter((item) => !item.dirty && !nonAcceptedNamedThreadIds.has(item.threadId)).length,
        frozen: sessions.filter((item) => item.frozen).length,
        named: sessions.filter((item) => Boolean(item.officialName) && !nonAcceptedNamedThreadIds.has(item.threadId)).length,
        withCandidate: sessions.filter((item) => Boolean(item.candidateName)).length
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
        explain: "The current daemon scans sessions and prints preview evaluations, but it does not call apply()."
      },
      ruleCoverage: {
        currentSignature: "",
        latest: 0,
        outdated: 0,
        manual: 0,
        unknown: 0
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
          .slice(0, 6)
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
        lastAppliedAt: renameHistorySummary.lastAppliedAt
      },
      replay: {
        lastRunAt: undefined,
        recentRuns: []
      },
      activity: {
        windowDays: activityWindowDays,
        buckets: activityBuckets
      }
    };
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
