import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  type ConfigDocument,
  type ConfigView,
  SESSION_INDEX_FILENAME,
  type AutoRenamePreview,
  type DoctorReport,
  type EffectiveConfig,
  type MaterializedSession,
  type OverviewReport,
  type PromptPreview,
  type RenameSuggestion,
  type ScanReport,
  type SessionDetail,
  type SessionIndexSnapshot,
  type SessionSummary,
  type SessionStatusEstimate,
  type WorkspaceSummary
} from "@codex-session-manager/shared";

import { loadConfigView, loadEffectiveConfig, writeUserConfig } from "./config.js";
import { StateDatabase } from "./database.js";
import { buildRenamePrompt, createRenameInferenceService, inspectRenameProvider } from "./provider.js";
import { buildSessionRevision } from "./revision.js";
import { discoverRolloutFiles, ingestRolloutFile, readSessionTranscript, readSessionTranscriptPage } from "./rollout.js";
import {
  appendSessionIndexRename,
  compactSessionIndex,
  readSessionIndex
} from "./session-index.js";
import { buildRenameContext } from "./rename-context.js";
import { estimateSessionStatus, evaluateAutoRename } from "./auto-rename.js";

function redactSecret(value?: string): string | undefined {
  return value ? "[redacted]" : undefined;
}

export class CodexSessionManager {
  private inferenceService;
  private sessionIndexCache?: {
    size: number;
    mtimeMs: number;
    snapshot: SessionIndexSnapshot;
  };
  private readonly cwd: string;
  private readonly configPath?: string;
  private readonly overrides?: Partial<EffectiveConfig>;

  constructor(
    public config: EffectiveConfig,
    public readonly db: StateDatabase,
    private readonly operator: string = "cli",
    options?: {
      cwd?: string;
      configPath?: string;
      overrides?: Partial<EffectiveConfig>;
    }
  ) {
    this.inferenceService = createRenameInferenceService(config);
    this.cwd = options?.cwd ?? process.cwd();
    this.configPath = options?.configPath;
    this.overrides = options?.overrides;
  }

  static async create(options?: {
    cwd?: string;
    configPath?: string;
    overrides?: Partial<EffectiveConfig>;
    operator?: string;
  }): Promise<CodexSessionManager> {
    const config = await loadEffectiveConfig({
      cwd: options?.cwd,
      configPath: options?.configPath,
      overrides: options?.overrides
    });
    const db = await StateDatabase.create(path.join(config.general.stateDir, "app.db"));
    return new CodexSessionManager(config, db, options?.operator, {
      cwd: options?.cwd,
      configPath: options?.configPath,
      overrides: options?.overrides
    });
  }

  get sessionIndexPath(): string {
    return path.join(this.config.general.codexHome, SESSION_INDEX_FILENAME);
  }

