export type SessionSummary = {
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
  statusEstimate?: string;
  preferredNamingStyle?: "brief" | "detailed";
  effectiveNamingStyle?: "brief" | "detailed";
  officialNamingStyle?: "brief" | "detailed";
  candidateNamingStyle?: "brief" | "detailed";
  defaultNamingStyle?: "brief" | "detailed";
};

export type SessionDetail = SessionSummary & {
  rolloutPath: string;
  createdAt?: string;
  firstUserMessage?: string;
  lastUserMessage?: string;
  lastAgentMessage?: string;
  tokenTotal: number;
  revision?: string;
  lastAppliedAt?: string;
  lastAppliedRevision?: string;
  transcript?: {
    items: Array<{
      id: string;
      timestamp?: string;
      role: "user" | "assistant" | "tool" | "system";
      kind: "message" | "tool_call" | "tool_output" | "reasoning" | "status";
      content: string;
      name?: string;
      callId?: string;
      phase?: string;
      hidden?: boolean;
      hiddenReason?: string;
    }>;
    counts: {
      total: number;
      visible: number;
      hidden: number;
      tools: number;
    };
  };
  renameHistory?: Array<{
    kind: string;
    oldName?: string;
    newName: string;
    source: string;
    style: "brief" | "detailed";
    status: string;
    reason?: string;
    appliedAt: string;
    appliedRevision?: string;
    operator?: string;
  }>;
};

export type SessionTranscriptPage = {
  items: Array<{
    id: string;
    timestamp?: string;
    role: "user" | "assistant" | "tool" | "system";
    kind: "message" | "tool_call" | "tool_output" | "reasoning" | "status";
    content: string;
    name?: string;
    callId?: string;
    phase?: string;
    hidden?: boolean;
    hiddenReason?: string;
  }>;
  counts: {
    total: number;
    visible: number;
    hidden: number;
    tools: number;
  };
  totalItems: number;
  totalPages: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type SessionsResponse = {
  items: SessionSummary[];
  workspaces: Array<{
    workspaceId: string;
    workspaceLabel: string;
    workspacePath?: string;
    sessionCount: number;
    dirtyCount: number;
    frozenCount: number;
    manualOverrideCount: number;
    latestUpdatedAt?: string;
    projects: string[];
  }>;
  total: number;
  counts: {
    dirty: number;
    frozen: number;
    manualOverride: number;
  };
  nextCursor: string | null;
};

export type ProviderResponse = {
  ai: Record<string, unknown>;
  providerProfiles: Array<Record<string, unknown>>;
  inheritedCodex: Record<string, unknown>;
  resolvedProvider: Record<string, unknown>;
};

export type OverviewResponse = {
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
};

export type ProviderProfile = {
  profileId: string;
  backendKind?: "none" | "codex" | "openai-compatible";
  displayName?: string;
  providerSource?: "inherit-codex" | "explicit";
  providerRef?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  apiKeyRef?: string;
  headers?: Record<string, string>;
  wireApi?: "responses" | "chat_completions" | "auto";
  enabled?: boolean;
  isDefault?: boolean;
};

export type ConfigDocument = {
  general?: {
    codexHome?: string;
    stateDir?: string;
    uiLanguage?: "en-US" | "zh-CN";
  };
  rename?: {
    mode?: "heuristic" | "ai" | "hybrid";
    autoApply?: "disabled" | "idle-finalize";
    manualOverrideWins?: boolean;
    freezeManualName?: boolean;
  };
  watch?: {
    scanIntervalSeconds?: number;
    candidateIdleSeconds?: number;
    finalizeIdleSeconds?: number;
    renameCooldownSeconds?: number;
    minRolloutGrowthBytes?: number;
    minTaskCompleteDelta?: number;
    maxAutoRenamesPerSession?: number;
  };
  naming?: {
    preset?: string;
    template?: string;
    maxLength?: number;
    language?: string;
    defaultStyle?: "brief" | "detailed";
    contextStrategy?: "summary-signals" | "user-assistant-transcript";
    contextMaxChars?: number;
  };
  ai?: {
    backend?: "none" | "codex" | "openai-compatible";
    providerSource?: "inherit-codex" | "explicit";
    profile?: string;
    timeoutSeconds?: number;
    temperature?: number;
  };
  providerProfiles?: ProviderProfile[];
  maintenance?: {
    suggestCompactIndexAboveMb?: number;
    suggestCompactIndexAboveLines?: number;
    backupBeforeCompact?: boolean;
  };
};

export type ConfigView = {
  paths: {
    cwd: string;
    userConfigPath: string;
    projectConfigPath: string;
  };
  userConfig: ConfigDocument;
  projectOverride: ConfigDocument;
  effectiveConfig: Record<string, unknown>;
};

export type DoctorResponse = {
  codexHomeExists: boolean;
  sessionsDirExists: boolean;
  sessionIndexReadable: boolean;
  sessionIndexWritable: boolean;
  dbPath: string;
  dbExists: boolean;
  stats: {
    totalLines: number;
    uniqueThreadIds: number;
    duplicateThreadIds: number;
    sizeBytes: number;
  };
  autoRename: Record<string, unknown>;
  provider?: Record<string, unknown>;
};

export type AutoRenamePreviewResponse = {
  items: Array<{
    threadId: string;
    candidateName?: string;
    status: "skip" | "suggest" | "apply";
    reason: string;
  }>;
};

export type PromptPreviewResponse = {
  threadId: string;
  synthetic: boolean;
  prompt: string;
  renameContext: {
    requestedStrategy: string;
    strategy: string;
    maxChars: number;
    text: string;
    truncated: boolean;
    fallbackReason?: string;
    selectedChars: number;
    segments: Array<{
      role: "user" | "assistant";
      content: string;
      source: string;
      timestamp?: string;
    }>;
    summarySignals: {
      firstUserMessage?: string;
      lastUserMessage?: string;
      lastAgentMessage?: string;
    };
  };
};

export type AiRequestLogResponse = {
  activeCount: number;
  lastFinishedAt?: string;
  items: Array<{
    id: number;
    threadId: string;
    projectName?: string;
    backend: "codex" | "openai-compatible";
    transport: "responses" | "chat_completions" | "codex-exec";
    status: "running" | "succeeded" | "failed";
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    baseUrl?: string;
    model?: string;
    promptChars?: number;
    responseChars?: number;
    error?: string;
    metadata?: Record<string, string>;
  }>;
};

export type ApiEventsResponse = {
  items: Array<{
    cursor: number;
    type: string;
    at: string;
    payload: Record<string, unknown>;
  }>;
  nextCursor: number;
};

export type RenameSuggestResponse = {
  threadId: string;
  name: string;
  source: string;
  style: "brief" | "detailed";
  kind: string;
  summary: string;
  scope?: string;
  generatedAt: string;
};

export type RenameApplyResponse = {
  written: boolean;
  name: string;
};

export type RenameNamingStyleResponse = {
  threadId: string;
  preferredStyle?: "brief" | "detailed";
  effectiveStyle: "brief" | "detailed";
};

export type RenameFreezeResponse = {
  threadId: string;
  frozen: boolean;
};

export type RenameManualOverrideResponse = {
  threadId: string;
  manualOverride: boolean;
};

export type ConfigUpdateResponse = {
  writtenTo: string;
  restartRequired: boolean;
  config: ConfigView;
};
