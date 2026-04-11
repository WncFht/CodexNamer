import fs from "node:fs/promises";
import path from "node:path";

import {
  type AiRequestLogDetail,
  type AiRequestLogReport,
  type AutoRenamePreview,
  type ConfigDocument,
  type ConfigView,
  type DoctorReport,
  type EffectiveConfig,
  type MaterializedSession,
  type OverviewReport,
  type PromptPreview,
  type RenameReplayPreviewResult,
  type RenameReplayResult,
  type RenameSuggestion,
  type ScanReport,
  SESSION_INDEX_FILENAME,
  type SessionDetail,
  type SessionIndexSnapshot,
  type SessionSummary,
  type WorkspaceSummary
} from "@codexnamer/shared";

import { loadEffectiveConfig } from "./config.js";
import { StateDatabase } from "./database.js";
import { createRenameInferenceService } from "./provider.js";
import {
  ensureUniqueRenameSuggestion,
  getBlockedOfficialNameThreadIds,
  isAcceptedOfficialRenameSource,
  normalizeComparableName,
  requiresAcceptedRewrite
} from "./manager/naming-policy.js";
import { requireSuccessfulProviderTest as ensureProviderTestReady } from "./manager/provider-state.js";
import { computeRenameRuleSignature } from "./rule-signature.js";
import { readSessionTranscript } from "./rollout.js";
import { buildRenameContext } from "./rename-context.js";
import type { compactSessionIndex } from "./session-index.js";
import { deepMerge } from "./util.js";
import {
  batchApplyDirty as batchApplyDirtyService,
  apply as applyService,
  rename as renameService,
  suggest as suggestService
} from "./manager/rename-command-service.js";
import {
  compactIndex as compactIndexService,
  freeze as freezeService,
  getRenameHistory as getRenameHistoryService,
  previewAutoRename as previewAutoRenameService,
  previewRequeueRenamesSince as previewRequeueRenamesSinceService,
  requeueRenamesSince as requeueRenamesSinceService,
  runAutoRenameSweep as runAutoRenameSweepService,
  unfreeze as unfreezeService
} from "./manager/maintenance-service.js";
import {
  getConfigView as getConfigViewService,
  parseCodexProviderConfig as parseCodexProviderConfigService,
  printConfig as printConfigService,
  testProvider as testProviderService,
  updateConfig as updateConfigService
} from "./manager/config-runtime-service.js";
import { buildPromptPreview as buildPromptPreviewService } from "./manager/prompt-preview-service.js";
import { doctor as doctorService, overview as overviewService } from "./manager/runtime-overview-service.js";
import {
  getSessionDetail as getSessionDetailService,
  getSessionTranscriptPage as getSessionTranscriptPageService,
  listSessions as listSessionsService,
  listWorkspaces as listWorkspacesService,
  performScan
} from "./manager/session-scan-service.js";
import type { ManagerServiceContext, ResolveSuggestionOptions } from "./manager/shared.js";

