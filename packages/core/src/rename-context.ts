import type {
  EffectiveConfig,
  MaterializedSession,
  RenameContext,
  RenameContextSegment,
  RenameContextSegmentSource,
  RenameContextStrategy,
  SessionTranscript
} from "@codexnamer/shared";

import { excerpt, normalizeWhitespace, stripControl } from "./util.js";

type VisibleTranscriptMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
};

type PairedContextTurn = {
  assistant?: RenameContextSegment;
  user: RenameContextSegment;
};

const WEAK_ASSISTANT_PREFIXES = [
  /^我先/,
  /^我会/,
  /^我现在/,
  /^我已经/,
  /^我准备/,
  /^我正在/,
  /^接下来/,
  /^先检查/,
  /^先看/,
  /^我来/,
  /^我先把/,
  /^先把/,
  /^稍等/,
  /^先不/,
  /^先给/,
  /^I'll\b/i,
  /^I will\b/i,
  /^Let me\b/i,
  /^I'm going to\b/i,
  /^I am going to\b/i,
  /^I'll first\b/i
];
const PLACEHOLDER_ASSISTANT_PATTERNS = [
  /^\(内容过长/i,
  /^内容过长/i,
  /^\(content too long/i,
  /^content too long/i
];
const STRONG_ASSISTANT_SIGNAL_PATTERN =
  /定位|修复|完成|结论|原因|问题|误判|支持|实现|更新|确认|建议|需要|应用|失败|成功|回退|接入|重写|清理|合并|改成|处理|生成|写入|resolved|fixed|implemented|confirmed|updated|failed|succeeded|cause|issue|result|conclusion/i;

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
    case "paired_previous_assistant":
      return "assistant(context): ";
    case "paired_user_turn":
      return "user(turn): ";
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

function dedupeConsecutiveMessages(messages: VisibleTranscriptMessage[]): VisibleTranscriptMessage[] {
  const output: VisibleTranscriptMessage[] = [];
  for (const message of messages) {
    const previous = output[output.length - 1];
    if (previous && previous.role === message.role && previous.content === message.content) {
      continue;
    }
    output.push(message);
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
  const messages = collectTranscriptMessages(transcript, roles);
  return messages
    .map((item) => buildSegment(item.role, item.content, "transcript_recent", item.timestamp))
    .filter((value): value is RenameContextSegment => Boolean(value));
}

function collectTranscriptMessages(
  transcript: SessionTranscript | undefined,
  roles: Array<"user" | "assistant">
): VisibleTranscriptMessage[] {
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
    .map((item) => ({
      role: item.role,
      content: normalizeContextMessage(item.content) ?? "",
      timestamp: item.timestamp
    }))
    .filter((item) => Boolean(item.content)) as VisibleTranscriptMessage[];

  return dedupeConsecutiveMessages(candidates);
}

function countAssistantSignalMatches(content: string): number {
  const signals = [
    /[。.!?]/,
    /`[^`]+`/,
    /\//,
    /\d/,
    /packages\//,
    /api|config|rename|prompt|test|build|session|provider|style|context|文档|设置|会话|命名|pdf|report|chapter|image|skill/i
  ];
  return signals.filter((pattern) => pattern.test(content)).length;
}

function isSubstantiveAssistantMessage(content: string): boolean {
  const normalized = normalizeContextMessage(content);
  if (!normalized || normalized.length < 28) {
    return false;
  }
  if (PLACEHOLDER_ASSISTANT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  if (
    WEAK_ASSISTANT_PREFIXES.some((pattern) => pattern.test(normalized)) &&
    normalized.length < 80
  ) {
    return false;
  }

  if (STRONG_ASSISTANT_SIGNAL_PATTERN.test(normalized)) {
    return true;
  }

  return normalized.length >= 60 || countAssistantSignalMatches(normalized) >= 2;
}

function extractPairedTurns(messages: VisibleTranscriptMessage[]): PairedContextTurn[] {
  const turns: PairedContextTurn[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.role !== "user") {
      continue;
    }

    const userSegment = buildSegment(
      "user",
      message.content,
      turns.length === 0 ? "transcript_seed" : "paired_user_turn",
      message.timestamp
    );
    if (!userSegment) {
      continue;
    }

    let assistantSegment: RenameContextSegment | undefined;
    if (turns.length > 0) {
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const previous = messages[cursor];
        if (!previous) {
          continue;
        }
        if (previous.role === "user") {
          break;
        }
        if (!isSubstantiveAssistantMessage(previous.content)) {
          continue;
        }
        assistantSegment = buildSegment(
          "assistant",
          previous.content,
          "paired_previous_assistant",
          previous.timestamp
        );
        if (assistantSegment) {
          break;
        }
      }
    }

    turns.push({
      ...(assistantSegment ? { assistant: assistantSegment } : {}),
      user: userSegment
    });
  }

  return turns;
}

function appendTurnWithinBudget(
  selected: RenameContextSegment[],
  turn: PairedContextTurn,
  remainingChars: number
): { usedChars: number; clipped: boolean } {
  const pairedSegments = turn.assistant ? [turn.assistant, turn.user] : [turn.user];
  const staged = [...selected];
  let usedChars = 0;
  let clipped = false;

  for (const segment of pairedSegments) {
    const appended = appendWithinBudget(staged, segment, remainingChars - usedChars);
    if (appended.usedChars === 0) {
      if (segment === turn.user && turn.assistant) {
        return appendTurnWithinBudget(selected, { user: turn.user }, remainingChars);
      }
      return {
        usedChars: 0,
        clipped
      };
    }
    usedChars += appended.usedChars;
    clipped ||= appended.clipped;
  }

  selected.push(...staged.slice(selected.length));
  return {
    usedChars,
    clipped
  };
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
    | "paired-user-turns"
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

  if (requestedStrategy === "paired-user-turns") {
    const visibleMessages = collectTranscriptMessages(transcript, ["user", "assistant"]);
    const pairedTurns = extractPairedTurns(visibleMessages);
    if (pairedTurns.length === 0) {
      return buildSummarySignalContext(
        session,
        maxChars,
        requestedStrategy,
        "empty_transcript"
      );
    }

    const [seedTurn, ...remainingTurns] = pairedTurns;
    const selected: RenameContextSegment[] = [];
    let remainingChars = maxChars;
    let truncated = false;

    if (seedTurn) {
      const appended = appendTurnWithinBudget(selected, { user: seedTurn.user }, remainingChars);
      if (appended.usedChars > 0) {
        remainingChars -= appended.usedChars;
        truncated ||= appended.clipped;
      }
    }

    const tail: PairedContextTurn[] = [];
    for (let index = remainingTurns.length - 1; index >= 0; index -= 1) {
      const turn = remainingTurns[index];
      if (!turn) {
        continue;
      }

      const staged: RenameContextSegment[] = [...selected];
      for (const existing of tail.slice().reverse()) {
        if (existing.assistant) {
          staged.push(existing.assistant);
        }
        staged.push(existing.user);
      }

      const stagedSelected = [...staged];
      const appended = appendTurnWithinBudget(stagedSelected, turn, remainingChars);
      if (appended.usedChars === 0) {
        truncated = true;
        continue;
      }

      remainingChars -= appended.usedChars;
      truncated ||= appended.clipped;
      tail.push(turn.assistant ? { assistant: stagedSelected[staged.length], user: stagedSelected[staged.length + 1] ?? turn.user } : { user: stagedSelected[staged.length] ?? turn.user });
    }

    for (const turn of tail.reverse()) {
      if (turn.assistant) {
        selected.push(turn.assistant);
      }
      selected.push(turn.user);
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
