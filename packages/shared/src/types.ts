export type RenameMode = "heuristic" | "ai" | "hybrid";
export type AiBackend = "none" | "codex" | "openai-compatible";
export type ProviderSource = "explicit" | "inherit-codex" | "mixed";
export type ProviderWireApi = "responses" | "chat_completions" | "auto";
export type RenameSource = "heuristic" | "ai" | "hybrid" | "manual" | "batch" | "recovered";
export type RenameHistoryKind = "auto" | "manual" | "batch" | "compact-rewrite";
export type RenameStatus = "applied" | "skipped" | "failed" | "preview_only";
export type SessionStatusEstimate = "discovered" | "active" | "candidate_ready" | "finalize_ready" | "applied" | "idle" | "archived_hint" | "missing";

export interface WatchConfig {
  scanIntervalSeconds: number;
  candidateIdleSeconds: number;
  finalizeIdleSeconds: number;
  renameCooldownSeconds: number;
  minRolloutGrowthBytes: number;
  minTaskCompleteDelta: number;
  maxAutoRenamesPerSession: number;
}

export interface NamingConfig {
  preset: string;
  template: string;
  maxLength: number;
  language: string;
}

export interface RenameConfig {
  mode: RenameMode;
  autoApply: "disabled" | "idle-finalize";
  manualOverrideWins: boolean;
  freezeManualName: boolean;
}

export interface GeneralConfig {
  codexHome: string;
  stateDir: string;
}

export interface AiConfig {
  backend: AiBackend;
  providerSource: ProviderSource;
  profile: string;
  timeoutSeconds: number;
  temperature: number;
}

export interface ProviderProfile {
  profileId: string;
  backendKind: AiBackend;
  displayName: string;
  providerSource: ProviderSource;
  providerRef?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  apiKeyRef?: string;
  headers?: Record<string, string>;
  wireApi?: ProviderWireApi;
  enabled: boolean;
  isDefault: boolean;
}

export interface CodexInheritedAuth {
  authMode?: string;
  openaiApiKey?: string;
  accessToken?: string;
}

export interface InheritedCodexProvider {
  name: string;
  baseUrl?: string;
  wireApi?: ProviderWireApi;
  apiKeyEnv?: string;
  headers?: Record<string, string>;
  requiresOpenaiAuth?: boolean;
}

export interface MaintenanceConfig {
  suggestCompactIndexAboveMb: number;
  suggestCompactIndexAboveLines: number;
  backupBeforeCompact: boolean;
}

export interface EffectiveConfig {
  general: GeneralConfig;
  rename: RenameConfig;
  watch: WatchConfig;
  naming: NamingConfig;
  ai: AiConfig;
  providerProfiles: ProviderProfile[];
  maintenance: MaintenanceConfig;
  inheritedCodex: {
    modelProvider?: string;
    model?: string;
    providers: Record<string, InheritedCodexProvider>;
    auth?: CodexInheritedAuth;
  };
}

export interface SessionIndexEntry {
  id: string;
  threadName: string;
  updatedAt: string;
  lineNumber?: number;
}

export interface SessionIndexStats {
  totalLines: number;
  uniqueThreadIds: number;
  duplicateThreadIds: number;
  sizeBytes: number;
}

export interface SessionIndexSnapshot {
  entries: SessionIndexEntry[];
  latestByThreadId: Map<string, SessionIndexEntry>;
  stats: SessionIndexStats;
}

export interface CompactIndexResult {
  dryRun: boolean;
  originalLines: number;
  compactedLines: number;
  originalSizeBytes: number;
  compactedSizeBytes: number;
  outputPath?: string;
  backupPath?: string;
}

export interface MaterializedSession {
  threadId: string;
  rolloutPath: string;
  cwd?: string;
  projectName?: string;
  createdAt?: string;
  updatedAt?: string;
  modelProvider?: string;
  model?: string;
  firstUserMessage?: string;
  lastUserMessage?: string;
  lastAgentMessage?: string;
  taskCompleteCount: number;
  tokenTotal: number;
}

export interface SessionRevision {
  currentRevision: string;
  lastSeenRolloutSize: number;
  lastSeenRolloutMtime?: string;
  lastMaterialChangeAt?: string;
  lastTaskCompleteCount: number;
  lastAgentMessageFingerprint?: string;
}

export interface RenameSuggestion {
  threadId: string;
  name: string;
  source: RenameSource;
  kind: string;
  summary: string;
  scope?: string;
  generatedAt: string;
  metadata?: Record<string, string>;
}

export interface RenameStateRecord {
  threadId: string;
  currentCandidateName?: string;
  currentCandidateSource?: RenameSource;
  currentCandidateGeneratedAt?: string;
  lastAutoName?: string;
  lastManualName?: string;
  lastAppliedName?: string;
  lastAppliedSource?: RenameSource;
  lastAppliedAt?: string;
  lastAppliedRevision?: string;
  dirtySinceRename: boolean;
  manualOverride: boolean;
  frozen: boolean;
  autoApplyCount: number;
  lastAutoApplyAttemptAt?: string;
  lastAutoApplySuccessAt?: string;
  lastSkipReason?: string;
}

export interface RenameHistoryRecord {
  kind: RenameHistoryKind;
  oldName?: string;
  newName: string;
  source: RenameSource;
  status: RenameStatus;
  reason?: string;
  appliedAt: string;
  appliedRevision?: string;
  operator?: string;
}

export interface SessionSummary {
  threadId: string;
  cwd?: string;
  projectName?: string;
  updatedAt?: string;
  officialName?: string;
  candidateName?: string;
  dirty: boolean;
  frozen: boolean;
  manualOverride: boolean;
  taskCompleteCount: number;
  provider?: string;
  model?: string;
  statusEstimate?: SessionStatusEstimate;
}

export interface SessionDetail extends SessionSummary {
  rolloutPath: string;
  createdAt?: string;
  firstUserMessage?: string;
  lastUserMessage?: string;
  lastAgentMessage?: string;
  tokenTotal: number;
  revision?: string;
  lastAppliedAt?: string;
  lastAppliedRevision?: string;
  renameHistory?: RenameHistoryRecord[];
}

export interface ScanReport {
  scannedRollouts: number;
  updatedSessions: number;
}

export interface DoctorReport {
  codexHomeExists: boolean;
  sessionsDirExists: boolean;
  sessionIndexReadable: boolean;
  sessionIndexWritable: boolean;
  dbPath: string;
  dbExists: boolean;
  stats: SessionIndexStats;
  autoRename: WatchConfig & { autoApply: string };
  provider?: Record<string, unknown>;
}

export interface AutoRenamePreview {
  threadId: string;
  candidateName?: string;
  status: "skip" | "apply";
  reason: string;
}
