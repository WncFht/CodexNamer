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
