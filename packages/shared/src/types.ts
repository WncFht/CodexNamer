export type AiBackend = "none" | "responses" | "openai-compatible";
export type ProviderSource = "manual" | "codex-config";
export type ProviderWireApi = "responses" | "openai-compatible";
export type AiRequestTransport = "responses" | "openai-compatible";
export type AiRequestStatus = "running" | "succeeded" | "failed";
export type RenameContextStrategy =
  | "summary-signals"
  | "last-user-last-assistant"
  | "user-assistant-transcript"
  | "user-only-transcript"
  | "assistant-only-transcript"
  | "user-transcript-last-assistant"
  | "paired-user-turns";
export type NamingCompositionMode = "structured" | "prompt-override";
export type NamingComponent =
  | "timestamp"
  | "workspace"
  | "project"
  | "tag"
  | "kind"
  | "scope"
  | "summary";
export type NamingTimestampPreset =
  | "%Y/%m/%d"
  | "%Y-%m-%d"
  | "%m/%d"
  | "%m-%d"
  | "%Y/%m/%d %H:%M"
  | "%H:%M";
export type UiLanguage = "en-US" | "zh-CN";
export type RenameContextSegmentSource =
  | "summary_first_user"
  | "summary_last_user"
  | "summary_last_assistant"
  | "transcript_seed"
  | "transcript_recent"
  | "paired_previous_assistant"
  | "paired_user_turn";
export type RenameSource = "heuristic" | "ai" | "hybrid" | "manual" | "batch" | "recovered";
export type RenameHistoryKind = "auto" | "manual" | "batch" | "compact-rewrite";
export type RenameStatus = "applied" | "skipped" | "failed" | "preview_only";
export type SessionStatusEstimate =
  | "discovered"
  | "active"
  | "candidate_ready"
  | "finalize_ready"
  | "applied"
  | "idle"
  | "archived_hint"
  | "missing";
export type SessionTranscriptRole = "user" | "assistant" | "tool" | "system";
export type SessionTranscriptKind =
  | "message"
  | "tool_call"
  | "tool_output"
  | "reasoning"
  | "status";

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

export type NamingBuilderItem =
  | {
      type: "component";
      component: NamingComponent;
      format?: NamingTimestampPreset;
    }
  | {
      type: "separator";
      value: string;
    };

export interface WatchConfig {
  scanIntervalSeconds: number;
  candidateIdleSeconds: number;
  finalizeIdleSeconds: number;
  renameCooldownSeconds: number;
  maxAutoRenamesPerSession: number;
}

export interface NamingConfig {
  preset: string;
  template: string;
  maxLength: number;
  language: string;
  contextStrategy: RenameContextStrategy;
  contextMaxChars: number;
  compositionMode: NamingCompositionMode;
  builder: NamingBuilderItem[];
  tags: NamingTagDefinition[];
  customPrompt?: string;
}

export interface RenameConfig {
  autoApply: "disabled" | "idle-finalize";
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
  maxConcurrency: number;
}

export interface ProviderProfile {
  profileId: string;
  requestType: Exclude<AiBackend, "none">;
  displayName: string;
  providerRef?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  apiKeyRef?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  isDefault: boolean;
}

export interface ProviderProfileDocument {
  profileId: string;
  requestType?: Exclude<AiBackend, "none">;
  displayName?: string;
  providerRef?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  apiKeyRef?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  isDefault?: boolean;
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
  providerProfiles?: ProviderProfileDocument[];
  maintenance?: Partial<MaintenanceConfig>;
}

export interface ProviderTestRequest {
  userConfig?: ConfigDocument;
}

export interface PromptPreviewRequest {
  threadId?: string;
  userConfig?: ConfigDocument;
}

