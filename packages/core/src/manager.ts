import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  type AiRequestLogDetail,
  type AiRequestLogReport,
  type ConfigDocument,
  type ConfigView,
  SESSION_INDEX_FILENAME,
  type AutoRenamePreview,
  type DoctorReport,
  type EffectiveConfig,
  type MaterializedSession,
  type OverviewReport,
  type PromptPreview,
  type RenameHistoryRecord,
  type RenameReplayPreviewResult,
  type RenameReplayResult,
  type RenameSuggestion,
  type ScanReport,
  type SessionDetail,
  type SessionIndexSnapshot,
  type SessionSummary,
  type WorkspaceSummary
} from "@codexnamer/shared";

import { loadConfigView, loadEffectiveConfig, writeUserConfig } from "./config.js";
import { StateDatabase } from "./database.js";
import {
  buildRenamePrompt,
  createRenameInferenceService,
  inspectRenameProvider,
  probeRenameProvider,
  resolveRenameProvider
} from "./provider.js";
import {
  ACCEPTED_OFFICIAL_RENAME_SOURCES,
  applyOfficialNamingPolicy,
  applyRuleSignatureState,
  collectReservedOfficialNameKeys,
  ensureUniqueRenameSuggestion,
  filterVisibleRenameHistory,
  getBlockedOfficialNameThreadIds,
  isAcceptedOfficialRenameSource,
  normalizeComparableName,
  requiresAcceptedRewrite,
  summarizeRuleStatus
} from "./manager/naming-policy.js";
import {
  getLastProviderTest,
  rememberProviderTest,
  requireSuccessfulProviderTest as ensureProviderTestReady
} from "./manager/provider-state.js";
import {
  type DaemonSweepSnapshot,
  describeRuntimeState,
  type RenameReplaySnapshot,
  resolveDaemonStatus,
  summarizeSweepErrorReason
} from "./manager/runtime-state.js";
import { buildSessionRevision } from "./revision.js";
import { computeRenameRuleSignature } from "./rule-signature.js";
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
const SCAN_FRESH_WINDOW_MS = 1_200;

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

