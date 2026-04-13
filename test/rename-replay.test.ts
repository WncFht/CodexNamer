import { describe, expect, it } from "vitest";

import { createManagerForTest, createTempWorkspace, writeRolloutFixture } from "./helpers.js";

describe("rename replay queue", () => {
  it("skips sessions that already use the latest rule signature", async () => {
    const workspace = await createTempWorkspace();
    const threadId = "019d-replay-latest";
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
    });

    try {
      await writeRolloutFixture({
        codexHome: workspace.codexHome,
        threadId,
        userMessage: "把设置页的 context 策略做细一点",
        lastAgentMessage: "已经加上新的 transcript 过滤模式",
        updatedAt: "2026-04-04T12:00:00.000Z",
      });

      await manager.apply(threadId);

      const preview = await manager.previewRequeueRenamesSince({
        since: "2026-04-04T00:00:00.000Z",
        basis: "session-updated-at",
      });

      expect(preview.currentRuleSignature).toBeTruthy();
      expect(preview.matched).toBe(1);
      expect(preview.queued).toBe(0);
      expect(preview.skipped).toBe(1);
      expect(preview.items).toEqual([
        expect.objectContaining({
          threadId,
          ruleStatus: "latest",
          action: "skip",
          reason: "already_latest_rule",
        }),
      ]);

      const replay = await manager.requeueRenamesSince({
        since: "2026-04-04T00:00:00.000Z",
        basis: "session-updated-at",
      });

      expect(replay.queued).toBe(0);
      expect(replay.skipped).toBe(1);
      expect(replay.skipCounts.already_latest_rule).toBe(1);

      const detail = await manager.getSessionDetail(threadId);
      expect(detail?.dirty).toBe(false);
      expect(detail?.lastAppliedRuleSignature).toBe(preview.currentRuleSignature);
    } finally {
      await manager.close();
    }
  });

  it("queues sessions when the current rule signature changes", async () => {
    const workspace = await createTempWorkspace();
    const threadId = "019d-replay-rule-mismatch";
    const initialManager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
    });

    try {
      await writeRolloutFixture({
        codexHome: workspace.codexHome,
        threadId,
        userMessage: "把命名规则改成更强调 workspace",
        lastAgentMessage: "已经整理成新的命名 builder",
        updatedAt: "2026-04-04T13:00:00.000Z",
      });

      await initialManager.apply(threadId);
    } finally {
      await initialManager.close();
    }

    const changedRuleManager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
      naming: {
        customPrompt: "Always prefix a workspace-heavy Chinese tag.",
      },
    });

    try {
      const preview = await changedRuleManager.previewRequeueRenamesSince({
        since: "2026-04-04T00:00:00.000Z",
        basis: "session-updated-at",
      });

      const detail = await changedRuleManager.getSessionDetail(threadId);
      expect(detail?.lastAppliedRuleSignature).toBeTruthy();
      expect(preview.currentRuleSignature).not.toBe(detail?.lastAppliedRuleSignature);
      expect(preview.queued).toBe(1);
      expect(preview.skipped).toBe(0);
      expect(preview.items).toEqual([
        expect.objectContaining({
          threadId,
          ruleStatus: "outdated",
          action: "queue",
          reason: "rule_mismatch",
        }),
      ]);

      const replay = await changedRuleManager.requeueRenamesSince({
        since: "2026-04-04T00:00:00.000Z",
        basis: "session-updated-at",
      });

      expect(replay.queued).toBe(1);
      expect(replay.skipped).toBe(0);
      expect(replay.matchedThreadIds).toEqual([threadId]);

      const queuedDetail = await changedRuleManager.getSessionDetail(threadId);
      const renameState = changedRuleManager.db.getRenameState(threadId);
      expect(queuedDetail?.dirty).toBe(true);
      expect(renameState?.forceRewrite).toBe(true);
      expect(queuedDetail?.candidateName).toBeUndefined();
    } finally {
      await changedRuleManager.close();
    }
  });
});
