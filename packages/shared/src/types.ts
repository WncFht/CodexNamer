export type RenameMode = "heuristic" | "ai" | "hybrid";
export type AiBackend = "none" | "codex" | "openai-compatible";
export type ProviderSource = "explicit" | "inherit-codex" | "mixed";
export type ProviderWireApi = "responses" | "chat_completions" | "auto";
export type AiRequestTransport = "responses" | "chat_completions" | "codex-exec";
export type AiRequestStatus = "running" | "succeeded" | "failed";
export type RenameContextStrategy = "summary-signals" | "user-assistant-transcript";
export type NamingStyle = "brief" | "detailed";
export type NamingCompositionMode = "structured" | "prompt-override";
export type NamingComponent = "tag" | "kind" | "scope" | "summary" | "project";
export type UiLanguage = "en-US" | "zh-CN";
export type RenameContextSegmentSource =
  | "summary_first_user"
  | "summary_last_user"
  | "summary_last_assistant"
  | "transcript_seed"
  | "transcript_recent";
export type RenameSource = "heuristic" | "ai" | "hybrid" | "manual" | "batch" | "recovered";
export type RenameHistoryKind = "auto" | "manual" | "batch" | "compact-rewrite";
export type RenameStatus = "applied" | "skipped" | "failed" | "preview_only";
export type SessionStatusEstimate = "discovered" | "active" | "candidate_ready" | "finalize_ready" | "applied" | "idle" | "archived_hint" | "missing";
export type SessionTranscriptRole = "user" | "assistant" | "tool" | "system";
export type SessionTranscriptKind = "message" | "tool_call" | "tool_output" | "reasoning" | "status";

export interface RenameContextSegment {
  role: "user" | "assistant";
  content: string;
  source: RenameContextSegmentSource;
  timestamp?: string;
}

export interface RenameContext {
  requestedStrategy: RenameContextStrategy;
  strategy: RenameContextStrategy;
  maxChars: number;
  text: string;
  truncated: boolean;
  fallbackReason?: "missing_transcript" | "empty_transcript";
  selectedChars: number;
  segments: RenameContextSegment[];
  summarySignals: {
    firstUserMessage?: string;
    lastUserMessage?: string;
    lastAgentMessage?: string;
  };
}

export interface NamingTagDefinition {
  id: string;
  label?: string;
  description?: string;
  promptHint?: string;
}

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
  defaultStyle: NamingStyle;
  contextStrategy: RenameContextStrategy;
  contextMaxChars: number;
  compositionMode: NamingCompositionMode;
  components: NamingComponent[];
  componentSeparator: string;
  tags: NamingTagDefinition[];
  customPrompt?: string;
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
  uiLanguage: UiLanguage;
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

export interface ConfigDocument {
  general?: Partial<GeneralConfig>;
  rename?: Partial<RenameConfig>;
  watch?: Partial<WatchConfig>;
  naming?: Partial<NamingConfig>;
  ai?: Partial<AiConfig>;
  providerProfiles?: ProviderProfile[];
  maintenance?: Partial<MaintenanceConfig>;
}

export interface ConfigView {
  paths: {
    cwd: string;
    userConfigPath: string;
    projectConfigPath: string;
  };
  userConfig: ConfigDocument;
  projectOverride: ConfigDocument;
  effectiveConfig: Record<string, unknown>;
}

export interface PromptPreview {
  threadId: string;
  synthetic: boolean;
  prompt: string;
  renameContext: RenameContext;
}

export type ApiEventType =
  | "scan.completed"
  | "session.suggested"
  | "session.applied"
  | "session.renamed"
  | "session.naming_style.changed"
  | "session.freeze.changed"
  | "session.manual_override.changed"
  | "batch.apply.completed"
  | "config.updated"
  | "maintenance.compact.completed";

export interface ApiEventRecord {
  cursor: number;
  type: ApiEventType;
  at: string;
  payload: Record<string, unknown>;
}

export interface ApiEventBatch {
  items: ApiEventRecord[];
  nextCursor: number;
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
  namingStyle?: NamingStyle;
  taskCompleteCount: number;
  tokenTotal: number;
  renameContext?: RenameContext;
}

