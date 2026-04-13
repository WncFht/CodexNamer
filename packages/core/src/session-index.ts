import fs from "node:fs/promises";
import path from "node:path";
import type {
  CompactIndexResult,
  SessionIndexEntry,
  SessionIndexSnapshot,
} from "@codexnamer/shared";
import { sessionIndexEntryWireSchema } from "@codexnamer/shared";

import { ensureTrailingNewline, toUtcIso } from "./util.js";

function serializeEntry(entry: SessionIndexEntry): string {
  return JSON.stringify({
    id: entry.id,
    thread_name: entry.threadName,
    updated_at: entry.updatedAt,
  });
}

export async function readSessionIndex(filePath: string): Promise<SessionIndexSnapshot> {
  let content = "";
  let sizeBytes = 0;

  try {
    content = await fs.readFile(filePath, "utf8");
    sizeBytes = Buffer.byteLength(content);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  const entries: SessionIndexEntry[] = [];
  const latestByThreadId = new Map<string, SessionIndexEntry>();
  const lines = content.length > 0 ? content.split(/\r?\n/) : [];

  let lineNumber = 0;
  for (const rawLine of lines) {
    if (rawLine.trim().length === 0) {
      continue;
    }

    lineNumber += 1;
    try {
      const parsed = sessionIndexEntryWireSchema.parse(JSON.parse(rawLine));
      const entry: SessionIndexEntry = { ...parsed, lineNumber };
      entries.push(entry);
      latestByThreadId.set(entry.id, entry);
    } catch {
      continue;
    }
  }

  return {
    entries,
    latestByThreadId,
    stats: {
      totalLines: entries.length,
      uniqueThreadIds: latestByThreadId.size,
      duplicateThreadIds: entries.length - latestByThreadId.size,
      sizeBytes,
    },
  };
}

export async function appendSessionIndexRename(params: {
  filePath: string;
  threadId: string;
  threadName: string;
  updatedAt?: string;
  snapshot?: SessionIndexSnapshot;
}): Promise<{ written: boolean; entry: SessionIndexEntry }> {
  const threadName = params.threadName.trim();
  if (threadName.length === 0) {
    throw new Error("Thread name cannot be empty.");
  }

  const snapshot = params.snapshot ?? (await readSessionIndex(params.filePath));
  const current = snapshot.latestByThreadId.get(params.threadId);
  const entry: SessionIndexEntry = {
    id: params.threadId,
    threadName,
    updatedAt: params.updatedAt ?? toUtcIso(),
  };

  if (current?.threadName === threadName) {
    return { written: false, entry: current };
  }

  await fs.mkdir(path.dirname(params.filePath), { recursive: true });
  await fs.appendFile(params.filePath, ensureTrailingNewline(serializeEntry(entry)), "utf8");

  return { written: true, entry };
}

export async function compactSessionIndex(params: {
  filePath: string;
  dryRun?: boolean;
  backupDir?: string;
}): Promise<CompactIndexResult> {
  const snapshot = await readSessionIndex(params.filePath);
  const lastOccurrence = new Map<string, { index: number; entry: SessionIndexEntry }>();

  snapshot.entries.forEach((entry, index) => {
    lastOccurrence.set(entry.id, { index, entry });
  });

  const compactedEntries = [...lastOccurrence.values()]
    .sort((left, right) => left.index - right.index)
    .map((value) => value.entry);

  const compactedContent = compactedEntries.map((entry) => serializeEntry(entry)).join("\n");
  const compactedWithNewline =
    compactedContent.length > 0 ? ensureTrailingNewline(compactedContent) : "";
  const compactedSizeBytes = Buffer.byteLength(compactedWithNewline);

  if (params.dryRun) {
    return {
      dryRun: true,
      originalLines: snapshot.entries.length,
      compactedLines: compactedEntries.length,
      originalSizeBytes: snapshot.stats.sizeBytes,
      compactedSizeBytes,
    };
  }

  await fs.mkdir(path.dirname(params.filePath), { recursive: true });

  const tmpPath = `${params.filePath}.tmp-${Date.now()}`;
  let backupPath: string | undefined;

  if (params.backupDir) {
    await fs.mkdir(params.backupDir, { recursive: true });
    backupPath = path.join(
      params.backupDir,
      `session_index-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
    );
    try {
      await fs.copyFile(params.filePath, backupPath);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ENOENT") {
        throw error;
      }
      backupPath = undefined;
    }
  }

  await fs.writeFile(tmpPath, compactedWithNewline, "utf8");
  await fs.rename(tmpPath, params.filePath);

  return {
    dryRun: false,
    originalLines: snapshot.entries.length,
    compactedLines: compactedEntries.length,
    originalSizeBytes: snapshot.stats.sizeBytes,
    compactedSizeBytes,
    outputPath: params.filePath,
    backupPath,
  };
}
