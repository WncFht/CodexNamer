import fs from "node:fs/promises";
import path from "node:path";

import fg from "fast-glob";
import type { MaterializedSession } from "@codex-session-manager/shared";

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

interface RolloutEvent {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
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
