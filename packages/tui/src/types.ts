export type SessionSummary = {
  threadId: string;
  cwd?: string;
  projectName?: string;
  firstUserMessage?: string;
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
  renameHistory?: Array<{
    kind: string;
    oldName?: string;
    newName: string;
    source: string;
    status: string;
    reason?: string;
    appliedAt: string;
    appliedRevision?: string;
    operator?: string;
  }>;
};

export type SessionTranscriptEntry = {
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
};

export type SessionTranscriptPage = {
  items: SessionTranscriptEntry[];
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
  total: number;
  counts: {
    dirty: number;
    frozen: number;
  };
  nextCursor: string | null;
};

export type BatchApplyResponse = {
  items: Array<{
    threadId: string;
    action: "applied" | "skipped" | "preview";
    name?: string;
    reason?: string;
  }>;
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

export type ConfigUpdateResponse = {
  writtenTo: string;
  restartRequired: boolean;
  config: ConfigView;
};