  get backupDir(): string {
    return path.join(this.config.general.stateDir, "backups");
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async reloadConfig(): Promise<void> {
    const nextConfig = await loadEffectiveConfig({
      cwd: this.cwd,
      configPath: this.configPath,
      overrides: this.overrides
    });
    this.config = nextConfig;
    this.inferenceService = createRenameInferenceService(nextConfig);
    this.sessionIndexCache = undefined;
  }

  private requireSessionDetail(threadId: string): SessionDetail {
    const detail = this.db.getSessionDetail(threadId);
    if (!detail) {
      throw new Error(`Unknown session: ${threadId}`);
    }
    return detail;
  }

  private buildSyntheticPromptSession(): MaterializedSession {
    return {
      threadId: "provider-test",
      rolloutPath: "<synthetic>",
      cwd: process.cwd(),
      projectName: path.basename(process.cwd()),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      modelProvider: this.config.inheritedCodex.modelProvider,
      model: this.config.inheritedCodex.model,
      firstUserMessage: "为当前会话生成一个简短、清晰的中文标题。",
      lastUserMessage: "请测试当前 AI rename backend 是否可用。",
      lastAgentMessage: "这是 provider test 的 synthetic session。",
      taskCompleteCount: 1,
      tokenTotal: 128
    };
  }

  async scan(): Promise<ScanReport> {
    const rolloutFiles = await discoverRolloutFiles(this.config.general.codexHome);
    let updatedSessions = 0;

    for (const rolloutPath of rolloutFiles) {
      const stat = await fs.stat(rolloutPath);
      const previousSession = this.db.getSessionByRolloutPath(rolloutPath);
      const previousCursor = this.db.getCursor(rolloutPath);
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

      const previousRevision = this.db.getRevision(ingest.session.threadId);
      const revision = buildSessionRevision(
        ingest.session,
        {
          sizeBytes: stat.size,
          mtime: stat.mtime.toISOString()
        },
        previousRevision
      );

      this.db.upsertSession({
        session: ingest.session,
        revision,
        cursor: ingest.cursor
      });

      updatedSessions += 1;
    }

    const sessionIndexSnapshot = await this.readSessionIndexSnapshot();
    this.db.updateOfficialNames(sessionIndexSnapshot.latestByThreadId);

    const now = new Date();
    for (const session of this.db.listSessions()) {
      const detail = this.db.getSessionDetail(session.threadId);
      if (!detail) {
        continue;
      }
        this.db.updateStatusEstimate(detail.threadId, estimateSessionStatus(detail, this.config, now));
    }

    return {
      scannedRollouts: rolloutFiles.length,
      updatedSessions
    };
  }

  async listSessions(options?: { dirty?: boolean }): Promise<SessionSummary[]> {
    await this.scan();
    return this.db.listSessions(options);
  }

  async listWorkspaces(options?: { dirty?: boolean }): Promise<WorkspaceSummary[]> {
    await this.scan();
    return this.db.listWorkspaceSummaries(options);
  }

  async getSessionDetail(
    threadId: string,
    options?: { includeTranscript?: boolean }
  ): Promise<SessionDetail | undefined> {
    await this.scan();
    const detail = this.db.getSessionDetail(threadId);
    if (!detail) {
      return undefined;
    }
    return {
      ...detail,
      renameHistory: this.db.getRenameHistory(threadId),
      transcript: options?.includeTranscript ? await readSessionTranscript(detail.rolloutPath) : undefined
    };
  }

  async getSessionTranscriptPage(
    threadId: string,
    options?: {
      page?: number;
      pageSize?: number;
      includeHidden?: boolean;
      role?: "all" | "user" | "assistant" | "tool" | "system";
      query?: string;
    }
  ) {
    await this.scan();
    const detail = this.db.getSessionDetail(threadId);
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

  private async materializeSessionForSuggestion(detail: SessionDetail): Promise<MaterializedSession> {
    const transcript =
      this.config.naming.contextStrategy === "user-assistant-transcript"
        ? detail.transcript ?? (await readSessionTranscript(detail.rolloutPath))
        : undefined;

    return {
      ...detail,
      renameContext: buildRenameContext(detail, this.config, {
        transcript
      })
    };
  }

  async suggest(threadId: string): Promise<RenameSuggestion> {
    await this.scan();
    const detail = this.requireSessionDetail(threadId);

    const suggestion = await this.inferenceService.suggest(await this.materializeSessionForSuggestion(detail));
    this.db.saveCandidate(threadId, suggestion);
    return suggestion;
  }

  async apply(threadId: string): Promise<{ written: boolean; name: string }> {
    await this.scan();
    const detail = this.requireSessionDetail(threadId);

    const state = this.db.getRenameState(threadId);
    const suggestion =
      state?.currentCandidateName && state.currentCandidateGeneratedAt
        ? {
            threadId,
            name: state.currentCandidateName,
            source: state.currentCandidateSource ?? "heuristic",
            kind: "chore",
            summary: state.currentCandidateName,
            generatedAt: state.currentCandidateGeneratedAt
          }
        : await this.suggest(threadId);

    const result = await appendSessionIndexRename({
      filePath: this.sessionIndexPath,
      threadId,
      threadName: suggestion.name
    });
    this.sessionIndexCache = undefined;
    const appliedAt = result.entry.updatedAt;
    this.db.recordRename({
      threadId,
      newName: suggestion.name,
      source: suggestion.source,
      kind: suggestion.source === "manual" ? "manual" : "auto",
      status: result.written ? "applied" : "skipped",
      reason: result.written ? undefined : "unchanged",
      operator: this.operator,
      appliedAt,
      appliedRevision: detail.revision,
      manualOverride: false,
      autoApply: false
    });

    return {
      written: result.written,
      name: result.entry.threadName
    };
  }

  async rename(threadId: string, name: string): Promise<{ written: boolean; name: string }> {
    await this.scan();
    const detail = this.requireSessionDetail(threadId);

    const result = await appendSessionIndexRename({
      filePath: this.sessionIndexPath,
      threadId,
      threadName: name
    });
    this.sessionIndexCache = undefined;

    this.db.recordRename({
      threadId,
      newName: name.trim(),
      source: "manual",
      kind: "manual",
      status: result.written ? "applied" : "skipped",
      reason: result.written ? undefined : "unchanged",
      operator: this.operator,
      appliedAt: result.entry.updatedAt,
      appliedRevision: detail.revision,
      manualOverride: true,
      autoApply: false
    });

    return {
      written: result.written,
      name: result.entry.threadName
    };
  }

  async batchApplyDirty(options?: { previewOnly?: boolean }): Promise<
    Array<{ threadId: string; action: "applied" | "skipped" | "preview"; name?: string; reason?: string }>
  > {
    await this.scan();
    const dirtySessions = this.db.getDirtySessions();
    const results: Array<{ threadId: string; action: "applied" | "skipped" | "preview"; name?: string; reason?: string }> = [];

    for (const session of dirtySessions) {
      const detail = this.db.getSessionDetail(session.threadId);
      if (!detail) {
        continue;
      }
      if (detail.frozen) {
        results.push({ threadId: detail.threadId, action: "skipped", reason: "frozen" });
        continue;
      }
      if (detail.manualOverride) {
        results.push({ threadId: detail.threadId, action: "skipped", reason: "manual_override" });
        continue;
      }

      const suggestion = await this.suggest(detail.threadId);
      if (options?.previewOnly) {
        results.push({ threadId: detail.threadId, action: "preview", name: suggestion.name });
        continue;
      }

      const applied = await this.apply(detail.threadId);
      results.push({
        threadId: detail.threadId,
        action: applied.written ? "applied" : "skipped",
        name: applied.name,
        reason: applied.written ? undefined : "unchanged"
      });
    }

    return results;
  }

  async compactIndex(options?: { dryRun?: boolean }): Promise<Awaited<ReturnType<typeof compactSessionIndex>>> {
    const result = await compactSessionIndex({
      filePath: this.sessionIndexPath,
      dryRun: options?.dryRun,
      backupDir: this.backupDir
    });
    this.sessionIndexCache = undefined;
    return result;
  }

  async getRenameHistory(threadId: string) {
    await this.scan();
    this.requireSessionDetail(threadId);
    return this.db.getRenameHistory(threadId);
  }

  async freeze(threadId: string): Promise<void> {
    await this.scan();
    this.requireSessionDetail(threadId);
    this.db.setFrozen(threadId, true);
  }

  async unfreeze(threadId: string): Promise<void> {
    await this.scan();
    this.requireSessionDetail(threadId);
    this.db.setFrozen(threadId, false);
  }

  async setManualOverride(threadId: string): Promise<void> {
    await this.scan();
    this.requireSessionDetail(threadId);
    this.db.setManualOverride(threadId, true);
  }

  async clearManualOverride(threadId: string): Promise<void> {
    await this.scan();
    this.requireSessionDetail(threadId);
    this.db.setManualOverride(threadId, false);
  }

  async printConfig(): Promise<Record<string, unknown>> {
    const providerDiagnostics = inspectRenameProvider(this.config);

    return {
      general: this.config.general,
      rename: this.config.rename,
      watch: this.config.watch,
      naming: this.config.naming,
      ai: this.config.ai,
      providerProfiles: this.config.providerProfiles.map((profile) => ({
        ...profile,
        apiKey: redactSecret(profile.apiKey),
        apiKeyRef: profile.apiKeyRef ?? undefined
      })),
      inheritedCodex: {
        modelProvider: this.config.inheritedCodex.modelProvider,
        model: this.config.inheritedCodex.model,
        providers: this.config.inheritedCodex.providers,
        auth: this.config.inheritedCodex.auth
          ? {
              authMode: this.config.inheritedCodex.auth.authMode,
              openaiApiKey: redactSecret(this.config.inheritedCodex.auth.openaiApiKey),
              accessToken: redactSecret(this.config.inheritedCodex.auth.accessToken),
              hasOpenaiApiKey: Boolean(this.config.inheritedCodex.auth.openaiApiKey),
              hasAccessToken: Boolean(this.config.inheritedCodex.auth.accessToken)
            }
          : undefined
      },
      resolvedProvider: providerDiagnostics
    };
  }

  async getConfigView(): Promise<ConfigView> {
    return loadConfigView({
      cwd: this.cwd,
      configPath: this.configPath,
      overrides: this.overrides,
      effectiveConfig: this.config,
      effectiveConfigView: await this.printConfig()
    });
  }

  async updateConfig(
    patch: ConfigDocument
  ): Promise<{ writtenTo: string; restartRequired: boolean; config: ConfigView }> {
    const nextStateDir = patch.general?.stateDir;
    if (nextStateDir && nextStateDir !== this.config.general.stateDir) {
      throw new Error("Updating general.stateDir via the running API is not supported. Restart with a new state dir instead.");
    }

    const result = await writeUserConfig({
      cwd: this.cwd,
      configPath: this.configPath,
      patch
    });
    await this.reloadConfig();
    return {
      writtenTo: result.userConfigPath,
      restartRequired: false,
      config: await this.getConfigView()
    };
  }

  async testProvider(options?: { threadId?: string }): Promise<Record<string, unknown>> {
    const diagnostics = inspectRenameProvider(this.config);
    let session: MaterializedSession;

    if (options?.threadId) {
      await this.scan();
      const detail = this.requireSessionDetail(options.threadId);
      session = await this.materializeSessionForSuggestion(detail);
    } else {
      const syntheticSession: MaterializedSession = this.buildSyntheticPromptSession();
      session = {
        ...syntheticSession,
        renameContext: buildRenameContext(syntheticSession, this.config)
      };
    }

    const suggestion = await this.inferenceService.suggest(session);
    return {
      ok: this.config.ai.backend === "none" ? true : suggestion.source === "ai",
      diagnostics,
      session: {
        threadId: session.threadId,
        projectName: session.projectName,
        synthetic: !options?.threadId
      },
      suggestion
    };
  }

  async buildPromptPreview(options?: { threadId?: string }): Promise<PromptPreview> {
    let session: MaterializedSession;
    if (options?.threadId) {
      await this.scan();
      const detail = this.requireSessionDetail(options.threadId);
      session = await this.materializeSessionForSuggestion(detail);
    } else {
      const syntheticSession = this.buildSyntheticPromptSession();
      session = {
        ...syntheticSession,
        renameContext: buildRenameContext(syntheticSession, this.config)
      };
    }

    return {
      threadId: session.threadId,
      synthetic: !options?.threadId,
      prompt: buildRenamePrompt(session, this.config),
      renameContext:
        session.renameContext ??
        buildRenameContext(session, this.config)
    };
  }

  async doctor(): Promise<DoctorReport> {
    const stats = await readSessionIndex(this.sessionIndexPath);
    const sessionsDir = path.join(this.config.general.codexHome, "sessions");
    const dbPath = path.join(this.config.general.stateDir, "app.db");

    const [codexHomeExists, sessionsDirExists, dbExists] = await Promise.all([
      fs
        .stat(this.config.general.codexHome)
        .then(() => true)
        .catch(() => false),
      fs
        .stat(sessionsDir)
        .then(() => true)
        .catch(() => false),
      fs
        .stat(dbPath)
        .then(() => true)
        .catch(() => false)
    ]);

    const sessionIndexReadable = await fs
      .access(this.sessionIndexPath)
      .then(() => true)
      .catch(() => false);

    const sessionIndexWritable = await fs
      .access(path.dirname(this.sessionIndexPath), fsConstants.W_OK)
      .then(() => true)
      .catch(() => false);

    return {
      codexHomeExists,
      sessionsDirExists,
      sessionIndexReadable,
      sessionIndexWritable,
      dbPath,
      dbExists,
      stats: stats.stats,
      autoRename: {
        ...this.config.watch,
        autoApply: this.config.rename.autoApply
      },
      provider: inspectRenameProvider(this.config) as unknown as Record<string, unknown>
    };
  }

  async overview(): Promise<OverviewReport> {
    await this.scan();
    const report = this.db.getOverviewReport();
    return {
      ...report,
      runtime: {
        configuredAutoApply: this.config.rename.autoApply,
        actualExecution: "preview-only",
        daemonAutoApply: false,
        explain:
          "Current daemon behavior is scan + preview only. `finalize_ready` means eligible to apply, not already auto-applied."
      }
    };
  }

  async previewAutoRename(options?: {
    includeCandidateNames?: boolean;
    limit?: number;
  }): Promise<AutoRenamePreview[]> {
    await this.scan();
    const now = new Date();
    const previews: AutoRenamePreview[] = [];
    const dirtySessions = this.db.getDirtySessions();
    const limit =
      typeof options?.limit === "number" && Number.isFinite(options.limit) && options.limit > 0
        ? Math.trunc(options.limit)
        : dirtySessions.length;

    for (const session of dirtySessions) {
      if (previews.length >= limit) {
        break;
      }
      const detail = this.db.getSessionDetail(session.threadId);
      if (!detail) {
        continue;
      }

      const renameState = this.db.getRenameState(detail.threadId);
      const evaluation = evaluateAutoRename(detail, this.config, {
        now,
        renameState
      });

      previews.push({
        threadId: detail.threadId,
        candidateName:
          options?.includeCandidateNames && evaluation.action !== "skip"
            ? (await this.inferenceService.suggest(await this.materializeSessionForSuggestion(detail))).name
            : undefined,
        status: evaluation.action,
        reason: evaluation.reason
      });
    }

    return previews;
  }

  private async readSessionIndexSnapshot(): Promise<SessionIndexSnapshot> {
    try {
      const stat = await fs.stat(this.sessionIndexPath);
      if (
        this.sessionIndexCache &&
        this.sessionIndexCache.size === stat.size &&
        this.sessionIndexCache.mtimeMs === stat.mtimeMs
      ) {
        return this.sessionIndexCache.snapshot;
      }

      const snapshot = await readSessionIndex(this.sessionIndexPath);
      this.sessionIndexCache = {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        snapshot
      };
      return snapshot;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        const snapshot = await readSessionIndex(this.sessionIndexPath);
        this.sessionIndexCache = {
          size: 0,
          mtimeMs: 0,
          snapshot
        };
        return snapshot;
      }
      throw error;
    }
  }
}
