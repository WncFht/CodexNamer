import fs from "node:fs/promises";
import path from "node:path";
import { readSessionIndex } from "@codexnamer/core";
import { afterEach, describe, expect, it } from "vitest";

import { createManagerForTest, createTempWorkspace, writeRolloutFixture } from "./helpers.js";

describe("batch dirty apply", () => {
  const managers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    for (const manager of managers) {
      await manager.close();
    }
    managers.length = 0;
  });

  it("renames dirty sessions once and skips unchanged reruns", async () => {
    const workspace = await createTempWorkspace();
    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "thread-a",
      userMessage: "实现 session rename",
      lastAgentMessage: "完成第一版 session rename 设计",
    });
    await fs.writeFile(path.join(workspace.codexHome, "session_index.jsonl"), "", "utf8");

    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
    });
    managers.push(manager);

    const first = await manager.batchApplyDirty();
    expect(first).toHaveLength(1);
    expect(first[0]?.action).toBe("applied");

    const snapshot = await readSessionIndex(path.join(workspace.codexHome, "session_index.jsonl"));
    expect(snapshot.stats.totalLines).toBe(1);

    const second = await manager.batchApplyDirty();
    expect(second).toHaveLength(0);

    const secondSnapshot = await readSessionIndex(
      path.join(workspace.codexHome, "session_index.jsonl"),
    );
    expect(secondSnapshot.stats.totalLines).toBe(1);
  });
});
