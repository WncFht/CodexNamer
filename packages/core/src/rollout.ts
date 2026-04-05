import fs from "node:fs/promises";
import path from "node:path";

import fg from "fast-glob";
import type {
  MaterializedSession,
  RenameContextStrategy,
  SessionTranscript,
  SessionTranscriptPage,
  SessionTranscriptEntry,
  SessionTranscriptRole
} from "@codex-session-manager/shared";

import { basenameSafe, excerpt, normalizeWhitespace, stripControl } from "./util.js";

export interface IngestCursorRecord {
  rolloutPath: string;
  lastOffset: number;
  lastSize: number;
  lastMtime?: string;
  lastScanAt?: string;
}

export interface RolloutIngestResult {
  session?: MaterializedSession;
  cursor: IngestCursorRecord;
  growthBytes: number;
  taskCompleteDelta: number;
  lastAgentChanged: boolean;
  lastUserChanged: boolean;
}

export interface RenameTranscriptContext {
  strategy: RenameContextStrategy;
  userMessagesText?: string;
  assistantMessagesText?: string;
  contextText?: string;
}

interface RolloutEvent {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

function normalizeTranscriptText(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }

  const normalized = input
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .trim();

  return normalized.length > 0 ? normalized : undefined;
}

function shouldHideTranscriptMessage(role: SessionTranscriptRole, content: string): {
  hidden: boolean;
  reason?: string;
} {
  if (role === "system") {
    return {
      hidden: true,
      reason: "system_bootstrap"
    };
  }

  if (
    content.includes("AGENTS.md instructions") ||
    content.includes("<environment_context>") ||
    content.includes("<permissions instructions>") ||
    content.includes("<skills_instructions>")
  ) {
    return {
      hidden: true,
      reason: "bootstrap_context"
    };
  }

  return {
    hidden: false
  };
}

function flattenContentItems(
  content: unknown,
  allowedTypes?: string[]
): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }

  const values = content
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .filter((item) =>
      allowedTypes
        ? typeof item.type === "string" && allowedTypes.includes(item.type)
        : typeof item.text === "string"
    )
    .map((item) => normalizeTranscriptText(item.text))
    .filter((value): value is string => Boolean(value))
    .join("\n\n")
    .trim();

  return values.length > 0 ? values : undefined;
}

function summarizeFunctionArguments(name: string | undefined, rawArguments: unknown): string | undefined {
  if (typeof rawArguments !== "string" || rawArguments.trim().length === 0) {
    return name ? `${name}()` : undefined;
  }

  try {
    const parsed = JSON.parse(rawArguments) as Record<string, unknown>;
    if (name === "shell_command") {
      const command = normalizeTranscriptText(parsed.command);
      const workdir = normalizeTranscriptText(parsed.workdir);
      return [command, workdir ? `cwd: ${workdir}` : undefined].filter(Boolean).join("\n");
    }
    return normalizeTranscriptText(JSON.stringify(parsed, null, 2)) ?? normalizeTranscriptText(rawArguments);
  } catch {
    return normalizeTranscriptText(rawArguments);
  }
}

function transcriptEntryId(index: number, fallback: string): string {
  return `${String(index).padStart(6, "0")}-${fallback}`;
}

function pushTranscriptEntry(
  items: SessionTranscriptEntry[],
  entry: Omit<SessionTranscriptEntry, "id">
): void {
  items.push({
    id: transcriptEntryId(items.length + 1, entry.callId ?? entry.kind),
    ...entry
  });
}

function extractContentText(
  content: unknown,
  allowedTypes: string[]
): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }

  const values = content
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .filter((item) => {
      const type = item.type;
      return typeof type === "string" && allowedTypes.includes(type);
    })
    .map((item) => item.text)
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .trim();

  return values.length > 0 ? values : undefined;
}

function shouldIgnoreFallbackUserMessage(value: string): boolean {
  return value.includes("AGENTS.md instructions") || value.includes("<environment_context>");
}

