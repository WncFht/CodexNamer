import type {
  EffectiveConfig,
  MaterializedSession,
  RenameContext,
  RenameContextSegment,
  RenameContextSegmentSource,
  RenameContextStrategy,
  SessionTranscript
} from "@codex-session-manager/shared";

import { excerpt, normalizeWhitespace, stripControl } from "./util.js";

function normalizeContextMessage(value?: string): string | undefined {
  return normalizeWhitespace(stripControl(value));
}

function buildSegment(
  role: "user" | "assistant",
  content: string | undefined,
  source: RenameContextSegmentSource,
  timestamp?: string
): RenameContextSegment | undefined {
  const normalized = normalizeContextMessage(content);
  if (!normalized) {
    return undefined;
  }

  return {
    role,
    content: normalized,
    source,
    timestamp
  };
}

function linePrefix(segment: RenameContextSegment): string {
  switch (segment.source) {
    case "summary_first_user":
      return "user(first): ";
    case "summary_last_user":
      return "user(last): ";
    case "summary_last_assistant":
      return "assistant(last): ";
    case "transcript_seed":
      return "user(goal): ";
    case "transcript_recent":
      return `${segment.role}: `;
    default:
      return `${segment.role}: `;
  }
}

function appendWithinBudget(
  selected: RenameContextSegment[],
  segment: RenameContextSegment,
  remainingChars: number
): { usedChars: number; clipped: boolean } {
  const prefix = linePrefix(segment);
  const newlineChars = selected.length > 0 ? 1 : 0;
  const contentBudget = remainingChars - newlineChars - prefix.length;
  if (contentBudget <= 0) {
    return {
      usedChars: 0,
      clipped: false
    };
  }

  const clippedContent = excerpt(segment.content, contentBudget);
  if (!clippedContent) {
    return {
      usedChars: 0,
      clipped: false
    };
  }

  selected.push({
    ...segment,
    content: clippedContent
  });

  return {
    usedChars: newlineChars + prefix.length + clippedContent.length,
    clipped: clippedContent !== segment.content
  };
}

function formatContextText(segments: RenameContextSegment[]): string {
  return segments.map((segment) => `${linePrefix(segment)}${segment.content}`).join("\n");
}

function dedupeConsecutiveSegments(segments: RenameContextSegment[]): RenameContextSegment[] {
  const output: RenameContextSegment[] = [];
  for (const segment of segments) {
    const previous = output[output.length - 1];
    if (
      previous &&
      previous.role === segment.role &&
      previous.content === segment.content
    ) {
      continue;
    }
    output.push(segment);
  }
  return output;
}

function buildSummaryCandidates(
  session: MaterializedSession,
  strategy: Extract<RenameContextStrategy, "summary-signals" | "last-user-last-assistant">
): RenameContextSegment[] {
  if (strategy === "last-user-last-assistant") {
    return [
      buildSegment("user", session.lastUserMessage, "summary_last_user"),
      buildSegment("assistant", session.lastAgentMessage, "summary_last_assistant")
    ].filter((value): value is RenameContextSegment => Boolean(value));
  }

  return [
    buildSegment("user", session.firstUserMessage, "summary_first_user"),
    buildSegment(
      "user",
      session.lastUserMessage && session.lastUserMessage !== session.firstUserMessage
        ? session.lastUserMessage
        : undefined,
      "summary_last_user"
    ),
    buildSegment("assistant", session.lastAgentMessage, "summary_last_assistant")
  ].filter((value): value is RenameContextSegment => Boolean(value));
}

function buildContextFromCandidates(
  candidates: RenameContextSegment[],
  maxChars: number,
  requestedStrategy: RenameContext["requestedStrategy"],
  strategy: RenameContext["strategy"],
  session: MaterializedSession,
  fallbackReason?: RenameContext["fallbackReason"]
): RenameContext {
  const selected: RenameContextSegment[] = [];
  let remainingChars = maxChars;
  let truncated = false;

  for (const candidate of candidates) {
    const appended = appendWithinBudget(selected, candidate, remainingChars);
    if (appended.usedChars === 0) {
      truncated ||= selected.length > 0;
      break;
    }
    truncated ||= appended.clipped;
    remainingChars -= appended.usedChars;
  }

  return {
    requestedStrategy,
    strategy,
    maxChars,
    text: formatContextText(selected),
    truncated,
    fallbackReason,
    selectedChars: Math.max(0, maxChars - remainingChars),
    segments: selected,
    summarySignals: {
      firstUserMessage: normalizeContextMessage(session.firstUserMessage),
      lastUserMessage: normalizeContextMessage(session.lastUserMessage),
      lastAgentMessage: normalizeContextMessage(session.lastAgentMessage)
    }
  };
}

function buildSummarySignalContext(
  session: MaterializedSession,
  maxChars: number,
  requestedStrategy: RenameContext["requestedStrategy"],
  fallbackReason?: RenameContext["fallbackReason"]
): RenameContext {
  return buildContextFromCandidates(
    buildSummaryCandidates(session, "summary-signals"),
    maxChars,
    requestedStrategy,
    "summary-signals",
    session,
    fallbackReason
  );
}

