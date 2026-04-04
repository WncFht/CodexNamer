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
