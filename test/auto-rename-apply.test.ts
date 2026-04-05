import { describe, expect, it } from "vitest";

import { createManagerForTest, createTempWorkspace, writeRolloutFixture } from "./helpers.js";

describe("auto rename apply", () => {
  it("reports preview-only until a daemon sweep heartbeat is recorded", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
      rename: {
        mode: "hybrid",
        autoApply: "idle-finalize",
        manualOverrideWins: true,
        freezeManualName: true
      }
    });

    try {
      const overview = await manager.overview();
      expect(overview.runtime.actualExecution).toBe("preview-only");
      expect(overview.runtime.daemonAutoApply).toBe(false);
      expect(overview.runtime.daemonStatus).toBe("not_seen");
      expect(overview.runtime.lastSweepSummary).toBeUndefined();
    } finally {
      await manager.close();
    }
  });

  it("does not treat preview-only API polling as a daemon heartbeat", async () => {
    const workspace = await createTempWorkspace();
    const threadId = "019d-preview-no-heartbeat";
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
      rename: {
        mode: "hybrid",
        autoApply: "idle-finalize",
        manualOverrideWins: true,
        freezeManualName: true
      }
    });

    try {
      await writeRolloutFixture({
        codexHome: workspace.codexHome,
        threadId,
        userMessage: "只预览自动重命名，不记录 daemon 心跳",
        lastAgentMessage: "已经补上 preview 队列接口",
        updatedAt: "2026-04-04T12:00:00.000Z"
      });

      const preview = await manager.previewAutoRename();
      expect(preview.some((item) => item.threadId === threadId)).toBe(true);

      const overview = await manager.overview();
      expect(overview.runtime.daemonStatus).toBe("not_seen");
      expect(overview.runtime.lastSweepSummary).toBeUndefined();
    } finally {
      await manager.close();
    }
  });

  it("auto applies finalize-ready sessions when idle-finalize is enabled", async () => {
    const workspace = await createTempWorkspace();
    const threadId = "019d-auto-apply-on";
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
      rename: {
        mode: "hybrid",
        autoApply: "idle-finalize",
        manualOverrideWins: true,
        freezeManualName: true
      },
      watch: {
        scanIntervalSeconds: 300,
        candidateIdleSeconds: 60,
        finalizeIdleSeconds: 120,
        renameCooldownSeconds: 900,
        minRolloutGrowthBytes: 4096,
        minTaskCompleteDelta: 1,
        maxAutoRenamesPerSession: 2
      }
    });

    try {
      await writeRolloutFixture({
        codexHome: workspace.codexHome,
        threadId,
        userMessage: "修复 settings 页并把 daemon auto apply 接上",
        lastAgentMessage: "已经把 Web 配置表单和 daemon 执行链对齐",
        updatedAt: "2026-04-04T12:00:00.000Z"
      });

      const sweep = await manager.runAutoRenameSweep();
      expect(sweep.previews.find((item) => item.threadId === threadId)?.status).toBe("apply");
      expect(sweep.applied).toHaveLength(1);
      expect(sweep.applied[0]?.written).toBe(true);
      expect(sweep.applied[0]?.name).toBeTruthy();

      const detail = await manager.getSessionDetail(threadId);
      expect(detail?.dirty).toBe(false);

      const renameState = manager.db.getRenameState(threadId);
      expect(renameState?.autoApplyCount).toBe(1);
      expect(renameState?.lastAutoApplySuccessAt).toBeDefined();

      const overview = await manager.overview();
      expect(overview.runtime.actualExecution).toBe("auto-apply");
      expect(overview.runtime.daemonAutoApply).toBe(true);
      expect(overview.runtime.daemonStatus).toBe("running");
      expect(overview.runtime.lastSweepSummary?.autoApplied).toBe(1);
    } finally {
      await manager.close();
    }
  });

  it("keeps finalize-ready sessions in preview-only mode when auto apply is disabled", async () => {
    const workspace = await createTempWorkspace();
    const threadId = "019d-auto-apply-off";
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
      rename: {
        mode: "hybrid",
        autoApply: "disabled",
        manualOverrideWins: true,
        freezeManualName: true
      },
      watch: {
        scanIntervalSeconds: 300,
        candidateIdleSeconds: 60,
        finalizeIdleSeconds: 120,
        renameCooldownSeconds: 900,
        minRolloutGrowthBytes: 4096,
        minTaskCompleteDelta: 1,
        maxAutoRenamesPerSession: 2
      }
    });

    try {
      await writeRolloutFixture({
        codexHome: workspace.codexHome,
        threadId,
        userMessage: "只做 auto rename preview，不自动落盘",
        lastAgentMessage: "已经把 preview 队列和 runtime 面板接好了",
        updatedAt: "2026-04-04T12:00:00.000Z"
      });

      const sweep = await manager.runAutoRenameSweep();
      expect(sweep.previews.find((item) => item.threadId === threadId)?.status).toBe("apply");
      expect(sweep.applied).toHaveLength(0);

      const detail = await manager.getSessionDetail(threadId);
      expect(detail?.dirty).toBe(true);

      const overview = await manager.overview();
      expect(overview.runtime.actualExecution).toBe("preview-only");
      expect(overview.runtime.daemonAutoApply).toBe(false);
      expect(overview.runtime.daemonStatus).toBe("running");
      expect(overview.runtime.lastSweepSummary?.execution).toBe("preview-only");
    } finally {
      await manager.close();
    }
  });
});