export interface ConfigUpdateRequest {
  userConfig: ConfigDocument;
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
  | "batch.apply.completed"
  | "config.updated"
  | "maintenance.rename_requeued"
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

export interface AiRequestLogQuery {
  limit?: number;
  page?: number;
  pageSize?: number;
  search?: string;
  project?: string;
  status?: AiRequestStatus;
  transport?: AiRequestTransport;
}

export interface DaemonStartRequest {
  intervalSeconds?: number;
}

export interface RenameReplayRequest {
  since: string;
  basis: "session-updated-at" | "last-applied-at";
}

export interface RenameReplayResult {
  since: string;
  basis: "session-updated-at" | "last-applied-at";
  queued: number;
  clearedCandidates: number;
  matchedThreadIds: string[];
  skipped: number;
  skipCounts: Record<string, number>;
}

export interface RenameReplayPreviewItem {
  threadId: string;
  updatedAt?: string;
  officialName?: string;
  ruleStatus: "latest" | "outdated" | "manual" | "unknown";
  action: "queue" | "skip";
  reason:
    | "rule_mismatch"
    | "content_changed"
    | "legacy_unknown_rule"
    | "already_latest_rule"
    | "manual_name"
    | "frozen";
}

export interface RenameReplayPreviewResult {
  since: string;
  basis: "session-updated-at" | "last-applied-at";
  currentRuleSignature: string;
  matched: number;
  queued: number;
  skipped: number;
  queueCounts: Record<string, number>;
  skipCounts: Record<string, number>;
  items: RenameReplayPreviewItem[];
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
  renameContext?: RenameContext;
}

export interface WorkspaceSummary {
  workspaceId: string;
  workspaceLabel: string;
  workspacePath?: string;
  sessionCount: number;
  dirtyCount: number;
  frozenCount: number;
  latestUpdatedAt?: string;
  projects: string[];
}

export type SessionListSortField = "updatedAt" | "project" | "officialName";
export type SortOrder = "asc" | "desc";

export interface SessionListQuery {
  dirty?: boolean;
  frozen?: boolean;
  status?: SessionStatusEstimate;
  project?: string;
  provider?: string;
  workspace?: string;
  search?: string;
  sort?: SessionListSortField;
  order?: SortOrder;
  limit?: number;
}

export interface SessionDetailQuery {
  includeTranscript?: boolean;
}

export interface SessionTranscriptQuery {
  page?: number;
  pageSize?: number;
  includeHidden?: boolean;
  role?: "all" | SessionTranscriptRole;
  query?: string;
}

export interface RenameRequest {
  name: string;
}

export interface BatchApplyRequest {
  filter?: {
    dirty?: boolean;
  };
  previewOnly?: boolean;
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
  kind: string;
  summary: string;
  scope?: string;
  tagId?: string;
  generatedAt: string;
  metadata?: Record<string, string>;
}

export interface RenameStateRecord {
  threadId: string;
  currentCandidateName?: string;
  currentCandidateSource?: RenameSource;
  currentCandidateGeneratedAt?: string;
  currentCandidateRuleSignature?: string;
  lastAutoName?: string;
  lastManualName?: string;
  lastAppliedName?: string;
  lastAppliedSource?: RenameSource;
  lastAppliedAt?: string;
  lastAppliedRevision?: string;
  lastAppliedRuleSignature?: string;
  dirtySinceRename: boolean;
  forceRewrite: boolean;
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
  ruleSignature?: string;
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
  taskCompleteCount: number;
  provider?: string;
  model?: string;
  lastAppliedSource?: RenameSource;
  statusEstimate?: SessionStatusEstimate;
  currentRuleSignature?: string;
  candidateRuleSignature?: string;
  lastAppliedRuleSignature?: string;
  ruleStatus?: "latest" | "outdated" | "manual" | "unknown";
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
  finalName?: string;
  error?: string;
  metadata?: Record<string, string>;
}

export interface AiRequestLogDetail extends AiRequestLogRecord {
  promptText?: string;
  requestPayload?: Record<string, unknown>;
  responseText?: string;
  responsePayload?: Record<string, unknown>;
  result?: {
    parsedModelOutput?: Record<string, unknown>;
    finalSuggestion?: RenameSuggestion;
    composition?: {
      mode: NamingCompositionMode;
      builder: NamingBuilderItem[];
      explicitName?: string;
      tagLabel?: string;
      finalName: string;
    };
  };
}

export interface AiRequestLogReport {
  activeCount: number;
  lastFinishedAt?: string;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  statusCounts: {
    running: number;
    succeeded: number;
    failed: number;
  };
  projects: string[];
  items: AiRequestLogRecord[];
}

export interface ProviderTestResult {
  ok: boolean;
  testedAt: string;
  latencyMs?: number;
  diagnostics: ProviderDiagnosticsLike;
  responseText?: string;
  error?: string;
}

export interface ProviderDiagnosticsLike {
  configuredBackend: AiBackend;
  requestedBackend: AiBackend;
  profileId?: string;
  providerRef?: string;
  baseUrl?: string;
  model?: string;
  requestType?: ProviderWireApi;
  requiresOpenaiAuth?: boolean;
  credentialKind?: "api-key" | "bearer-token";
  credentialSource?: string;
  hasCredential: boolean;
  preferredTransport: "none" | "http";
  canDirectHttp: boolean;
}

export interface OverviewReport {
  sessions: {
    total: number;
    workspaces: number;
    dirty: number;
    clean: number;
    frozen: number;
    named: number;
    withCandidate: number;
  };
  runtime: {
    configuredAutoApply: string;
    actualExecution: "preview-only" | "auto-apply";
    daemonAutoApply: boolean;
    daemonStatus: "running" | "stale" | "not_seen";
    currentRuleSignature: string;
    lastSweepAt?: string;
    lastSweepIntervalSeconds?: number;
    lastSweepSummary?: {
      total: number;
      dirtyTotal: number;
      pending: number;
      suggest: number;
      apply: number;
      skip: number;
      failedSuggestions: number;
      autoApplied: number;
      unchanged: number;
      scan: {
        scannedRollouts: number;
        updatedSessions: number;
      };
      execution: "preview-only" | "auto-apply";
    };
    recentSweeps: Array<{
      at: string;
      total: number;
      dirtyTotal: number;
      pending: number;
      suggest: number;
      apply: number;
      skip: number;
      failedSuggestions: number;
      autoApplied: number;
      unchanged: number;
      execution: "preview-only" | "auto-apply";
    }>;
    explain: string;
  };
  ruleCoverage: {
    currentSignature: string;
    latest: number;
    outdated: number;
    manual: number;
    unknown: number;
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
  replay: {
    lastRunAt?: string;
    recentRuns: Array<{
      requestedAt: string;
      since: string;
      basis: "session-updated-at" | "last-applied-at";
      queued: number;
      clearedCandidates: number;
      skipped: number;
      skipCounts?: Record<string, number>;
    }>;
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

export interface DaemonLogEntry {
  at: string;
  stream: "stdout" | "stderr";
  line: string;
}

export interface DaemonControlStatus {
  running: boolean;
  pid?: number;
  startedAt?: string;
  stoppedAt?: string;
  intervalSeconds?: number;
  apiProcessId: number;
  command: {
    cwd: string;
    executable: string;
    scriptPath: string;
    args: string[];
  };
  recentLogs: DaemonLogEntry[];
  lastExitCode?: number;
  lastExitSignal?: string;
  lastError?: string;
}

export interface SessionsResponse {
  items: SessionSummary[];
  workspaces: WorkspaceSummary[];
  total: number;
  counts: {
    dirty: number;
    frozen: number;
  };
  nextCursor: string | null;
}

export interface ProviderResponse {
  ai: Record<string, unknown>;
  providerProfiles: Array<Record<string, unknown>>;
  inheritedCodex: Record<string, unknown>;
  resolvedProvider: Record<string, unknown>;
  lastProviderTest?: ProviderTestResult;
}

export type OverviewResponse = OverviewReport;
export type DoctorResponse = DoctorReport;

export interface BatchApplyItem {
  threadId: string;
  action: "applied" | "skipped" | "preview";
  name?: string;
  reason?: string;
}

export interface BatchApplyResponse {
  items: BatchApplyItem[];
}

export interface AutoRenamePreviewResponse {
  items: AutoRenamePreview[];
}

export type PromptPreviewResponse = PromptPreview;
export type AiRequestLogResponse = AiRequestLogReport;
export type AiRequestLogDetailResponse = AiRequestLogDetail;
export type ProviderTestResponse = ProviderTestResult;

export interface ParseCodexProviderResponse {
  source: "codex-config";
  profile: {
    requestType?: ProviderWireApi;
    providerRef?: string;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  };
}

export type ApiEventsResponse = ApiEventBatch;
export type RenameSuggestResponse = RenameSuggestion;

export interface RenameApplyResponse {
  written: boolean;
  name: string;
}

export interface RenameFreezeResponse {
  threadId: string;
  frozen: boolean;
}

export interface ConfigUpdateResponse {
  writtenTo: string;
  restartRequired: boolean;
  config: ConfigView;
}
