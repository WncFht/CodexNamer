import type {
  ConfigDocument,
  EffectiveConfig,
  MaterializedSession,
  RenameSuggestion,
  ScanReport,
  SessionDetail,
  SessionIndexSnapshot,
  SessionSummary
} from "@codexnamer/shared";

import type { StateDatabase } from "../database.js";
import type { createRenameInferenceService } from "../provider.js";

export type RenameInferenceService = ReturnType<typeof createRenameInferenceService>;

export type ResolveSuggestionOptions = {
  saveCandidate?: boolean;
  reservedNameKeys?: Set<string>;
  blockedOfficialThreadIds?: Set<string>;
  reservationScheduler?: <T>(callback: () => T | Promise<T>) => Promise<T>;
};

export type ManagerServiceContext = {
  readonly config: EffectiveConfig;
  readonly db: StateDatabase;
  readonly operator: string;
  readonly cwd: string;
  readonly configPath?: string;
  readonly overrides?: Partial<EffectiveConfig>;
  readonly inferenceService: RenameInferenceService;
  readonly sessionIndexPath: string;
  readonly backupDir: string;
  readonly currentRuleSignature: string;
  invalidateSessionIndexCache: () => void;
  reloadConfig: () => Promise<void>;
  readSessionIndexSnapshot: () => Promise<SessionIndexSnapshot>;
  requireSessionDetail: (threadId: string) => SessionDetail;
  resolvePreviewConfig: (userConfig?: ConfigDocument) => EffectiveConfig;
  buildSyntheticPromptSession: (config?: EffectiveConfig) => MaterializedSession;
  requireSuccessfulProviderTest: (config?: EffectiveConfig) => Promise<void>;
  materializeSessionForSuggestion: (detail: SessionDetail, config?: EffectiveConfig) => Promise<MaterializedSession>;
  resolveSuggestionForDetail: (detail: SessionDetail, options?: ResolveSuggestionOptions) => Promise<RenameSuggestion>;
  scan: () => Promise<ScanReport>;
  listSessions: (options?: { dirty?: boolean }) => Promise<SessionSummary[]>;
};

export function redactSecret(value?: string): string | undefined {
  return value ? "[redacted]" : undefined;
}

export async function mapWithConcurrency<T, R>(
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
