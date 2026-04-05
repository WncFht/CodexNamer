export type SessionSummary = {
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
    manualOverride: number;
  };
  nextCursor: string | null;
};

export type BatchApplyResponse = {
  items: Array<{
    threadId: string;
    candidateName?: string;
    status: "skip" | "apply";
    reason: string;
  }>;
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
  rename?: {
    mode?: "heuristic" | "ai" | "hybrid";
    autoApply?: "off" | "idle-finalize" | "suggest-only";
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

export type ConfigUpdateResponse = {
  writtenTo: string;
  restartRequired: boolean;
  config: ConfigView;
};
