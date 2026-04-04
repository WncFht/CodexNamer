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
});