export class CodexNamer {
  private inferenceService;
  private sessionIndexCache?: {
    size: number;
    mtimeMs: number;
    snapshot: SessionIndexSnapshot;
  };
  private scanPromise?: Promise<ScanReport>;
  private lastScanCompletedAt = 0;
  private lastScanResult: ScanReport = {
    scannedRollouts: 0,
    updatedSessions: 0
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
  }): Promise<CodexNamer> {
    const config = await loadEffectiveConfig({
      cwd: options?.cwd,
      configPath: options?.configPath,
      overrides: options?.overrides
    });
    const db = await StateDatabase.create(path.join(config.general.stateDir, "app.db"));
    return new CodexNamer(config, db, options?.operator, {
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

  get currentRuleSignature(): string {
    return computeRenameRuleSignature(this.config);
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
    this.lastScanCompletedAt = 0;
  }

  private requireSessionDetail(threadId: string): SessionDetail {
    const detail = this.db.getSessionDetail(threadId);
    if (!detail) {
      throw new Error(`Unknown session: ${threadId}`);
    }
    return detail;
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

  private async requireSuccessfulProviderTest(config: EffectiveConfig = this.config): Promise<void> {
    await ensureProviderTestReady(this.db, config);
  }

  private async performScan(): Promise<ScanReport> {
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
    const blockedOfficialThreadIds = getBlockedOfficialNameThreadIds(this.db, this.config);
    for (const session of this.db.listSessions()) {
      const rawDetail = this.db.getSessionDetail(session.threadId);
      if (!rawDetail) {
        continue;
      }
      const detail = applyOfficialNamingPolicy(rawDetail, blockedOfficialThreadIds);
      this.db.updateStatusEstimate(detail.threadId, estimateSessionStatus(detail, this.config, now));
    }

    return {
      scannedRollouts: rolloutFiles.length,
      updatedSessions
    };
  }

  async scan(): Promise<ScanReport> {
    if (this.scanPromise) {
      return this.scanPromise;
    }

    if (Date.now() - this.lastScanCompletedAt <= SCAN_FRESH_WINDOW_MS) {
      return this.lastScanResult;
    }

    this.scanPromise = this.performScan()
      .then((result) => {
        this.lastScanResult = result;
        this.lastScanCompletedAt = Date.now();
        return result;
      })
      .finally(() => {
        this.scanPromise = undefined;
      });

    return this.scanPromise;
  }

  async listSessions(options?: { dirty?: boolean }): Promise<SessionSummary[]> {
    await this.scan();
    const blockedOfficialThreadIds = getBlockedOfficialNameThreadIds(this.db, this.config);
    return this.db
      .listSessions()
      .map((session) =>
        applyRuleSignatureState(applyOfficialNamingPolicy(session, blockedOfficialThreadIds), this.currentRuleSignature)
      )
      .filter((session) => (options?.dirty === undefined ? true : session.dirty === options.dirty));
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
    const blockedOfficialThreadIds = getBlockedOfficialNameThreadIds(this.db, this.config);
    const normalizedDetail = applyRuleSignatureState(
      applyOfficialNamingPolicy(detail, blockedOfficialThreadIds),
      this.currentRuleSignature
    );
    return {
      ...normalizedDetail,
      renameHistory: filterVisibleRenameHistory(this.db.getRenameHistory(threadId)),
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
      reservationScheduler?: <T>(callback: () => T | Promise<T>) => Promise<T>;
    }
  ): Promise<RenameSuggestion> {
    await this.requireSuccessfulProviderTest();
    const currentRuleSignature = this.currentRuleSignature;
    const renameState = this.db.getRenameState(detail.threadId);
    const candidateGeneratedAt = renameState?.currentCandidateGeneratedAt
      ? Date.parse(renameState.currentCandidateGeneratedAt)
      : Number.NaN;
    const sessionUpdatedAt = detail.updatedAt ? Date.parse(detail.updatedAt) : Number.NaN;
    const canReuseCandidate =
      Boolean(renameState?.currentCandidateName && renameState.currentCandidateGeneratedAt) &&
      renameState?.currentCandidateRuleSignature === currentRuleSignature &&
      (isAcceptedOfficialRenameSource(renameState?.currentCandidateSource) ||
        !requiresAcceptedRewrite(this.config, renameState)) &&
      (!Number.isFinite(sessionUpdatedAt) ||
        !Number.isFinite(candidateGeneratedAt) ||
        candidateGeneratedAt >= sessionUpdatedAt);

    if (canReuseCandidate) {
      const finalizeReusedSuggestion = () => {
        const reusedSuggestion = ensureUniqueRenameSuggestion(
          this.db,
          this.config,
          detail.threadId,
          {
            threadId: detail.threadId,
            name: renameState?.currentCandidateName ?? "",
            source: renameState?.currentCandidateSource ?? "heuristic",
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
          this.db.saveCandidate(detail.threadId, {
            ...reusedSuggestion,
            ruleSignature: currentRuleSignature
          });
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
      await this.materializeSessionForSuggestion(detail)
    );
    const finalizeSuggestion = () => {
      const suggestion = ensureUniqueRenameSuggestion(
        this.db,
        this.config,
        detail.threadId,
        rawSuggestion,
        {
          reservedNameKeys: options?.reservedNameKeys,
          blockedOfficialThreadIds: options?.blockedOfficialThreadIds
        }
      );
      if (options?.saveCandidate !== false) {
        this.db.saveCandidate(detail.threadId, {
          ...suggestion,
          ruleSignature: currentRuleSignature
        });
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

  async suggest(threadId: string): Promise<RenameSuggestion> {
    await this.scan();
    const detail = this.requireSessionDetail(threadId);
    const suggestion = await this.resolveSuggestionForDetail(detail);
    this.db.recordRename({
      threadId,
      newName: suggestion.name,
      source: suggestion.source,
      kind: suggestion.source === "manual" ? "manual" : "auto",
      status: "preview_only",
      operator: this.operator,
      appliedAt: suggestion.generatedAt,
      appliedRevision: detail.revision,
      ruleSignature: this.currentRuleSignature,
      autoApply: false
    });
    return suggestion;
  }

  async apply(
    threadId: string,
    options?: {
      autoApply?: boolean;
      skipScan?: boolean;
      detail?: SessionDetail;
    }
  ): Promise<{ written: boolean; name: string }> {
    if (!options?.skipScan) {
      await this.scan();
    }
    const detail = options?.detail ?? this.requireSessionDetail(threadId);
    const renameState = this.db.getRenameState(threadId);
    const suggestion = await this.resolveSuggestionForDetail(detail);

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
        renameState?.lastAppliedRevision !== detail.revision);
    const appliedAt = persistAppliedState ? toUtcIso() : result.entry.updatedAt;
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
      ruleSignature: suggestion.source === "manual" ? undefined : this.currentRuleSignature,
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
    const uniqueName = ensureUniqueRenameSuggestion(this.db, this.config, threadId, {
      threadId,
      name,
      source: "manual",
      kind: "chore",
      summary: name,
      generatedAt: new Date().toISOString()
    }).name;

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
        renameState?.lastAppliedRevision !== detail.revision);
    const appliedAt = persistAppliedState ? toUtcIso() : result.entry.updatedAt;

    this.db.recordRename({
      threadId,
      newName: result.entry.threadName,
      source: "manual",
      kind: "manual",
      status: result.written ? "applied" : "skipped",
      reason: result.written ? undefined : "unchanged",
      operator: this.operator,
      appliedAt,
      appliedRevision: detail.revision,
      ruleSignature: undefined,
      autoApply: false,
      persistAppliedState
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
    const dirtySessions = await this.listSessions({ dirty: true });
    const blockedOfficialThreadIds = getBlockedOfficialNameThreadIds(this.db, this.config);
    const reservedNameKeys = collectReservedOfficialNameKeys(this.db, this.config, {
      blockedOfficialThreadIds
    });
    const results: Array<{ threadId: string; action: "applied" | "skipped" | "preview"; name?: string; reason?: string }> = [];

    for (const session of dirtySessions) {
      const detail = this.db.getSessionDetail(session.threadId);
      if (!detail) {
        continue;
      }
      const normalizedDetail = applyOfficialNamingPolicy(detail, blockedOfficialThreadIds);
      if (normalizedDetail.frozen) {
        results.push({ threadId: normalizedDetail.threadId, action: "skipped", reason: "frozen" });
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

  async printConfig(): Promise<Record<string, unknown>> {
    const providerDiagnostics = inspectRenameProvider(this.config);
    const lastProviderTest = getLastProviderTest(this.db, this.config);

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
      resolvedProvider: providerDiagnostics,
      lastProviderTest
    };
  }

  parseCodexProviderConfig(): Record<string, unknown> {
    const previewConfig = deepMerge(this.config, {
      ai: {
        providerSource: "codex-config"
      }
    } as Partial<EffectiveConfig>);
    const resolved = resolveRenameProvider(previewConfig);
    return {
      source: "codex-config",
      profile: {
        requestType: resolved?.requestType ?? (previewConfig.ai.backend === "none" ? "responses" : previewConfig.ai.backend),
        providerRef: resolved?.providerRef,
        baseUrl: resolved?.baseUrl,
        model: resolved?.model,
        apiKey: resolved?.credentialKind === "api-key" ? resolved.credentialValue : undefined
      }
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

  async previewRequeueRenamesSince(params: {
    since: string;
    basis: "session-updated-at" | "last-applied-at";
  }): Promise<RenameReplayPreviewResult> {
    await this.scan();

    const sinceDate = new Date(params.since);
    if (Number.isNaN(sinceDate.getTime())) {
      throw new Error("Invalid replay timestamp.");
    }

    const currentRuleSignature = this.currentRuleSignature;
    const candidates = this.db.listRenameReplayCandidatesSince({
      since: sinceDate.toISOString(),
      basis: params.basis
    });
    const queueCounts = new Map<string, number>();
    const skipCounts = new Map<string, number>();
    const items: RenameReplayPreviewResult["items"] = candidates.map((candidate) => {
      const ruleStatus = summarizeRuleStatus({
        lastAppliedSource: candidate.lastAppliedSource,
        lastAppliedRuleSignature: candidate.lastAppliedRuleSignature,
        currentRuleSignature
      });
      let action: "queue" | "skip" = "queue";
      let reason: RenameReplayPreviewResult["items"][number]["reason"] = "rule_mismatch";

      if (candidate.frozen) {
        action = "skip";
        reason = "frozen";
      } else if (candidate.lastAppliedSource === "manual") {
        action = "skip";
        reason = "manual_name";
      } else if (!candidate.lastAppliedRuleSignature) {
        action = "queue";
        reason = "legacy_unknown_rule";
      } else if (candidate.lastAppliedRuleSignature === currentRuleSignature && !candidate.dirty) {
        action = "skip";
        reason = "already_latest_rule";
      } else if (candidate.lastAppliedRuleSignature === currentRuleSignature && candidate.dirty) {
        action = "queue";
        reason = "content_changed";
      } else {
        action = "queue";
        reason = "rule_mismatch";
      }

      const counter = action === "queue" ? queueCounts : skipCounts;
      counter.set(reason, (counter.get(reason) ?? 0) + 1);
      return {
        threadId: candidate.threadId,
        updatedAt: candidate.updatedAt,
        officialName: candidate.officialName,
        ruleStatus,
        action,
        reason
      };
    });

    return {
      since: sinceDate.toISOString(),
      basis: params.basis,
      currentRuleSignature,
      matched: items.length,
      queued: items.filter((item) => item.action === "queue").length,
      skipped: items.filter((item) => item.action === "skip").length,
      queueCounts: Object.fromEntries(queueCounts.entries()),
      skipCounts: Object.fromEntries(skipCounts.entries()),
      items
    };
  }

  async requeueRenamesSince(params: {
    since: string;
    basis: "session-updated-at" | "last-applied-at";
  }): Promise<RenameReplayResult> {
    const preview = await this.previewRequeueRenamesSince(params);
    const threadIds = preview.items.filter((item) => item.action === "queue").map((item) => item.threadId);
    const result = this.db.queueRenameReplayThreadIds(threadIds);

    const requestedAt = new Date().toISOString();
    const previousState = this.db.getMaintenanceState<RenameReplaySnapshot>("rename_replay");
    this.db.setMaintenanceState("rename_replay", {
      lastRunAt: requestedAt,
      recentRuns: [
        {
          requestedAt,
          since: preview.since,
          basis: params.basis,
          queued: result.queued,
          clearedCandidates: result.clearedCandidates,
          skipped: preview.skipped,
          skipCounts: preview.skipCounts
        },
        ...(previousState?.recentRuns ?? [])
      ].slice(0, 8)
    } satisfies RenameReplaySnapshot);

    return {
      since: preview.since,
      basis: params.basis,
      queued: result.queued,
      clearedCandidates: result.clearedCandidates,
      matchedThreadIds: result.matchedThreadIds,
      skipped: preview.skipped,
      skipCounts: preview.skipCounts
    };
  }

  async testProvider(options?: { userConfig?: ConfigDocument }): Promise<Record<string, unknown>> {
    const previewConfig = this.resolvePreviewConfig(options?.userConfig);
    const result = await probeRenameProvider(previewConfig);
    rememberProviderTest(this.db, previewConfig, {
      ok: result.ok,
      testedAt: result.testedAt,
      latencyMs: result.latencyMs,
      diagnostics: result.diagnostics as unknown as Record<string, unknown>,
      responseText: result.responseText,
      error: result.error
    });
    return result;
  }

  async buildPromptPreview(options?: { threadId?: string; userConfig?: ConfigDocument }): Promise<PromptPreview> {
    const previewConfig = this.resolvePreviewConfig(options?.userConfig);
    let session: MaterializedSession;
    if (options?.threadId) {
      await this.scan();
      const detail = this.requireSessionDetail(options.threadId);
      session = await this.materializeSessionForSuggestion(detail, previewConfig);
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

  getAiRequestLogReport(options?: {
    limit?: number;
    page?: number;
    search?: string;
    project?: string;
    status?: "running" | "succeeded" | "failed";
    transport?: "responses" | "openai-compatible";
  }): AiRequestLogReport {
    return this.db.getAiRequestLogReport(options);
  }

  getAiRequestLogDetail(id: number): AiRequestLogDetail | undefined {
    return this.db.getAiRequestLogDetail(id);
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
    const blockedOfficialThreadIds = getBlockedOfficialNameThreadIds(this.db, this.config);
    const report = this.db.getOverviewReport({
      nonAcceptedNamedThreadIds: blockedOfficialThreadIds,
      acceptedAppliedSources: [...ACCEPTED_OFFICIAL_RENAME_SOURCES]
    });
    const currentRuleSignature = this.currentRuleSignature;
    const sessions = this.db
      .listSessions()
      .map((session) =>
        applyRuleSignatureState(applyOfficialNamingPolicy(session, blockedOfficialThreadIds), currentRuleSignature)
      );
    const ruleCoverage = sessions.reduce(
      (summary, session) => {
        switch (session.ruleStatus) {
          case "latest":
            summary.latest += 1;
            break;
          case "outdated":
            summary.outdated += 1;
            break;
          case "manual":
            summary.manual += 1;
            break;
          default:
            summary.unknown += 1;
            break;
        }
        return summary;
      },
      {
        currentSignature: currentRuleSignature,
        latest: 0,
        outdated: 0,
        manual: 0,
        unknown: 0
      } satisfies OverviewReport["ruleCoverage"]
    );
    const daemonState = this.db.getMaintenanceState<DaemonSweepSnapshot>("daemon_runtime");
    const replayState = this.db.getMaintenanceState<RenameReplaySnapshot>("rename_replay");
    const daemonStatus = resolveDaemonStatus(this.config, daemonState);
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
        currentRuleSignature,
        lastSweepAt: daemonState?.lastSweepAt,
        lastSweepIntervalSeconds: daemonState?.intervalSeconds,
        lastSweepSummary: daemonState?.summary,
        recentSweeps: Array.isArray(daemonState?.recentSweeps) ? daemonState.recentSweeps : [],
        explain: describeRuntimeState({
          configuredAutoApply: this.config.rename.autoApply,
          daemonStatus,
          actualExecution,
          summary: daemonState?.summary
        })
      },
      ruleCoverage,
      replay: {
        lastRunAt: replayState?.lastRunAt,
        recentRuns: Array.isArray(replayState?.recentRuns) ? replayState.recentRuns : []
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
    const scanReport = await this.scan();
    const now = new Date();
    const blockedOfficialThreadIds = getBlockedOfficialNameThreadIds(this.db, this.config);
    const reservedNameKeys = collectReservedOfficialNameKeys(this.db, this.config, {
      blockedOfficialThreadIds
    });
    const previews: AutoRenamePreview[] = [];
    const applied: Array<{ threadId: string; written: boolean; name: string; reason?: string }> = [];
    const dirtySessions = await this.listSessions({ dirty: true });
    const limit =
      typeof options?.limit === "number" && Number.isFinite(options.limit) && options.limit > 0
        ? Math.trunc(options.limit)
        : dirtySessions.length;
    const pending = Math.max(0, dirtySessions.length - limit);
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
      const normalizedDetail = applyOfficialNamingPolicy(detail, blockedOfficialThreadIds);

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
      let suggestion: RenameSuggestion | undefined;
      let failureReason: string | undefined;
      if (shouldResolveSuggestion && item.evaluation.action !== "skip") {
        try {
          suggestion = await this.resolveSuggestionForDetail(item.detail, {
            saveCandidate: autoApplyEnabled || options?.includeCandidateNames === true,
            reservedNameKeys,
            blockedOfficialThreadIds,
            reservationScheduler
          });
        } catch (error) {
          failureReason = summarizeSweepErrorReason(error);
        }
      }

      return {
        ...item,
        suggestion,
        failureReason
      };
    });

    for (const item of sweepItems) {
      const previewStatus = item.failureReason ? "skip" : item.evaluation.action;
      const previewReason = item.failureReason ?? item.evaluation.reason;
      previews.push({
        threadId: item.detail.threadId,
        candidateName: options?.includeCandidateNames ? item.suggestion?.name : undefined,
        status: previewStatus,
        reason: previewReason
      });

      if (autoApplyEnabled && item.evaluation.action === "apply" && !item.failureReason) {
        try {
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
        } catch (error) {
          applied.push({
            threadId: item.detail.threadId,
            written: false,
            name: item.suggestion?.name ?? item.detail.officialName ?? item.detail.threadId,
            reason: summarizeSweepErrorReason(error)
          });
        }
      }
    }

    const summary = {
      total: previews.length,
      dirtyTotal: dirtySessions.length,
      pending,
      suggest: previews.filter((item) => item.status === "suggest").length,
      apply: previews.filter((item) => item.status === "apply").length,
      skip: previews.filter((item) => item.status === "skip").length,
      failedSuggestions: previews.filter((item) =>
        ["request-failed", "missing-auth", "provider-misconfigured", "empty-response", "invalid-json", "missing-fields", "unsupported-backend", "error"].includes(item.reason)
      ).length,
      autoApplied: applied.filter((item) => item.written).length,
      unchanged: applied.filter((item) => !item.written).length,
      scan: {
        scannedRollouts: scanReport.scannedRollouts,
        updatedSessions: scanReport.updatedSessions
      },
      execution: autoApplyEnabled ? "auto-apply" : "preview-only"
    } satisfies DaemonSweepSnapshot["summary"];

    if (options?.recordRuntime !== false) {
      const previousState = this.db.getMaintenanceState<DaemonSweepSnapshot>("daemon_runtime");
      this.db.setMaintenanceState("daemon_runtime", {
        lastSweepAt: now.toISOString(),
        intervalSeconds: Math.max(1, Math.trunc(options?.intervalSeconds ?? this.config.watch.scanIntervalSeconds)),
        processId:
          typeof options?.processId === "number" && Number.isFinite(options.processId)
            ? Math.trunc(options.processId)
            : undefined,
        summary,
        recentSweeps: [
          {
            at: now.toISOString(),
            total: summary.total,
            dirtyTotal: summary.dirtyTotal,
            pending: summary.pending,
            suggest: summary.suggest,
            apply: summary.apply,
            skip: summary.skip,
            failedSuggestions: summary.failedSuggestions,
            autoApplied: summary.autoApplied,
            unchanged: summary.unchanged,
            execution: summary.execution
          },
          ...((previousState?.recentSweeps ?? []).filter((item) => item.at !== now.toISOString()))
        ].slice(0, 32)
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
