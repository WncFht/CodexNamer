import { describe, expect, it } from "vitest";

import { createManagerForTest, createTempWorkspace, writeRolloutFixture } from "./helpers.js";

describe("overview rename aggregation", () => {
  it("deduplicates repeated rename history from the same session", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
    });

    try {
      await writeRolloutFixture({
        codexHome: workspace.codexHome,
        threadId: "overview-dedup-1",
        userMessage: "第一个会话",
        lastAgentMessage: "第一个会话已经完成",
        updatedAt: "2026-04-05T12:00:00.000Z",
      });
      await writeRolloutFixture({
        codexHome: workspace.codexHome,
        threadId: "overview-dedup-2",
        userMessage: "第二个会话",
        lastAgentMessage: "第二个会话已经完成",
        updatedAt: "2026-04-05T13:00:00.000Z",
      });

      await manager.scan();
      manager.db.recordRename({
        threadId: "overview-dedup-1",
        newName: "第一次命名",
        source: "manual",
        kind: "manual",
        style: "detailed",
        status: "applied",
        operator: "test",
        appliedAt: "2026-04-04T12:00:00.000Z",
        autoApply: false,
      });
      manager.db.recordRename({
        threadId: "overview-dedup-1",
        newName: "第二次命名",
        source: "manual",
        kind: "manual",
        style: "detailed",
        status: "applied",
        operator: "test",
        appliedAt: "2026-04-05T12:00:00.000Z",
        autoApply: false,
      });
      manager.db.recordRename({
        threadId: "overview-dedup-2",
        newName: "AI 命名",
        source: "ai",
        kind: "auto",
        style: "detailed",
        status: "applied",
        operator: "test",
        appliedAt: "2026-04-05T13:00:00.000Z",
        autoApply: true,
      });

      const overview = await manager.overview();
      expect(overview.renameHistory.applied).toBe(2);
      expect(overview.renameHistory.manualApplied).toBe(1);
      expect(overview.renameHistory.aiApplied).toBe(1);
      expect(overview.renameHistory.autoApplied).toBe(1);

      const bucket0404 = overview.activity.buckets.find((bucket) => bucket.date === "2026-04-04");
      const bucket0405 = overview.activity.buckets.find((bucket) => bucket.date === "2026-04-05");
      expect(bucket0404?.applied ?? 0).toBe(0);
      expect(bucket0405?.applied ?? 0).toBe(2);
    } finally {
      await manager.close();
    }
  });
});
