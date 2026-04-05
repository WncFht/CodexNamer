import fs from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";
import type {
  MaterializedSession,
  OverviewReport,
  RenameHistoryRecord,
  RenameHistoryKind,
  RenameSource,
  RenameStateRecord,
  SessionDetail,
  SessionIndexEntry,
  SessionRevision,
  SessionSummary,
  SessionStatusEstimate,
  WorkspaceSummary
} from "@codex-session-manager/shared";

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
  dirty_since_rename: number | null;
  last_applied_name: string | null;
  last_applied_source: string | null;
  last_applied_revision: string | null;
  last_applied_at: string | null;
  manual_override: number | null;
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
        last_auto_name TEXT,
        last_manual_name TEXT,
        last_applied_name TEXT,
        last_applied_source TEXT,
        last_applied_at TEXT,
        last_applied_revision TEXT,
        dirty_since_rename INTEGER NOT NULL DEFAULT 0,
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
    `);
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

        const state = this.getRenameState(entry.id);
        if (!state) {
          continue;
        }

        const manualOverrideDetected =
          Boolean(state.lastAppliedName) &&
          entry.threadName !== state.lastAppliedName &&
          entry.threadName !== state.currentCandidateName;

        if (manualOverrideDetected) {
          this.db
            .prepare(`UPDATE rename_state SET manual_override = 1 WHERE thread_id = ?`)
            .run(entry.id);
        }
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
      lastAutoName: (row.last_auto_name as string | null) ?? undefined,
      lastManualName: (row.last_manual_name as string | null) ?? undefined,
      lastAppliedName: (row.last_applied_name as string | null) ?? undefined,
      lastAppliedSource: (row.last_applied_source as RenameSource | null) ?? undefined,
      lastAppliedAt: (row.last_applied_at as string | null) ?? undefined,
      lastAppliedRevision: (row.last_applied_revision as string | null) ?? undefined,
      dirtySinceRename: toBoolean(row.dirty_since_rename as number | null),
      manualOverride: toBoolean(row.manual_override as number | null),
      frozen: toBoolean(row.frozen as number | null),
      autoApplyCount: Number(row.auto_apply_count ?? 0),
      lastAutoApplyAttemptAt: (row.last_auto_apply_attempt_at as string | null) ?? undefined,
      lastAutoApplySuccessAt: (row.last_auto_apply_success_at as string | null) ?? undefined,
      lastSkipReason: (row.last_skip_reason as string | null) ?? undefined
    };
  }

  saveCandidate(threadId: string, suggestion: { name: string; source: RenameSource; generatedAt: string }): void {
    this.db
      .prepare(
        `INSERT INTO rename_state (thread_id, current_candidate_name, current_candidate_source, current_candidate_generated_at, dirty_since_rename)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(thread_id) DO UPDATE SET
           current_candidate_name = excluded.current_candidate_name,
           current_candidate_source = excluded.current_candidate_source,
           current_candidate_generated_at = excluded.current_candidate_generated_at`
      )
      .run(threadId, suggestion.name, suggestion.source, suggestion.generatedAt);
  }

  private getLatestRenameHistoryRow(threadId: string): Record<string, unknown> | undefined {
    return this.db
      .prepare(
        `SELECT kind, old_name, new_name, source, status, reason, applied_at, applied_revision, operator
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
    manualOverride?: boolean;
    autoApply?: boolean;
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
        (latest.operator ?? null) === params.operator;

      if (!isDuplicateLatestHistory) {
        this.db
          .prepare(
            `INSERT INTO rename_history (
              thread_id, kind, old_name, new_name, source, status, reason, applied_at, applied_revision, operator
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
            params.operator
          );
      }

      if (params.status === "applied") {
        this.db
          .prepare(
            `INSERT INTO rename_state (
              thread_id, last_applied_name, last_applied_source, last_applied_at,
              last_applied_revision, dirty_since_rename, manual_override, auto_apply_count,
              last_auto_name, last_manual_name, last_auto_apply_success_at
            ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
            ON CONFLICT(thread_id) DO UPDATE SET
              last_applied_name = excluded.last_applied_name,
              last_applied_source = excluded.last_applied_source,
              last_applied_at = excluded.last_applied_at,
              last_applied_revision = excluded.last_applied_revision,
              dirty_since_rename = 0,
              manual_override = excluded.manual_override,
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
            params.manualOverride ? 1 : 0,
            params.autoApply ? (previous?.autoApplyCount ?? 0) + 1 : previous?.autoApplyCount ?? 0,
            params.autoApply ? params.newName : previous?.lastAutoName ?? null,
            params.manualOverride ? params.newName : previous?.lastManualName ?? null,
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
                rs.current_candidate_name, rs.last_applied_revision, rs.manual_override, rs.frozen,
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
        dirty: toBoolean(row.dirty_since_rename as number | null),
        frozen: toBoolean(row.frozen as number | null),
        manualOverride: toBoolean(row.manual_override as number | null),
        taskCompleteCount: Number(row.task_complete_count ?? 0),
        provider: (row.model_provider as string | null) ?? undefined,
        model: (row.model as string | null) ?? undefined,
        statusEstimate: (row.status_estimate as SessionStatusEstimate | null) ?? undefined
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
        existing.manualOverrideCount += session.manualOverride ? 1 : 0;
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
        manualOverrideCount: session.manualOverride ? 1 : 0,
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
                s.status_estimate, sr.current_revision, rs.current_candidate_name, rs.last_applied_at,
                rs.last_applied_revision, rs.manual_override, rs.frozen, rs.dirty_since_rename
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
      dirty: toBoolean(row.dirty_since_rename as number | null),
      frozen: toBoolean(row.frozen as number | null),
      manualOverride: toBoolean(row.manual_override as number | null),
      taskCompleteCount: row.task_complete_count,
      provider: row.model_provider ?? undefined,
      model: row.model ?? undefined,
      statusEstimate: (row.status_estimate as SessionStatusEstimate | null) ?? undefined,
      firstUserMessage: row.first_user_message ?? undefined,
      lastUserMessage: row.last_user_message ?? undefined,
      lastAgentMessage: row.last_agent_message ?? undefined,
      tokenTotal: row.token_total,
      revision: row.current_revision ?? undefined,
      lastAppliedAt: row.last_applied_at ?? undefined,
      lastAppliedRevision: row.last_applied_revision ?? undefined
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
        `SELECT kind, old_name, new_name, source, status, reason, applied_at, applied_revision, operator
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
          operator: (item.operator as string | null) ?? undefined
        } satisfies RenameHistoryRecord;
      });
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
                COALESCE(rs.dirty_since_rename, 0) AS dirty_since_rename
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

    const renameStatsRow = this.db
      .prepare(
        `SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'applied' AND source IN (${acceptedAppliedSources.map(() => "?").join(", ")}) THEN 1 ELSE 0 END) AS applied,
            SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status = 'preview_only' THEN 1 ELSE 0 END) AS preview_only,
            SUM(CASE WHEN status = 'applied' AND source = 'ai' THEN 1 ELSE 0 END) AS ai_applied,
            SUM(CASE WHEN status = 'applied' AND source = 'manual' THEN 1 ELSE 0 END) AS manual_applied,
            SUM(CASE WHEN status = 'applied' AND kind = 'auto' AND source = 'ai' THEN 1 ELSE 0 END) AS auto_applied,
            MAX(CASE WHEN status = 'applied' AND source IN (${acceptedAppliedSources.map(() => "?").join(", ")}) THEN applied_at END) AS last_applied_at
         FROM rename_history`
      )
      .get(...acceptedAppliedSources, ...acceptedAppliedSources) as Record<string, unknown>;

    const activityWindowDays = 14;
    const bucketStart = new Date();
    bucketStart.setUTCHours(0, 0, 0, 0);
    bucketStart.setUTCDate(bucketStart.getUTCDate() - (activityWindowDays - 1));
    const activityRows = this.db
      .prepare(
        `SELECT
            substr(applied_at, 1, 10) AS day,
            SUM(CASE WHEN status = 'applied' AND source IN (${acceptedAppliedSources.map(() => "?").join(", ")}) THEN 1 ELSE 0 END) AS applied,
            SUM(CASE WHEN status = 'preview_only' THEN 1 ELSE 0 END) AS preview_only,
            SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status = 'applied' AND kind = 'auto' AND source = 'ai' THEN 1 ELSE 0 END) AS auto_applied,
            SUM(CASE WHEN status = 'applied' AND kind = 'manual' THEN 1 ELSE 0 END) AS manual_applied,
            SUM(CASE WHEN status = 'applied' AND source = 'ai' THEN 1 ELSE 0 END) AS ai_applied
         FROM rename_history
         WHERE applied_at >= ?
         GROUP BY day
         ORDER BY day`
      )
      .all(...acceptedAppliedSources, bucketStart.toISOString()) as Array<Record<string, unknown>>;
    const activityByDate = new Map<string, Record<string, unknown>>();
    for (const row of activityRows) {
      if (typeof row.day === "string") {
        activityByDate.set(row.day, row);
      }
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
        previewOnly: Number(row?.preview_only ?? 0),
        skipped: Number(row?.skipped ?? 0),
        failed: Number(row?.failed ?? 0),
        autoApplied: Number(row?.auto_applied ?? 0),
        manualApplied: Number(row?.manual_applied ?? 0),
        aiApplied: Number(row?.ai_applied ?? 0)
      });
    }

    const dirtySessionCount = sessions.filter(
      (item) => item.dirty || nonAcceptedNamedThreadIds.has(item.threadId)
    ).length;

    return {
      sessions: {
        total: sessions.length,
        workspaces: workspaces.length,
        dirty: sessions.filter((item) => item.dirty || nonAcceptedNamedThreadIds.has(item.threadId)).length,
        clean: sessions.filter((item) => !item.dirty && !nonAcceptedNamedThreadIds.has(item.threadId)).length,
        frozen: sessions.filter((item) => item.frozen).length,
        manualOverride: sessions.filter((item) => item.manualOverride).length,
        named: sessions.filter((item) => Boolean(item.officialName) && !nonAcceptedNamedThreadIds.has(item.threadId)).length,
        withCandidate: sessions.filter((item) => Boolean(item.candidateName)).length
      },
      runtime: {
        configuredAutoApply: "unknown",
        actualExecution: "preview-only",
        daemonAutoApply: false,
        daemonStatus: "not_seen",
        lastSweepAt: undefined,
        lastSweepIntervalSeconds: undefined,
        lastSweepSummary: undefined,
        explain: "The current daemon scans sessions and prints preview evaluations, but it does not call apply()."
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
        total: Number(renameStatsRow.total ?? 0),
        applied: Number(renameStatsRow.applied ?? 0),
        skipped: Number(renameStatsRow.skipped ?? 0),
        failed: Number(renameStatsRow.failed ?? 0),
        previewOnly: Number(renameStatsRow.preview_only ?? 0),
        aiApplied: Number(renameStatsRow.ai_applied ?? 0),
        manualApplied: Number(renameStatsRow.manual_applied ?? 0),
        autoApplied: Number(renameStatsRow.auto_applied ?? 0),
        lastAppliedAt: (renameStatsRow.last_applied_at as string | null) ?? undefined
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

  setManualOverride(threadId: string, manualOverride: boolean): void {
    this.db
      .prepare(
        `INSERT INTO rename_state (thread_id, manual_override)
         VALUES (?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET manual_override = excluded.manual_override`
      )
      .run(threadId, manualOverride ? 1 : 0);
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
