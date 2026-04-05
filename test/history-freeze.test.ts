import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createManagerForTest, createTempWorkspace, writeRolloutFixture } from "./helpers.js";

describe("history and state commands", () => {
  const managers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    for (const manager of managers) {
      await manager.close();
    }
    managers.length = 0;
  });

  it("stores rename history and toggles freeze/manual override", async () => {
    const workspace = await createTempWorkspace();
    const threadId = "thread-history";
    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId,
      userMessage: "实现 rename history",
      lastAgentMessage: "完成 rename history"
    });
    await fs.writeFile(path.join(workspace.codexHome, "session_index.jsonl"), "", "utf8");

    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir
    });
    managers.push(manager);

    await manager.rename(threadId, "manual title");
    await manager.freeze(threadId);
    await manager.setManualOverride(threadId);

    const detail = await manager.getSessionDetail(threadId);
    expect(detail?.frozen).toBe(true);
    expect(detail?.manualOverride).toBe(true);
    expect(detail?.renameHistory?.[0]?.newName).toBe("manual title");

    await manager.unfreeze(threadId);
    await manager.clearManualOverride(threadId);

    const updated = await manager.getSessionDetail(threadId);
    expect(updated?.frozen).toBe(false);
    expect(updated?.manualOverride).toBe(false);
  });

  it("deduplicates repeated unchanged rename history entries", async () => {
    const workspace = await createTempWorkspace();
    const threadId = "thread-history-dedup";
    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId,
      userMessage: "重复触发同一个 rename",
      lastAgentMessage: "同名不应该在 history 里反复堆积"
    });
    await fs.writeFile(path.join(workspace.codexHome, "session_index.jsonl"), "", "utf8");

    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir
    });
    managers.push(manager);

    await manager.rename(threadId, "manual title");
    manager.db.saveCandidate(threadId, {
      name: "manual title",
      source: "ai",
      generatedAt: "2026-04-04T12:00:00.000Z"
    });

    await manager.apply(threadId);
    await manager.apply(threadId);
    await manager.apply(threadId);

    const history = await manager.getRenameHistory(threadId);
    const skipped = history.filter((entry) => entry.status === "skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.reason).toBe("unchanged");
  });
});
