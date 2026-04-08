import type {
  EffectiveConfig,
  RenameStateRecord,
  SessionDetail,
  SessionStatusEstimate
} from "@codex-session-manager/shared";

export interface AutoRenameEvaluation {
  threadId: string;
  statusEstimate: SessionStatusEstimate;
  action: "skip" | "suggest" | "apply";
  reason:
    | SessionStatusEstimate
    | "frozen"
    | "max_auto_renames_reached"
    | "rename_cooldown";
}

export function estimateSessionStatus(
  detail: Pick<SessionDetail, "updatedAt" | "firstUserMessage" | "lastAgentMessage" | "dirty">,
  config: EffectiveConfig,
  now: Date
): SessionStatusEstimate {
  const lastUpdated = detail.updatedAt ? new Date(detail.updatedAt).getTime() : 0;
  const ageSeconds = lastUpdated > 0 ? (now.getTime() - lastUpdated) / 1000 : Number.POSITIVE_INFINITY;

  if (!detail.firstUserMessage && !detail.lastAgentMessage) {
    return "discovered";
  }
  if (!detail.dirty) {
    return "applied";
  }
  if (ageSeconds < config.watch.candidateIdleSeconds) {
    return "active";
  }
  if (ageSeconds < config.watch.finalizeIdleSeconds) {
    return "candidate_ready";
  }
  return "finalize_ready";
}

export function evaluateAutoRename(
  detail: SessionDetail,
  config: EffectiveConfig,
  options?: {
    now?: Date;
    renameState?: RenameStateRecord;
  }
): AutoRenameEvaluation {
  const now = options?.now ?? new Date();
  const renameState = options?.renameState;
  const statusEstimate = estimateSessionStatus(detail, config, now);

  if (detail.frozen) {
    return {
      threadId: detail.threadId,
      statusEstimate,
      action: "skip",
      reason: "frozen"
    };
  }

  if ((renameState?.autoApplyCount ?? 0) >= config.watch.maxAutoRenamesPerSession) {
    return {
      threadId: detail.threadId,
      statusEstimate,
      action: "skip",
      reason: "max_auto_renames_reached"
    };
  }

  if (renameState?.lastAutoApplySuccessAt) {
    const ageSeconds =
      (now.getTime() - new Date(renameState.lastAutoApplySuccessAt).getTime()) / 1000;
    if (ageSeconds < config.watch.renameCooldownSeconds) {
      return {
        threadId: detail.threadId,
        statusEstimate,
        action: "skip",
        reason: "rename_cooldown"
      };
    }
  }

  if (statusEstimate === "candidate_ready") {
    return {
      threadId: detail.threadId,
      statusEstimate,
      action: "suggest",
      reason: "candidate_ready"
    };
  }

  if (statusEstimate === "finalize_ready") {
    return {
      threadId: detail.threadId,
      statusEstimate,
      action: "apply",
      reason: "finalize_ready"
    };
  }

  return {
    threadId: detail.threadId,
    statusEstimate,
    action: "skip",
    reason: statusEstimate
  };
}
