import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  type AiRequestLogReport,
  type ConfigDocument,
  type ConfigView,
  SESSION_INDEX_FILENAME,
  type AutoRenamePreview,
  type DoctorReport,
  type EffectiveConfig,
  type MaterializedSession,
  type NamingStyle,
  type OverviewReport,
  type PromptPreview,
  type RenameHistoryRecord,
  type RenameReplayResult,
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
import { deepMerge, toUtcIso } from "./util.js";

function redactSecret(value?: string): string | undefined {
  return value ? "[redacted]" : undefined;
}

type DaemonSweepSnapshot = {
  lastSweepAt: string;
  intervalSeconds: number;
  processId?: number;
  summary: {
    total: number;
    suggest: number;
    apply: number;
    skip: number;
    autoApplied: number;
    unchanged: number;
    execution: "preview-only" | "auto-apply";
  };
};

const ACCEPTED_OFFICIAL_RENAME_SOURCES = ["ai", "manual"] as const;

function normalizeComparableName(name: string): string {
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
  const root =
    trimmedRoot.length > budget ? trimmedRoot.slice(0, budget).trimEnd() : trimmedRoot;
  return `${root}${suffix}`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const maxConcurrency = Math.max(1, Math.trunc(concurrency));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await worker(items[currentIndex] as T, currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(maxConcurrency, items.length) }, () => runWorker()));
  return results;
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
    this.inferenceService = createRenameInferenceService(config, {
      requestLogger: {
        start: (entry) => this.db.startAiRequestLog(entry),
        finish: (entry) => this.db.finishAiRequestLog(entry)
      }
    });
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
    this.inferenceService = createRenameInferenceService(nextConfig, {
      requestLogger: {
        start: (entry) => this.db.startAiRequestLog(entry),
        finish: (entry) => this.db.finishAiRequestLog(entry)
      }
    });
    this.sessionIndexCache = undefined;
  }

  private requireSessionDetail(threadId: string): SessionDetail {
    const detail = this.db.getSessionDetail(threadId);
    if (!detail) {
      throw new Error(`Unknown session: ${threadId}`);
    }
    return detail;
  }

  private resolveEffectiveNamingStyle(
    detail?: Pick<SessionDetail, "preferredNamingStyle">,
    renameState?: { preferredStyle?: NamingStyle },
    explicitStyle?: NamingStyle,
    config: EffectiveConfig = this.config
  ): NamingStyle {
    return explicitStyle ?? detail?.preferredNamingStyle ?? renameState?.preferredStyle ?? config.naming.defaultStyle;
  }

  private buildSyntheticPromptSession(config: EffectiveConfig = this.config): MaterializedSession {
    return {
      threadId: "provider-test",
      rolloutPath: "<synthetic>",
      cwd: process.cwd(),
      projectName: path.basename(process.cwd()),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      modelProvider: config.inheritedCodex.modelProvider,
      model: config.inheritedCodex.model,
      firstUserMessage: "为当前会话生成一个简短、清晰的中文标题。",
      lastUserMessage: "请测试当前 AI rename backend 是否可用。",
      lastAgentMessage: "这是 provider test 的 synthetic session。",
      taskCompleteCount: 1,
      tokenTotal: 128
    };
  }

  private resolvePreviewConfig(userConfig?: ConfigDocument): EffectiveConfig {
    if (!userConfig) {
      return this.config;
    }
    return deepMerge(this.config, userConfig as Partial<EffectiveConfig>);
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
    const blockedOfficialThreadIds = this.getBlockedOfficialNameThreadIds();
    for (const session of this.db.listSessions()) {
      const rawDetail = this.db.getSessionDetail(session.threadId);
      if (!rawDetail) {
        continue;
      }
      const detail = this.applyOfficialNamingPolicy(rawDetail, blockedOfficialThreadIds);
      this.db.updateStatusEstimate(detail.threadId, estimateSessionStatus(detail, this.config, now));
    }

    return {
      scannedRollouts: rolloutFiles.length,
      updatedSessions
    };
  }

  async listSessions(options?: { dirty?: boolean }): Promise<SessionSummary[]> {
    await this.scan();
    const blockedOfficialThreadIds = this.getBlockedOfficialNameThreadIds();
    return this.db
      .listSessions()
      .map((session) => this.applyOfficialNamingPolicy(session, blockedOfficialThreadIds))
      .filter((session) => (options?.dirty === undefined ? true : session.dirty === options.dirty));
  }

  async listWorkspaces(options?: { dirty?: boolean }): Promise<WorkspaceSummary[]> {
    await this.scan();
    return this.buildWorkspaceSummaries(await this.listSessions(options));
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
    const blockedOfficialThreadIds = this.getBlockedOfficialNameThreadIds();
    const normalizedDetail = this.applyOfficialNamingPolicy(detail, blockedOfficialThreadIds);
    return {
      ...normalizedDetail,
      renameHistory: this.filterVisibleRenameHistory(this.db.getRenameHistory(threadId)),
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

  private async materializeSessionForSuggestion(
    detail: SessionDetail,
    style?: NamingStyle,
    config: EffectiveConfig = this.config
  ): Promise<MaterializedSession> {
    const transcriptStrategies = new Set([
      "user-assistant-transcript",
      "user-only-transcript",
      "assistant-only-transcript",
      "user-transcript-last-assistant",
      "paired-user-turns"
    ]);
    const transcript =
      transcriptStrategies.has(config.naming.contextStrategy)
        ? detail.transcript ?? (await readSessionTranscript(detail.rolloutPath))
        : undefined;

    return {
      ...detail,
      namingStyle: this.resolveEffectiveNamingStyle(detail, undefined, style, config),
      renameContext: buildRenameContext(detail, config, {
        transcript
      })
    };
  }

  private async resolveSuggestionForDetail(
    detail: SessionDetail,
    options?: {
      saveCandidate?: boolean;
      reservedNameKeys?: Set<string>;
      blockedOfficialThreadIds?: Set<string>;
      style?: NamingStyle;
      reservationScheduler?: <T>(callback: () => T | Promise<T>) => Promise<T>;
    }
  ): Promise<RenameSuggestion> {
    const renameState = this.db.getRenameState(detail.threadId);
    const targetStyle = this.resolveEffectiveNamingStyle(detail, renameState, options?.style);
    const candidateGeneratedAt = renameState?.currentCandidateGeneratedAt
      ? Date.parse(renameState.currentCandidateGeneratedAt)
      : Number.NaN;
    const sessionUpdatedAt = detail.updatedAt ? Date.parse(detail.updatedAt) : Number.NaN;
    const canReuseCandidate =
      Boolean(renameState?.currentCandidateName && renameState.currentCandidateGeneratedAt) &&
      renameState?.currentCandidateStyle === targetStyle &&
      (this.isAcceptedOfficialRenameSource(renameState?.currentCandidateSource) ||
        !this.requiresAcceptedRewrite(renameState)) &&
      (!Number.isFinite(sessionUpdatedAt) ||
        !Number.isFinite(candidateGeneratedAt) ||
        candidateGeneratedAt >= sessionUpdatedAt);

    if (canReuseCandidate) {
      const finalizeReusedSuggestion = () => {
        const reusedSuggestion = this.ensureUniqueRenameSuggestion(
          detail.threadId,
          {
            threadId: detail.threadId,
            name: renameState?.currentCandidateName ?? "",
            source: renameState?.currentCandidateSource ?? "heuristic",
            style: targetStyle,
            kind: "chore",
            summary: renameState?.currentCandidateName ?? "",
            generatedAt: renameState?.currentCandidateGeneratedAt ?? new Date().toISOString()
          },
          {
            reservedNameKeys: options?.reservedNameKeys,
            blockedOfficialThreadIds: options?.blockedOfficialThreadIds
          }
        );
        if (options?.saveCandidate !== false && reusedSuggestion.name !== renameState?.currentCandidateName) {
          this.db.saveCandidate(detail.threadId, reusedSuggestion);
        }
        if (options?.reservedNameKeys) {
          options.reservedNameKeys.add(normalizeComparableName(reusedSuggestion.name));
        }
        return reusedSuggestion;
      };

      return options?.reservationScheduler
        ? options.reservationScheduler(finalizeReusedSuggestion)
        : finalizeReusedSuggestion();
    }

    const rawSuggestion = await this.inferenceService.suggest(
      await this.materializeSessionForSuggestion(detail, targetStyle)
    );
    const finalizeSuggestion = () => {
      const suggestion = this.ensureUniqueRenameSuggestion(
        detail.threadId,
        rawSuggestion,
        {
          reservedNameKeys: options?.reservedNameKeys,
          blockedOfficialThreadIds: options?.blockedOfficialThreadIds
        }
      );
      if (options?.saveCandidate !== false) {
        this.db.saveCandidate(detail.threadId, suggestion);
      }
      if (options?.reservedNameKeys) {
        options.reservedNameKeys.add(normalizeComparableName(suggestion.name));
      }
      return suggestion;
    };

    return options?.reservationScheduler
      ? options.reservationScheduler(finalizeSuggestion)
      : finalizeSuggestion();
  }

  async suggest(threadId: string, options?: { style?: NamingStyle }): Promise<RenameSuggestion> {
    await this.scan();
    const detail = this.requireSessionDetail(threadId);
    return this.resolveSuggestionForDetail(detail, {
      style: options?.style
    });
  }

  async apply(
    threadId: string,
    options?: {
      autoApply?: boolean;
      skipScan?: boolean;
      detail?: SessionDetail;
      style?: NamingStyle;
    }
  ): Promise<{ written: boolean; name: string }> {
    if (!options?.skipScan) {
      await this.scan();
    }
    const detail = options?.detail ?? this.requireSessionDetail(threadId);
    const renameState = this.db.getRenameState(threadId);
    const suggestion = await this.resolveSuggestionForDetail(detail, {
      style: options?.style
    });

    const result = await appendSessionIndexRename({
      filePath: this.sessionIndexPath,
      threadId,
      threadName: suggestion.name
    });
    this.sessionIndexCache = undefined;
    const persistAppliedState =
      !result.written &&
      (renameState?.lastAppliedName !== suggestion.name ||
        renameState?.lastAppliedSource !== suggestion.source ||
        renameState?.lastAppliedStyle !== suggestion.style ||
        renameState?.lastAppliedRevision !== detail.revision);
    const appliedAt = persistAppliedState ? toUtcIso() : result.entry.updatedAt;
    this.db.recordRename({
      threadId,
      newName: suggestion.name,
      source: suggestion.source,
      kind: suggestion.source === "manual" ? "manual" : "auto",
      status: result.written ? "applied" : "skipped",
      reason: result.written ? undefined : "unchanged",
      style: suggestion.style,
      operator: this.operator,
      appliedAt,
      appliedRevision: detail.revision,
      manualOverride: false,
      autoApply: options?.autoApply ?? false,
      persistAppliedState
    });

    return {
      written: result.written,
      name: result.entry.threadName
    };
  }

  async rename(threadId: string, name: string): Promise<{ written: boolean; name: string }> {
    await this.scan();
    const detail = this.requireSessionDetail(threadId);
    const renameState = this.db.getRenameState(threadId);
    const style = this.resolveEffectiveNamingStyle(detail, renameState);
    const uniqueName = this.ensureUniqueName(name, threadId);

    const result = await appendSessionIndexRename({
      filePath: this.sessionIndexPath,
      threadId,
      threadName: uniqueName
    });
    this.sessionIndexCache = undefined;
    const persistAppliedState =
      !result.written &&
      (renameState?.lastAppliedName !== result.entry.threadName ||
        renameState?.lastAppliedSource !== "manual" ||
        renameState?.lastAppliedStyle !== style ||
        renameState?.lastAppliedRevision !== detail.revision);
    const appliedAt = persistAppliedState ? toUtcIso() : result.entry.updatedAt;

    this.db.recordRename({
      threadId,
      newName: result.entry.threadName,
      source: "manual",
      kind: "manual",
      status: result.written ? "applied" : "skipped",
      reason: result.written ? undefined : "unchanged",
      style,
      operator: this.operator,
      appliedAt,
      appliedRevision: detail.revision,
      manualOverride: true,
      autoApply: false,
      persistAppliedState
    });

    return {
      written: result.written,
      name: result.entry.threadName
    };
  }

  async setNamingStyle(
    threadId: string,
    preferredStyle?: NamingStyle
  ): Promise<{ threadId: string; preferredStyle?: NamingStyle; effectiveStyle: NamingStyle }> {
    await this.scan();
    const detail = this.requireSessionDetail(threadId);
    const previousState = this.db.getRenameState(threadId);
    this.db.setPreferredStyle(threadId, preferredStyle);
    const effectiveStyle = this.resolveEffectiveNamingStyle(
      {
        ...detail,
        preferredNamingStyle: preferredStyle
      },
      undefined,
      undefined
    );
    if (previousState?.currentCandidateName && previousState.currentCandidateStyle !== effectiveStyle) {
      this.db.clearCandidate(threadId);
    }
    return {
      threadId,
      preferredStyle,
      effectiveStyle
    };
  }

  async batchApplyDirty(options?: { previewOnly?: boolean }): Promise<
    Array<{ threadId: string; action: "applied" | "skipped" | "preview"; name?: string; reason?: string }>
  > {
    await this.scan();
    const dirtySessions = await this.listSessions({ dirty: true });
    const blockedOfficialThreadIds = this.getBlockedOfficialNameThreadIds();
    const reservedNameKeys = this.collectReservedOfficialNameKeys({
      blockedOfficialThreadIds
    });
    const results: Array<{ threadId: string; action: "applied" | "skipped" | "preview"; name?: string; reason?: string }> = [];

    for (const session of dirtySessions) {
      const detail = this.db.getSessionDetail(session.threadId);
      if (!detail) {
        continue;
      }
      const normalizedDetail = this.applyOfficialNamingPolicy(detail, blockedOfficialThreadIds);
      if (normalizedDetail.frozen) {
        results.push({ threadId: normalizedDetail.threadId, action: "skipped", reason: "frozen" });
        continue;
      }
      if (normalizedDetail.manualOverride) {
        results.push({ threadId: normalizedDetail.threadId, action: "skipped", reason: "manual_override" });
        continue;
      }

      const suggestion = await this.resolveSuggestionForDetail(normalizedDetail, {
        reservedNameKeys,
        blockedOfficialThreadIds
      });
      reservedNameKeys.add(normalizeComparableName(suggestion.name));
      if (options?.previewOnly) {
        results.push({ threadId: normalizedDetail.threadId, action: "preview", name: suggestion.name });
        continue;
      }

      const applied = await this.apply(normalizedDetail.threadId, {
        skipScan: true,
        detail: normalizedDetail
      });
      results.push({
        threadId: normalizedDetail.threadId,
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
    this.db.clearAllCandidates();
    return {
      writtenTo: result.userConfigPath,
      restartRequired: false,
      config: await this.getConfigView()
    };
  }

  async requeueRenamesSince(params: {
    since: string;
    basis: "session-updated-at" | "last-applied-at";
  }): Promise<RenameReplayResult> {
    await this.scan();

    const sinceDate = new Date(params.since);
    if (Number.isNaN(sinceDate.getTime())) {
      throw new Error("Invalid replay timestamp.");
    }

    const result = this.db.queueRenameReplaySince({
      since: sinceDate.toISOString(),
      basis: params.basis
    });

    return {
      since: sinceDate.toISOString(),
      basis: params.basis,
      queued: result.queued,
      clearedCandidates: result.clearedCandidates,
      matchedThreadIds: result.matchedThreadIds
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

  async buildPromptPreview(options?: { threadId?: string; userConfig?: ConfigDocument }): Promise<PromptPreview> {
    const previewConfig = this.resolvePreviewConfig(options?.userConfig);
    let session: MaterializedSession;
    if (options?.threadId) {
      await this.scan();
      const detail = this.requireSessionDetail(options.threadId);
      session = await this.materializeSessionForSuggestion(detail, undefined, previewConfig);
    } else {
      const syntheticSession = this.buildSyntheticPromptSession(previewConfig);
      session = {
        ...syntheticSession,
        renameContext: buildRenameContext(syntheticSession, previewConfig)
      };
    }

    return {
      threadId: session.threadId,
      synthetic: !options?.threadId,
      prompt: buildRenamePrompt(session, previewConfig),
      renameContext:
        session.renameContext ??
        buildRenameContext(session, previewConfig)
    };
  }

  getAiRequestLogReport(limit?: number): AiRequestLogReport {
    return this.db.getAiRequestLogReport(limit);
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
    const blockedOfficialThreadIds = this.getBlockedOfficialNameThreadIds();
    const report = this.db.getOverviewReport({
      nonAcceptedNamedThreadIds: blockedOfficialThreadIds,
      acceptedAppliedSources: [...ACCEPTED_OFFICIAL_RENAME_SOURCES]
    });
    const daemonState = this.db.getMaintenanceState<DaemonSweepSnapshot>("daemon_runtime");
    const daemonStatus = this.resolveDaemonStatus(daemonState);
    const actualExecution =
      daemonStatus === "running" && daemonState?.summary.execution === "auto-apply"
        ? "auto-apply"
        : "preview-only";
    const daemonAutoApply = actualExecution === "auto-apply";
    return {
      ...report,
      runtime: {
        configuredAutoApply: this.config.rename.autoApply,
        actualExecution,
        daemonAutoApply,
        daemonStatus,
        lastSweepAt: daemonState?.lastSweepAt,
        lastSweepIntervalSeconds: daemonState?.intervalSeconds,
        lastSweepSummary: daemonState?.summary,
        explain: this.describeRuntimeState({
          configuredAutoApply: this.config.rename.autoApply,
          daemonStatus,
          actualExecution
        })
      }
    };
  }

  async runAutoRenameSweep(options?: {
    includeCandidateNames?: boolean;
    limit?: number;
    autoApply?: boolean;
    intervalSeconds?: number;
    processId?: number;
    recordRuntime?: boolean;
  }): Promise<{
    previews: AutoRenamePreview[];
    applied: Array<{ threadId: string; written: boolean; name: string; reason?: string }>;
  }> {
    await this.scan();
    const now = new Date();
    const blockedOfficialThreadIds = this.getBlockedOfficialNameThreadIds();
    const reservedNameKeys = this.collectReservedOfficialNameKeys({
      blockedOfficialThreadIds
    });
    const previews: AutoRenamePreview[] = [];
    const applied: Array<{ threadId: string; written: boolean; name: string; reason?: string }> = [];
    const dirtySessions = await this.listSessions({ dirty: true });
    const limit =
      typeof options?.limit === "number" && Number.isFinite(options.limit) && options.limit > 0
        ? Math.trunc(options.limit)
        : dirtySessions.length;
    const autoApplyEnabled =
      (options?.autoApply ?? true) && this.config.rename.autoApply === "idle-finalize";
    const maxConcurrency = Math.max(1, Math.trunc(this.config.ai.maxConcurrency || 1));
    let reservationChain = Promise.resolve();
    const reservationScheduler = async <T>(callback: () => T | Promise<T>): Promise<T> => {
      const scheduled = reservationChain.then(callback);
      reservationChain = scheduled.then(
        () => undefined,
        () => undefined
      );
      return scheduled;
    };
    const workItems: Array<{
      detail: SessionDetail;
      evaluation: ReturnType<typeof evaluateAutoRename>;
    }> = [];

    for (const session of dirtySessions) {
      if (workItems.length >= limit) {
        break;
      }
      const detail = this.db.getSessionDetail(session.threadId);
      if (!detail) {
        continue;
      }
      const normalizedDetail = this.applyOfficialNamingPolicy(detail, blockedOfficialThreadIds);

      const renameState = this.db.getRenameState(normalizedDetail.threadId);
      const evaluation = evaluateAutoRename(normalizedDetail, this.config, {
        now,
        renameState
      });
      workItems.push({
        detail: normalizedDetail,
        evaluation
      });
    }

    const sweepItems = await mapWithConcurrency(workItems, maxConcurrency, async (item) => {
      const shouldResolveSuggestion =
        options?.includeCandidateNames === true || (autoApplyEnabled && item.evaluation.action === "apply");
      const suggestion =
        shouldResolveSuggestion && item.evaluation.action !== "skip"
          ? await this.resolveSuggestionForDetail(item.detail, {
              saveCandidate: autoApplyEnabled || options?.includeCandidateNames === true,
              reservedNameKeys,
              blockedOfficialThreadIds,
              reservationScheduler
            })
          : undefined;

      return {
        ...item,
        suggestion
      };
    });

    for (const item of sweepItems) {
      previews.push({
        threadId: item.detail.threadId,
        candidateName: options?.includeCandidateNames ? item.suggestion?.name : undefined,
        status: item.evaluation.action,
        reason: item.evaluation.reason
      });

      if (autoApplyEnabled && item.evaluation.action === "apply") {
        const result = await this.apply(item.detail.threadId, {
          autoApply: true,
          skipScan: true,
          detail: item.detail
        });
        applied.push({
          threadId: item.detail.threadId,
          written: result.written,
          name: result.name,
          reason: result.written ? undefined : "unchanged"
        });
      }
    }

    const summary = {
      total: previews.length,
      suggest: previews.filter((item) => item.status === "suggest").length,
      apply: previews.filter((item) => item.status === "apply").length,
      skip: previews.filter((item) => item.status === "skip").length,
      autoApplied: applied.filter((item) => item.written).length,
      unchanged: applied.filter((item) => !item.written).length,
      execution: autoApplyEnabled ? "auto-apply" : "preview-only"
    } satisfies DaemonSweepSnapshot["summary"];

    if (options?.recordRuntime !== false) {
      this.db.setMaintenanceState("daemon_runtime", {
        lastSweepAt: now.toISOString(),
        intervalSeconds: Math.max(1, Math.trunc(options?.intervalSeconds ?? this.config.watch.scanIntervalSeconds)),
        processId:
          typeof options?.processId === "number" && Number.isFinite(options.processId)
            ? Math.trunc(options.processId)
            : undefined,
        summary
      } satisfies DaemonSweepSnapshot);
    }

    return {
      previews,
      applied
    };
  }

  async previewAutoRename(options?: {
    includeCandidateNames?: boolean;
    limit?: number;
  }): Promise<AutoRenamePreview[]> {
    const result = await this.runAutoRenameSweep({
      includeCandidateNames: options?.includeCandidateNames,
      limit: options?.limit,
      autoApply: false,
      recordRuntime: false
    });
    return result.previews;
  }

  private getNonAcceptedNamedThreadIds(): Set<string> {
    if (!this.shouldTreatNonAcceptedNamesAsUnnamed()) {
      return new Set<string>();
    }
    return this.db.listNonAcceptedNamedThreadIds([...ACCEPTED_OFFICIAL_RENAME_SOURCES]);
  }

  private getDuplicateAcceptedNamedThreadIds(): Set<string> {
    const groups = new Map<string, Array<{ threadId: string; appliedAt?: string }>>();

    for (const session of this.db.listSessions()) {
      if (!session.officialName) {
        continue;
      }
      const renameState = this.db.getRenameState(session.threadId);
      if (!this.isAcceptedOfficialRenameSource(renameState?.lastAppliedSource)) {
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
          (left, right) =>
            (left.appliedAt ?? "").localeCompare(right.appliedAt ?? "") ||
            left.threadId.localeCompare(right.threadId)
        )
        .slice(1)
        .forEach((item) => duplicateThreadIds.add(item.threadId));
    }
    return duplicateThreadIds;
  }

  private getBlockedOfficialNameThreadIds(): Set<string> {
    return new Set<string>([
      ...this.getNonAcceptedNamedThreadIds(),
      ...this.getDuplicateAcceptedNamedThreadIds()
    ]);
  }

  private collectReservedOfficialNameKeys(options?: {
    excludeThreadId?: string;
    blockedOfficialThreadIds?: Set<string>;
  }): Set<string> {
    const blockedOfficialThreadIds = options?.blockedOfficialThreadIds ?? this.getBlockedOfficialNameThreadIds();
    const reserved = new Set<string>();

    for (const session of this.db.listSessions()) {
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

  private ensureUniqueName(
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
    for (const key of this.collectReservedOfficialNameKeys({
      excludeThreadId: threadId,
      blockedOfficialThreadIds: options?.blockedOfficialThreadIds
    })) {
      reservedNameKeys.add(key);
    }

    if (!reservedNameKeys.has(normalizeComparableName(trimmed))) {
      return trimmed;
    }

    const { root, nextIndex } = splitDisambiguationBase(trimmed);
    const maxLength = Math.max(8, this.config.naming.maxLength);
    let index = nextIndex;
    while (true) {
      const candidate = appendDisambiguationSuffix(root, index, maxLength);
      if (!reservedNameKeys.has(normalizeComparableName(candidate))) {
        return candidate;
      }
      index += 1;
    }
  }

  private ensureUniqueRenameSuggestion(
    threadId: string,
    suggestion: RenameSuggestion,
    options?: {
      reservedNameKeys?: Set<string>;
      blockedOfficialThreadIds?: Set<string>;
    }
  ): RenameSuggestion {
    const uniqueName = this.ensureUniqueName(suggestion.name, threadId, options);
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

  private shouldTreatNonAcceptedNamesAsUnnamed(): boolean {
    return this.config.ai.backend !== "none";
  }

  private isAcceptedOfficialRenameSource(source?: string): boolean {
    return source === "ai" || source === "manual";
  }

  private requiresAcceptedRewrite(renameState?: { lastAppliedSource?: string }): boolean {
    return (
      this.shouldTreatNonAcceptedNamesAsUnnamed() &&
      Boolean(renameState?.lastAppliedSource) &&
      !this.isAcceptedOfficialRenameSource(renameState?.lastAppliedSource)
    );
  }

  private applyOfficialNamingPolicy<T extends SessionSummary | SessionDetail>(
    session: T,
    nonAcceptedNamedThreadIds: Set<string>
  ): T {
    const pendingAcceptedRewrite = nonAcceptedNamedThreadIds.has(session.threadId);
    const effectiveStyle = this.resolveEffectiveNamingStyle(session);
    const candidateStyleMatches =
      !session.candidateName ||
      !session.candidateNamingStyle ||
      session.candidateNamingStyle === effectiveStyle;
    return {
      ...session,
      defaultNamingStyle: this.config.naming.defaultStyle,
      effectiveNamingStyle: effectiveStyle,
      officialName: pendingAcceptedRewrite ? undefined : session.officialName,
      candidateName: candidateStyleMatches ? session.candidateName : undefined,
      dirty: session.dirty || pendingAcceptedRewrite
    };
  }

  private filterVisibleRenameHistory(history: RenameHistoryRecord[]): RenameHistoryRecord[] {
    return history.filter((entry) => this.isAcceptedOfficialRenameSource(entry.source));
  }

  private buildWorkspaceSummaries(sessions: SessionSummary[]): WorkspaceSummary[] {
    const groups = new Map<string, WorkspaceSummary>();

    for (const session of sessions) {
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

  private resolveDaemonStatus(
    daemonState: DaemonSweepSnapshot | undefined
  ): OverviewReport["runtime"]["daemonStatus"] {
    if (!daemonState?.lastSweepAt) {
      return "not_seen";
    }

    const lastSweepAt = Date.parse(daemonState.lastSweepAt);
    if (!Number.isFinite(lastSweepAt)) {
      return "stale";
    }

    if (typeof daemonState.processId === "number" && Number.isFinite(daemonState.processId)) {
      if (!this.isProcessAlive(Math.trunc(daemonState.processId))) {
        return "stale";
      }
    }

    const intervalSeconds = Math.max(1, Math.trunc(daemonState.intervalSeconds || this.config.watch.scanIntervalSeconds));
    const staleAfterMs = Math.max(intervalSeconds * 2_500, 30_000);
    return Date.now() - lastSweepAt <= staleAfterMs ? "running" : "stale";
  }

  private describeRuntimeState(params: {
    configuredAutoApply: EffectiveConfig["rename"]["autoApply"];
    daemonStatus: OverviewReport["runtime"]["daemonStatus"];
    actualExecution: OverviewReport["runtime"]["actualExecution"];
  }): string {
    if (params.actualExecution === "auto-apply") {
      return "A recent daemon heartbeat is active, and `finalize_ready` sessions are being auto-applied back into session_index.jsonl.";
    }

    if (params.configuredAutoApply === "idle-finalize") {
      if (params.daemonStatus === "running") {
        return "A recent daemon heartbeat exists, but the latest sweep is still preview-only. Restart or reload the daemon if you expect auto-apply to be active.";
      }
      if (params.daemonStatus === "stale") {
        return "Auto-apply is configured, but the daemon heartbeat is stale. Start `npm run daemon` to resume finalize-ready applies.";
      }
      if (params.daemonStatus === "not_seen") {
        return "Auto-apply is configured, but no daemon heartbeat has been recorded yet. The API/Web process alone will not apply renames until the daemon starts.";
      }
    }

    if (params.daemonStatus === "running") {
      return "The daemon is running, but `rename.autoApply` is disabled, so sessions remain preview-only until you apply manually.";
    }

    return "No active daemon heartbeat is visible. The runtime stays preview-only until a daemon sweep starts.";
  }

  private isProcessAlive(processId: number): boolean {
    try {
      process.kill(processId, 0);
      return true;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "EPERM") {
        return true;
      }
      return false;
    }
  }
}