const SCAN_FRESH_WINDOW_MS = 1_200;

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

  private get serviceContext(): ManagerServiceContext {
    const context = {
      db: this.db,
      operator: this.operator,
      cwd: this.cwd,
      configPath: this.configPath,
      overrides: this.overrides,
      invalidateSessionIndexCache: () => {
        this.sessionIndexCache = undefined;
      },
      reloadConfig: () => this.reloadConfig(),
      readSessionIndexSnapshot: () => this.readSessionIndexSnapshot(),
      requireSessionDetail: (threadId) => this.requireSessionDetail(threadId),
      resolvePreviewConfig: (userConfig) => this.resolvePreviewConfig(userConfig),
      buildSyntheticPromptSession: (config) => this.buildSyntheticPromptSession(config),
      requireSuccessfulProviderTest: (config) => this.requireSuccessfulProviderTest(config),
      materializeSessionForSuggestion: (detail, config) => this.materializeSessionForSuggestion(detail, config),
      resolveSuggestionForDetail: (detail, options) => this.resolveSuggestionForDetail(detail, options),
      scan: () => this.scan(),
      listSessions: (options) => this.listSessions(options)
    } as ManagerServiceContext;
    Object.defineProperties(context, {
      config: {
        get: () => this.config
      },
      inferenceService: {
        get: () => this.inferenceService
      },
      sessionIndexPath: {
        get: () => this.sessionIndexPath
      },
      backupDir: {
        get: () => this.backupDir
      },
      currentRuleSignature: {
        get: () => this.currentRuleSignature
      }
    });
    return context;
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
    options?: ResolveSuggestionOptions
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
        const blockedOfficialThreadIds =
          options?.blockedOfficialThreadIds ?? getBlockedOfficialNameThreadIds(this.db, this.config);
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
            blockedOfficialThreadIds
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

    const rawSuggestion = await this.inferenceService.suggest(await this.materializeSessionForSuggestion(detail));
    const finalizeSuggestion = () => {
      const blockedOfficialThreadIds =
        options?.blockedOfficialThreadIds ?? getBlockedOfficialNameThreadIds(this.db, this.config);
      const suggestion = ensureUniqueRenameSuggestion(
        this.db,
        this.config,
        detail.threadId,
        rawSuggestion,
        {
          reservedNameKeys: options?.reservedNameKeys,
          blockedOfficialThreadIds
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

    return options?.reservationScheduler ? options.reservationScheduler(finalizeSuggestion) : finalizeSuggestion();
  }

  private async performScan(): Promise<ScanReport> {
    return performScan(this.serviceContext);
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
    return listSessionsService(this.serviceContext, options);
  }

  async listWorkspaces(options?: { dirty?: boolean }): Promise<WorkspaceSummary[]> {
    return listWorkspacesService(this.serviceContext, options);
  }

  async getSessionDetail(
    threadId: string,
    options?: { includeTranscript?: boolean }
  ): Promise<SessionDetail | undefined> {
    return getSessionDetailService(this.serviceContext, threadId, options);
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
    return getSessionTranscriptPageService(this.serviceContext, threadId, options);
  }

  async suggest(threadId: string): Promise<RenameSuggestion> {
    return suggestService(this.serviceContext, threadId);
  }

  async apply(
    threadId: string,
    options?: {
      autoApply?: boolean;
      skipScan?: boolean;
      detail?: SessionDetail;
    }
  ): Promise<{ written: boolean; name: string }> {
    return applyService(this.serviceContext, threadId, options);
  }

  async rename(threadId: string, name: string): Promise<{ written: boolean; name: string }> {
    return renameService(this.serviceContext, threadId, name);
  }

  async batchApplyDirty(options?: { previewOnly?: boolean }): Promise<
    Array<{ threadId: string; action: "applied" | "skipped" | "preview"; name?: string; reason?: string }>
  > {
    return batchApplyDirtyService(this.serviceContext, options);
  }

  async compactIndex(options?: { dryRun?: boolean }): Promise<Awaited<ReturnType<typeof compactSessionIndex>>> {
    return compactIndexService(this.serviceContext, options);
  }

  async getRenameHistory(threadId: string) {
    return getRenameHistoryService(this.serviceContext, threadId);
  }

  async freeze(threadId: string): Promise<void> {
    return freezeService(this.serviceContext, threadId);
  }

  async unfreeze(threadId: string): Promise<void> {
    return unfreezeService(this.serviceContext, threadId);
  }

  async printConfig(): Promise<Record<string, unknown>> {
    return printConfigService(this.serviceContext);
  }

  parseCodexProviderConfig(): Record<string, unknown> {
    return parseCodexProviderConfigService(this.serviceContext);
  }

  async getConfigView(): Promise<ConfigView> {
    return getConfigViewService(this.serviceContext);
  }

  async updateConfig(
    patch: ConfigDocument
  ): Promise<{ writtenTo: string; restartRequired: boolean; config: ConfigView }> {
    return updateConfigService(this.serviceContext, patch);
  }

  async previewRequeueRenamesSince(params: {
    since: string;
    basis: "session-updated-at" | "last-applied-at";
  }): Promise<RenameReplayPreviewResult> {
    return previewRequeueRenamesSinceService(this.serviceContext, params);
  }

  async requeueRenamesSince(params: {
    since: string;
    basis: "session-updated-at" | "last-applied-at";
  }): Promise<RenameReplayResult> {
    return requeueRenamesSinceService(this.serviceContext, params);
  }

  async testProvider(options?: { userConfig?: ConfigDocument }): Promise<Record<string, unknown>> {
    return testProviderService(this.serviceContext, options);
  }

  async buildPromptPreview(options?: { threadId?: string; userConfig?: ConfigDocument }): Promise<PromptPreview> {
    return buildPromptPreviewService(this.serviceContext, options);
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
    return doctorService(this.serviceContext);
  }

  async overview(): Promise<OverviewReport> {
    return overviewService(this.serviceContext);
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
    return runAutoRenameSweepService(this.serviceContext, options);
  }

  async previewAutoRename(options?: {
    includeCandidateNames?: boolean;
    limit?: number;
  }): Promise<AutoRenamePreview[]> {
    return previewAutoRenameService(this.serviceContext, options);
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

      const { readSessionIndex } = await import("./session-index.js");
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
        const { readSessionIndex } = await import("./session-index.js");
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
