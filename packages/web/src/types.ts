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
  taskCompleteCount: number;
  provider?: string;
  model?: string;
  statusEstimate?: string;
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
    latestUpdatedAt?: string;
    projects: string[];
  }>;
  total: number;
  counts: {
    dirty: number;
    frozen: number;
  };
  nextCursor: string | null;
};

export type ProviderResponse = {
  ai: Record<string, unknown>;
  providerProfiles: Array<Record<string, unknown>>;
  inheritedCodex: Record<string, unknown>;
  resolvedProvider: Record<string, unknown>;
  lastProviderTest?: {
    ok: boolean;
    testedAt: string;
    latencyMs?: number;
    diagnostics: Record<string, unknown>;
    responseText?: string;
    error?: string;
  };
};

export type DaemonControlStatus = {
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
  recentLogs: Array<{
    at: string;
    stream: "stdout" | "stderr";
    line: string;
  }>;
  lastExitCode?: number;
  lastExitSignal?: string;
  lastError?: string;
};

export type OverviewResponse = {
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
  replay: {
    lastRunAt?: string;
    recentRuns: Array<{
      requestedAt: string;
      since: string;
      basis: "session-updated-at" | "last-applied-at";
      queued: number;
      clearedCandidates: number;
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
};

export type ProviderProfile = {
  profileId: string;
  requestType?: "responses" | "openai-compatible";
  displayName?: string;
  providerRef?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  apiKeyRef?: string;
  headers?: Record<string, string>;
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
    contextStrategy?:
      | "summary-signals"
      | "last-user-last-assistant"
      | "user-assistant-transcript"
      | "user-only-transcript"
      | "assistant-only-transcript"
      | "user-transcript-last-assistant"
      | "paired-user-turns";
    contextMaxChars?: number;
    compositionMode?: "structured" | "prompt-override";
    builder?: Array<
      | {
          type: "component";
          component: "timestamp" | "workspace" | "project" | "tag" | "kind" | "scope" | "summary";
          format?: "%Y/%m/%d" | "%Y-%m-%d" | "%m/%d" | "%m-%d" | "%Y/%m/%d %H:%M" | "%H:%M";
        }
      | {
          type: "separator";
          value: string;
        }
    >;
    components?: Array<"timestamp" | "workspace" | "project" | "tag" | "kind" | "scope" | "summary">;
    componentSeparator?: string;
    tags?: Array<{
      id: string;
      label?: string;
      description?: string;
      promptHint?: string;
    }>;
    customPrompt?: string;
  };
  ai?: {
    backend?: "none" | "responses" | "openai-compatible";
    providerSource?: "codex-config" | "manual";
    profile?: string;
    timeoutSeconds?: number;
    temperature?: number;
    maxConcurrency?: number;
  };
  providerProfiles?: ProviderProfile[];
  maintenance?: {
    suggestCompactIndexAboveMb?: number;
    suggestCompactIndexAboveLines?: number;
    backupBeforeCompact?: boolean;
  };
};

export type RenameReplayResult = {
  since: string;
  basis: "session-updated-at" | "last-applied-at";
  queued: number;
  clearedCandidates: number;
  matchedThreadIds: string[];
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
  items: Array<{
    id: number;
    threadId: string;
    projectName?: string;
    backend: "responses" | "openai-compatible";
    transport: "responses" | "openai-compatible";
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

export type AiRequestLogDetailResponse = AiRequestLogResponse["items"][number] & {
  promptText?: string;
  requestPayload?: Record<string, unknown>;
  responseText?: string;
  responsePayload?: Record<string, unknown>;
  result?: {
    parsedModelOutput?: Record<string, unknown>;
    finalSuggestion?: RenameSuggestResponse;
    composition?: {
      mode: "structured" | "prompt-override";
      builder: Array<
        | {
            type: "component";
            component: "timestamp" | "workspace" | "project" | "tag" | "kind" | "scope" | "summary";
            format?: "%Y/%m/%d" | "%Y-%m-%d" | "%m/%d" | "%m-%d" | "%Y/%m/%d %H:%M" | "%H:%M";
          }
        | {
            type: "separator";
            value: string;
          }
      >;
      explicitName?: string;
      tagLabel?: string;
      finalName: string;
    };
  };
};

export type ProviderTestResponse = {
  ok: boolean;
  testedAt: string;
  latencyMs?: number;
  diagnostics: Record<string, unknown>;
  responseText?: string;
  error?: string;
};

export type ParseCodexProviderResponse = {
  source: "codex-config";
  profile: {
    requestType?: "responses" | "openai-compatible";
    providerRef?: string;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  };
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

export type RenameFreezeResponse = {
  threadId: string;
  frozen: boolean;
};

export type ConfigUpdateResponse = {
  writtenTo: string;
  restartRequired: boolean;
  config: ConfigView;
};
