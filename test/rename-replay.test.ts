import { describe, expect, it } from "vitest";

import { createManagerForTest, createTempWorkspace, writeRolloutFixture } from "./helpers.js";

describe("rename replay queue", () => {
  it("requeues sessions after a chosen updated-at timestamp", async () => {
    const workspace = await createTempWorkspace();
    const threadId = "019d-replay-updated-at";
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir
    });

    try {
      await writeRolloutFixture({
        codexHome: workspace.codexHome,
        threadId,
        userMessage: "把设置页的 context 策略做细一点",
        lastAgentMessage: "已经加上新的 transcript 过滤模式",
        updatedAt: "2026-04-04T12:00:00.000Z"
      });

      await manager.apply(threadId);
      expect((await manager.getSessionDetail(threadId))?.dirty).toBe(false);

      const replay = await manager.requeueRenamesSince({
        since: "2026-04-04T00:00:00.000Z",
        basis: "session-updated-at"
      });

      expect(replay.queued).toBe(1);
      expect(replay.matchedThreadIds).toEqual([threadId]);

      const detail = await manager.getSessionDetail(threadId);
      const renameState = manager.db.getRenameState(threadId);
      expect(detail?.dirty).toBe(true);
      expect(renameState?.forceRewrite).toBe(true);
      expect(detail?.candidateName).toBeUndefined();

      const overview = await manager.overview();
      expect(overview.replay.lastRunAt).toBeDefined();
      expect(overview.replay.recentRuns[0]?.basis).toBe("session-updated-at");
      expect(overview.replay.recentRuns[0]?.queued).toBe(1);
    } finally {
      await manager.close();
    }
  });
});