function mergeEventIntoSession(
  session: MaterializedSession,
  event: RolloutEvent
): { taskCompleteDelta: number; lastAgentChanged: boolean; lastUserChanged: boolean } {
  const timestamp = event.timestamp;
  const payload = event.payload ?? {};

  let taskCompleteDelta = 0;
  let lastAgentChanged = false;
  let lastUserChanged = false;

  if (timestamp) {
    session.updatedAt = timestamp;
  }

  switch (event.type) {
    case "session_meta": {
      session.threadId = String(payload.id ?? session.threadId);
      session.createdAt = String(payload.timestamp ?? timestamp ?? session.createdAt ?? "");
      session.updatedAt = session.updatedAt ?? session.createdAt;
      session.cwd = (payload.cwd as string | undefined) ?? session.cwd;
      session.projectName = basenameSafe(session.cwd);
      session.modelProvider = (payload.model_provider as string | undefined) ?? session.modelProvider;
      break;
    }
    case "turn_context": {
      session.model = (payload.model as string | undefined) ?? session.model;
      session.cwd = (payload.cwd as string | undefined) ?? session.cwd;
      session.projectName = basenameSafe(session.cwd);
      break;
    }
    case "task_complete": {
      const nextMessage = normalizeWhitespace(payload.last_agent_message as string | undefined);
      taskCompleteDelta = 1;
      session.taskCompleteCount += 1;
      if (nextMessage && nextMessage !== session.lastAgentMessage) {
        session.lastAgentMessage = excerpt(nextMessage, 240);
        lastAgentChanged = true;
      }
      break;
    }
    case "token_count": {
      const info = payload.info as Record<string, unknown> | undefined;
      const totalUsage = info?.total_token_usage as Record<string, unknown> | undefined;
      const totalTokens = totalUsage?.total_tokens;
      if (typeof totalTokens === "number") {
        session.tokenTotal = totalTokens;
      }
      break;
    }
    case "event_msg": {
      const eventType = payload.type as string | undefined;
      if (eventType === "user_message") {
        const message = excerpt(stripControl(payload.message as string | undefined), 200);
        if (message) {
          if (!session.firstUserMessage) {
            session.firstUserMessage = message;
          }
          if (message !== session.lastUserMessage) {
            session.lastUserMessage = message;
            lastUserChanged = true;
          }
        }
      }
      break;
    }
    case "response_item": {
      const role = payload.role as string | undefined;
      const itemType = payload.type as string | undefined;
      if (itemType !== "message") {
        break;
      }

      if (role === "assistant") {
        const text = excerpt(
          stripControl(extractContentText(payload.content, ["output_text"])),
          240
        );
        if (text && text !== session.lastAgentMessage) {
          session.lastAgentMessage = text;
        }
      } else if (role === "user" && !session.firstUserMessage) {
        const text = excerpt(
          stripControl(extractContentText(payload.content, ["input_text"])),
          200
        );
        if (text && !shouldIgnoreFallbackUserMessage(text)) {
          session.firstUserMessage = text;
          session.lastUserMessage = text;
          lastUserChanged = true;
        }
      }
      break;
    }
    default:
      break;
  }

  return {
    taskCompleteDelta,
    lastAgentChanged,
    lastUserChanged
  };
}

export async function discoverRolloutFiles(codexHome: string): Promise<string[]> {
  const sessionsRoot = path.join(codexHome, "sessions");
  const files = await fg("**/rollout-*.jsonl", {
    cwd: sessionsRoot,
    absolute: true,
    onlyFiles: true
  });

  return files.sort();
}