export interface WorkspaceSummary {
  workspaceId: string;
  workspaceLabel: string;
  workspacePath?: string;
  sessionCount: number;
  dirtyCount: number;
  frozenCount: number;
  manualOverrideCount: number;
  latestUpdatedAt?: string;
  projects: string[];
}

export interface SessionTranscriptEntry {
  id: string;
  timestamp?: string;
  role: SessionTranscriptRole;
  kind: SessionTranscriptKind;
  content: string;
  name?: string;
  callId?: string;
  phase?: string;
  hidden?: boolean;
  hiddenReason?: string;
}

export interface SessionTranscript {
  items: SessionTranscriptEntry[];
  counts: {
    total: number;
    visible: number;
    hidden: number;
    tools: number;
  };
}

export interface SessionTranscriptPage {
  items: SessionTranscriptEntry[];
  counts: SessionTranscript["counts"];
  totalItems: number;
  totalPages: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
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
  style: NamingStyle;
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
  currentCandidateStyle?: NamingStyle;
  lastAutoName?: string;
  lastManualName?: string;
  lastAppliedName?: string;
  lastAppliedSource?: RenameSource;
  lastAppliedAt?: string;
  lastAppliedRevision?: string;
  lastAppliedStyle?: NamingStyle;
  preferredStyle?: NamingStyle;
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
  style: NamingStyle;
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
  firstUserMessage?: string;
  workspaceId: string;
  workspaceLabel: string;
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
  preferredNamingStyle?: NamingStyle;
  effectiveNamingStyle?: NamingStyle;
  officialNamingStyle?: NamingStyle;
  candidateNamingStyle?: NamingStyle;
  defaultNamingStyle?: NamingStyle;
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
  transcript?: SessionTranscript;
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
  status: "skip" | "suggest" | "apply";
  reason: string;
}

export interface AiRequestLogRecord {
  id: number;
  threadId: string;
  projectName?: string;
  backend: Exclude<AiBackend, "none">;
  transport: AiRequestTransport;
  status: AiRequestStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  baseUrl?: string;
  model?: string;
  promptChars?: number;
  responseChars?: number;
  error?: string;
  metadata?: Record<string, string>;
}

export interface AiRequestLogReport {
  activeCount: number;
  lastFinishedAt?: string;
  items: AiRequestLogRecord[];
}

export interface OverviewReport {
  sessions: {
    total: number;
    workspaces: number;
    dirty: number;
    clean: number;
    frozen: number;
    manualOverride: number;
    named: number;
    withCandidate: number;
  };
  runtime: {
    configuredAutoApply: string;
    actualExecution: "preview-only" | "auto-apply";
    daemonAutoApply: boolean;
    daemonStatus: "running" | "stale" | "not_seen";
    lastSweepAt?: string;
    lastSweepIntervalSeconds?: number;
    lastSweepSummary?: {
      total: number;
      suggest: number;
      apply: number;
      skip: number;
      autoApplied: number;
      unchanged: number;
      execution: "preview-only" | "auto-apply";
    };
    explain: string;
  };
  workload: {
    totalTokens: number;
    totalTasks: number;
    dirtyTokens: number;
    activeTokens: number;
    candidateReadyTokens: number;
    finalizeReadyTokens: number;
    appliedTokens: number;
    averageTokensPerSession: number;
    averageTokensPerDirtySession: number;
    averageTitleLength: number;
    topWorkspacesByTokens: Array<{
      workspaceId: string;
      workspaceLabel: string;
      sessions: number;
      tokens: number;
    }>;
  };
  pipeline: {
    discovered: number;
    active: number;
    candidateReady: number;
    finalizeReady: number;
    applied: number;
    idle: number;
    archivedHint: number;
    missing: number;
  };
  renameHistory: {
    total: number;
    applied: number;
    skipped: number;
    failed: number;
    previewOnly: number;
    aiApplied: number;
    manualApplied: number;
    autoApplied: number;
    lastAppliedAt?: string;
  };
  activity: {
    windowDays: number;
    buckets: Array<{
      date: string;
      label: string;
      applied: number;
      previewOnly: number;
      skipped: number;
      failed: number;
      autoApplied: number;
      manualApplied: number;
      aiApplied: number;
    }>;
  };
}
