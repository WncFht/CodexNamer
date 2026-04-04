export type SessionSummary = {
  threadId: string;
  cwd?: string;
  projectName?: string;
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
    status: "skip" | "apply";
    reason: string;
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