export async function ingestRolloutFile(params: {
  rolloutPath: string;
  stat?: { size: number; mtime: Date };
  previousSession?: MaterializedSession;
  previousCursor?: IngestCursorRecord;
}): Promise<RolloutIngestResult> {
  const stat = params.stat ?? (await fs.stat(params.rolloutPath));
  const previousCursor = params.previousCursor;
  const startOffset =
    previousCursor && previousCursor.lastOffset <= stat.size ? previousCursor.lastOffset : 0;
  const growthBytes = stat.size - startOffset;

  const handle = await fs.open(params.rolloutPath, "r");
  const buffer = Buffer.alloc(Math.max(0, stat.size - startOffset));
  try {
    if (buffer.length > 0) {
      await handle.read(buffer, 0, buffer.length, startOffset);
    }
  } finally {
    await handle.close();
  }

  const text = buffer.toString("utf8");
  const lastNewline = text.lastIndexOf("\n");
  const processable =
    lastNewline >= 0 ? text.slice(0, lastNewline + 1) : startOffset === 0 ? text : "";
  const nextOffset =
    lastNewline >= 0
      ? startOffset + Buffer.byteLength(processable, "utf8")
      : startOffset === 0
        ? stat.size
        : startOffset;

  const session: MaterializedSession = params.previousSession
    ? { ...params.previousSession }
    : {
        threadId: "",
        rolloutPath: params.rolloutPath,
        taskCompleteCount: 0,
        tokenTotal: 0
      };

  let taskCompleteDelta = 0;
  let lastAgentChanged = false;
  let lastUserChanged = false;

  for (const line of processable.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }

    try {
      const event = JSON.parse(line) as RolloutEvent;
      const merged = mergeEventIntoSession(session, event);
      taskCompleteDelta += merged.taskCompleteDelta;
      lastAgentChanged ||= merged.lastAgentChanged;
      lastUserChanged ||= merged.lastUserChanged;
    } catch {
      continue;
    }
  }

  session.rolloutPath = params.rolloutPath;
  if (!session.projectName) {
    session.projectName = basenameSafe(session.cwd);
  }

  return {
    session: session.threadId ? session : undefined,
    cursor: {
      rolloutPath: params.rolloutPath,
      lastOffset: nextOffset === 0 ? stat.size : nextOffset,
      lastSize: stat.size,
      lastMtime: stat.mtime.toISOString(),
      lastScanAt: new Date().toISOString()
    },
    growthBytes,
    taskCompleteDelta,
    lastAgentChanged,
    lastUserChanged
  };
}

export async function readSessionTranscript(rolloutPath: string): Promise<SessionTranscript> {
  const raw = await fs.readFile(rolloutPath, "utf8");
  const items: SessionTranscriptEntry[] = [];

  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }

    let event: RolloutEvent;
    try {
      event = JSON.parse(line) as RolloutEvent;
    } catch {
      continue;
    }

    const payload = event.payload ?? {};

    if (event.type === "response_item") {
      const itemType = payload.type as string | undefined;
      if (itemType === "message") {
        const role = payload.role as string | undefined;
        const transcriptRole: SessionTranscriptRole =
          role === "assistant" ? "assistant" : role === "user" ? "user" : "system";
        const content = flattenContentItems(
          payload.content,
          transcriptRole === "assistant" ? ["output_text", "input_text"] : ["input_text", "output_text"]
        );
        if (!content) {
          continue;
        }
        const hidden = shouldHideTranscriptMessage(transcriptRole, content);
        pushTranscriptEntry(items, {
          timestamp: event.timestamp,
          role: transcriptRole,
          kind: "message",
          content,
          phase: typeof payload.phase === "string" ? payload.phase : undefined,
          hidden: hidden.hidden,
          hiddenReason: hidden.reason
        });
        continue;
      }

      if (itemType === "function_call") {
        const content = summarizeFunctionArguments(
          payload.name as string | undefined,
          payload.arguments
        );
        if (!content) {
          continue;
        }
        pushTranscriptEntry(items, {
          timestamp: event.timestamp,
          role: "tool",
          kind: "tool_call",
          name: (payload.name as string | undefined) ?? "tool",
          callId: (payload.call_id as string | undefined) ?? undefined,
          content
        });
        continue;
      }

      if (itemType === "function_call_output") {
        const content = normalizeTranscriptText(payload.output);
        if (!content) {
          continue;
        }
        pushTranscriptEntry(items, {
          timestamp: event.timestamp,
          role: "tool",
          kind: "tool_output",
          callId: (payload.call_id as string | undefined) ?? undefined,
          content
        });
        continue;
      }

      if (itemType === "reasoning") {
        const summary = Array.isArray(payload.summary)
          ? payload.summary
              .map((item) => {
                if (typeof item === "string") {
                  return item;
                }
                if (item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string") {
                  return (item as Record<string, unknown>).text as string;
                }
                return undefined;
              })
              .filter((value): value is string => Boolean(value))
              .join("\n")
          : undefined;
        if (!summary) {
          continue;
        }
        pushTranscriptEntry(items, {
          timestamp: event.timestamp,
          role: "assistant",
          kind: "reasoning",
          content: summary,
          hidden: true,
          hiddenReason: "reasoning"
        });
      }

      continue;
    }

    if (event.type === "event_msg") {
      const eventType = payload.type as string | undefined;
      if (eventType === "task_started") {
        pushTranscriptEntry(items, {
          timestamp: event.timestamp,
          role: "system",
          kind: "status",
          content: "Task started",
          hidden: true,
          hiddenReason: "task_status"
        });
        continue;
      }

      if (eventType === "task_complete") {
        const content = normalizeTranscriptText(payload.last_agent_message) ?? "Task completed";
        pushTranscriptEntry(items, {
          timestamp: event.timestamp,
          role: "system",
          kind: "status",
          content,
          hidden: true,
          hiddenReason: "task_status"
        });
      }
    }
  }

  return {
    items,
    counts: {
      total: items.length,
      visible: items.filter((item) => !item.hidden).length,
      hidden: items.filter((item) => item.hidden).length,
      tools: items.filter((item) => item.role === "tool").length
    }
  };
}