function buildLastTurnContext(
  session: MaterializedSession,
  maxChars: number,
  requestedStrategy: RenameContext["requestedStrategy"]
): RenameContext {
  return buildContextFromCandidates(
    buildSummaryCandidates(session, "last-user-last-assistant"),
    maxChars,
    requestedStrategy,
    "last-user-last-assistant",
    session
  );
}

function buildTranscriptCandidates(
  transcript: SessionTranscript | undefined,
  roles: Array<"user" | "assistant">
): RenameContextSegment[] {
  if (!transcript) {
    return [];
  }

  const allowedRoles = new Set(roles);

  const candidates = transcript.items
    .filter((item) => !item.hidden)
    .filter((item) => item.kind === "message")
    .filter((item): item is typeof item & { role: "user" | "assistant" } =>
      item.role === "user" || item.role === "assistant"
    )
    .filter((item) => allowedRoles.has(item.role))
    .map((item) =>
      buildSegment(item.role, item.content, "transcript_recent", item.timestamp)
    )
    .filter((value): value is RenameContextSegment => Boolean(value));

  return dedupeConsecutiveSegments(candidates);
}

function buildTranscriptContext(
  session: MaterializedSession,
  maxChars: number,
  requestedStrategy: Extract<
    RenameContextStrategy,
    | "user-assistant-transcript"
    | "user-only-transcript"
    | "assistant-only-transcript"
    | "user-transcript-last-assistant"
  >,
  transcript?: SessionTranscript
): RenameContext {
  if (!transcript) {
    return buildSummarySignalContext(
      session,
      maxChars,
      requestedStrategy,
      "missing_transcript"
    );
  }

  const roles =
    requestedStrategy === "assistant-only-transcript"
      ? (["assistant"] as Array<"assistant">)
      : requestedStrategy === "user-assistant-transcript"
        ? (["user", "assistant"] as Array<"user" | "assistant">)
        : (["user"] as Array<"user">);

  const recentCandidates = buildTranscriptCandidates(transcript, roles);
  if (recentCandidates.length === 0) {
    return buildSummarySignalContext(
      session,
      maxChars,
      requestedStrategy,
      "empty_transcript"
    );
  }

  const seedContent =
    requestedStrategy === "assistant-only-transcript"
      ? undefined
      : normalizeContextMessage(session.firstUserMessage) ??
        recentCandidates.find((segment) => segment.role === "user")?.content;
  const seedSegment = seedContent
    ? buildSegment("user", seedContent, "transcript_seed")
    : undefined;

  const selected: RenameContextSegment[] = [];
  let remainingChars = maxChars;
  let truncated = false;

  if (seedSegment) {
    const appended = appendWithinBudget(selected, seedSegment, remainingChars);
    if (appended.usedChars > 0) {
      truncated ||= appended.clipped;
      remainingChars -= appended.usedChars;
    }
  }

  const tail: RenameContextSegment[] = [];
  for (let index = recentCandidates.length - 1; index >= 0; index -= 1) {
    const candidate = recentCandidates[index];
    if (!candidate) {
      continue;
    }
    if (
      seedSegment &&
      candidate.role === seedSegment.role &&
      candidate.content === seedSegment.content
    ) {
      continue;
    }

    const staged = [...selected, ...tail];
    const appended = appendWithinBudget(staged, candidate, remainingChars);
    if (appended.usedChars === 0) {
      truncated = true;
      continue;
    }

    truncated ||= appended.clipped;
    remainingChars -= appended.usedChars;
    const appendedCandidate = staged[staged.length - 1];
    if (!appendedCandidate) {
      continue;
    }
    tail.push(appendedCandidate);
  }

  selected.push(...tail.reverse());

  if (requestedStrategy === "user-transcript-last-assistant") {
    const lastAssistant = buildSegment("assistant", session.lastAgentMessage, "summary_last_assistant");
    if (lastAssistant) {
      const appended = appendWithinBudget(selected, lastAssistant, remainingChars);
      if (appended.usedChars > 0) {
        truncated ||= appended.clipped;
        remainingChars -= appended.usedChars;
      } else {
        truncated = true;
      }
    }
  }

  return {
    requestedStrategy,
    strategy: requestedStrategy,
    maxChars,
    text: formatContextText(selected),
    truncated,
    selectedChars: Math.max(0, maxChars - remainingChars),
    segments: selected,
    summarySignals: {
      firstUserMessage: normalizeContextMessage(session.firstUserMessage),
      lastUserMessage: normalizeContextMessage(session.lastUserMessage),
      lastAgentMessage: normalizeContextMessage(session.lastAgentMessage)
    }
  };
}

export function buildRenameContext(
  session: MaterializedSession,
  config: EffectiveConfig,
  options?: {
    transcript?: SessionTranscript;
  }
): RenameContext {
  const requestedStrategy = config.naming.contextStrategy;
  const maxChars = Math.max(32, Math.trunc(config.naming.contextMaxChars || 8_000));

  if (requestedStrategy === "summary-signals") {
    return buildSummarySignalContext(session, maxChars, requestedStrategy);
  }

  if (requestedStrategy === "last-user-last-assistant") {
    return buildLastTurnContext(session, maxChars, requestedStrategy);
  }

  return buildTranscriptContext(session, maxChars, requestedStrategy, options?.transcript);
}
