import fs from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";
import type {
  AiBackend,
  AiRequestLogDetail,
  AiRequestLogReport,
  AiRequestStatus,
  AiRequestTransport,
  EffectiveConfig,
  MaterializedSession,
  OverviewReport,
  RenameHistoryKind,
  RenameHistoryRecord,
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
import { getOverviewReport as buildOverviewReport } from "./database/overview-query-service.js";
import {
  getCursor as getCursorEntry,
  getDirtySessions as getDirtySessionsQuery,
  getRevision as getRevisionEntry,
  getSessionByRolloutPath as getSessionByRolloutPathEntry,
  getSessionDetail as getSessionDetailEntry,
  listSessions as listSessionsQuery,
  listWorkspaceSummaries as listWorkspaceSummariesQuery,
  updateOfficialNames as updateOfficialNamesEntry,
  updateStatusEstimate as updateStatusEstimateEntry,
  upsertSession as upsertSessionEntry
} from "./database/session-repository.js";
import {
  clearAllCandidates as clearAllCandidatesEntry,
  clearCandidate as clearCandidateEntry,
  getRenameHistory as getRenameHistoryEntry,
  getRenameState as getRenameStateEntry,
  listNonAcceptedNamedThreadIds as listNonAcceptedNamedThreadIdsQuery,
  listRenameReplayCandidatesSince as listRenameReplayCandidatesSinceQuery,
  queueRenameReplayThreadIds as queueRenameReplayThreadIdsEntry,
  recordRename as recordRenameEntry,
  saveCandidate as saveCandidateEntry,
  setFrozen as setFrozenEntry
} from "./database/rename-repository.js";
import {
  getMaintenanceState as getMaintenanceStateEntry,
  setMaintenanceState as setMaintenanceStateEntry,
  vacuum as vacuumEntry
} from "./database/maintenance-state-repository.js";

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

  getSessionByRolloutPath(rolloutPath: string) {
    return getSessionByRolloutPathEntry(this.db, rolloutPath);
  }

  getRevision(threadId: string): SessionRevision | undefined {
    return getRevisionEntry(this.db, threadId);
  }

  getCursor(rolloutPath: string): { lastOffset: number; lastSize: number; lastMtime?: string } | undefined {
    return getCursorEntry(this.db, rolloutPath);
  }

  upsertSession(params: {
    session: MaterializedSession;
    revision: SessionRevision;
    cursor: { rolloutPath: string; lastOffset: number; lastSize: number; lastMtime?: string; lastScanAt?: string };
  }): void {
    upsertSessionEntry(this.db, params);
  }

  updateOfficialNames(snapshot: Map<string, SessionIndexEntry>): void {
    updateOfficialNamesEntry(this.db, snapshot);
  }

  getRenameState(threadId: string): RenameStateRecord | undefined {
    return getRenameStateEntry(this.db, threadId);
  }

  saveCandidate(threadId: string, suggestion: { name: string; source: RenameSource; generatedAt: string; ruleSignature?: string }): void {
    saveCandidateEntry(this.db, threadId, suggestion);
  }

  clearCandidate(threadId: string): void {
    clearCandidateEntry(this.db, threadId);
  }

  clearAllCandidates(): void {
    clearAllCandidatesEntry(this.db);
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
    recordRenameEntry(this.db, params);
  }

  updateStatusEstimate(threadId: string, status: SessionStatusEstimate): void {
    updateStatusEstimateEntry(this.db, threadId, status);
  }

  listSessions(filters?: { dirty?: boolean }): SessionSummary[] {
    return listSessionsQuery(this.db, filters);
  }

  listWorkspaceSummaries(filters?: { dirty?: boolean }): WorkspaceSummary[] {
    return listWorkspaceSummariesQuery(this.db, filters);
  }

  getSessionDetail(threadId: string): SessionDetail | undefined {
    return getSessionDetailEntry(this.db, threadId);
  }

  getDirtySessions(): SessionSummary[] {
    return getDirtySessionsQuery(this.db);
  }

  listNonAcceptedNamedThreadIds(acceptedSources: RenameSource[]): Set<string> {
    return listNonAcceptedNamedThreadIdsQuery(this.db, acceptedSources);
  }

  getRenameHistory(threadId: string): RenameHistoryRecord[] {
    return getRenameHistoryEntry(this.db, threadId);
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
    setFrozenEntry(this.db, threadId, frozen);
  }

  listRenameReplayCandidatesSince(params: {
    since: string;
    basis: "session-updated-at" | "last-applied-at";
  }) {
    return listRenameReplayCandidatesSinceQuery(this.db, params);
  }

  queueRenameReplayThreadIds(threadIds: string[]): { queued: number; clearedCandidates: number; matchedThreadIds: string[] } {
    return queueRenameReplayThreadIdsEntry(this.db, threadIds);
  }

  vacuum(): void {
    vacuumEntry(this.db);
  }

  setMaintenanceState(key: string, value: unknown): void {
    setMaintenanceStateEntry(this.db, key, value);
  }

  getMaintenanceState<T>(key: string): T | undefined {
    return getMaintenanceStateEntry<T>(this.db, key);
  }
}