function clipTranscriptChunk(value: string | undefined, maxChars: number): string | undefined {
  const normalized = normalizeWhitespace(stripControl(value));
  if (!normalized) {
    return undefined;
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

export async function readRenameTranscriptContext(params: {
  rolloutPath: string;
  strategy: RenameContextStrategy;
  maxChars: number;
}): Promise<RenameTranscriptContext> {
  const transcript = await readSessionTranscript(params.rolloutPath);
  const maxChars = Math.max(500, params.maxChars);
  const perMessageLimit = Math.max(160, Math.min(1200, Math.floor(maxChars / 8)));
  const userParts: string[] = [];
  const assistantParts: string[] = [];
  const chronologicalParts: string[] = [];
  let userBudget = maxChars;
  let assistantBudget = maxChars;
  let chronologicalBudget = maxChars;

  for (const entry of transcript.items) {
    if (entry.kind !== "message" || entry.hidden) {
      continue;
    }
    if (entry.role !== "user" && entry.role !== "assistant") {
      continue;
    }

    const clipped = clipTranscriptChunk(entry.content, perMessageLimit);
    if (!clipped) {
      continue;
    }

    if (entry.role === "user" && userBudget > 0) {
      const next = clipTranscriptChunk(clipped, userBudget);
      if (next) {
        userParts.push(next);
        userBudget -= next.length + 2;
      }
    }

    if (entry.role === "assistant" && assistantBudget > 0) {
      const next = clipTranscriptChunk(clipped, assistantBudget);
      if (next) {
        assistantParts.push(next);
        assistantBudget -= next.length + 2;
      }
    }

    if (chronologicalBudget > 0) {
      const prefixed = `${entry.role === "user" ? "User" : "Assistant"}: ${clipped}`;
      const next = clipTranscriptChunk(prefixed, chronologicalBudget);
      if (next) {
        chronologicalParts.push(next);
        chronologicalBudget -= next.length + 2;
      }
    }
  }

  return {
    strategy: params.strategy,
    userMessagesText: userParts.join("\n\n") || undefined,
    assistantMessagesText: assistantParts.join("\n\n") || undefined,
    contextText: chronologicalParts.join("\n\n") || undefined
  };
}

export async function readSessionTranscriptPage(params: {
  rolloutPath: string;
  page?: number;
  pageSize?: number;
  includeHidden?: boolean;
  role?: SessionTranscriptRole | "all";
  query?: string;
}): Promise<SessionTranscriptPage> {
  const transcript = await readSessionTranscript(params.rolloutPath);
  const pageSize = Math.max(1, Math.floor(params.pageSize ?? 40));
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const query = normalizeWhitespace(params.query)?.toLowerCase();
  const role = params.role ?? "all";

  const filteredItems = transcript.items.filter((item) => {
    if (!params.includeHidden && item.hidden) {
      return false;
    }
    if (role !== "all" && item.role !== role) {
      return false;
    }
    if (query && !item.content.toLowerCase().includes(query)) {
      return false;
    }
    return true;
  });

  const totalItems = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);
  const endExclusive = totalItems - (currentPage - 1) * pageSize;
  const startInclusive = Math.max(0, endExclusive - pageSize);
  const items = filteredItems.slice(startInclusive, Math.max(startInclusive, endExclusive));

  return {
    items,
    counts: transcript.counts,
    totalItems,
    totalPages,
    page: currentPage,
    pageSize,
    hasMore: currentPage < totalPages
  };
}
