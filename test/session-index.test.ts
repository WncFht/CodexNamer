import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  appendSessionIndexRename,
  compactSessionIndex,
  readSessionIndex
} from "@codex-session-manager/core";

import { createTempWorkspace } from "./helpers.js";

describe("session index", () => {
  it("reads latest-wins entries and appends new rename lines", async () => {
    const workspace = await createTempWorkspace();
    const indexPath = path.join(workspace.codexHome, "session_index.jsonl");
    await fs.writeFile(
      indexPath,
      [
        '{"id":"t1","thread_name":"alpha","updated_at":"2026-04-04T00:00:00Z"}',
        '{"id":"t1","thread_name":"beta","updated_at":"2026-04-04T01:00:00Z"}'
      ].join("\n") + "\n"
    );

    const snapshot = await readSessionIndex(indexPath);
    expect(snapshot.stats.totalLines).toBe(2);
    expect(snapshot.latestByThreadId.get("t1")?.threadName).toBe("beta");

    const result = await appendSessionIndexRename({
      filePath: indexPath,
      threadId: "t1",
      threadName: "gamma"
    });
    expect(result.written).toBe(true);

    const updated = await readSessionIndex(indexPath);
    expect(updated.latestByThreadId.get("t1")?.threadName).toBe("gamma");
    expect(updated.stats.totalLines).toBe(3);
  });

  it("compacts to the last entry for each thread while preserving latest semantics", async () => {
    const workspace = await createTempWorkspace();
    const indexPath = path.join(workspace.codexHome, "session_index.jsonl");
    await fs.writeFile(
      indexPath,
      [
        '{"id":"t1","thread_name":"alpha","updated_at":"2026-04-04T00:00:00Z"}',
        '{"id":"t2","thread_name":"other","updated_at":"2026-04-04T00:10:00Z"}',
        '{"id":"t1","thread_name":"beta","updated_at":"2026-04-04T01:00:00Z"}'
      ].join("\n") + "\n"
    );

    const dryRun = await compactSessionIndex({ filePath: indexPath, dryRun: true });
    expect(dryRun.originalLines).toBe(3);
    expect(dryRun.compactedLines).toBe(2);

    const applied = await compactSessionIndex({
      filePath: indexPath,
      backupDir: path.join(workspace.stateDir, "backups")
    });
    expect(applied.compactedLines).toBe(2);

    const snapshot = await readSessionIndex(indexPath);
    expect(snapshot.latestByThreadId.get("t1")?.threadName).toBe("beta");
    expect(snapshot.stats.totalLines).toBe(2);
  });
});

