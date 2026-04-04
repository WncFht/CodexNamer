import { describe, expect, it } from "vitest";

import { buildSessionRevision } from "@codex-session-manager/core";

import { createManagerForTest, createTempWorkspace, writeRolloutFixture } from "./helpers.js";

describe("auto rename preview guards", () => {
  it("skips finalize-ready sessions when rename cooldown is active", async () => {
    const workspace = await createTempWorkspace();
    const threadId = "019d-preview-cooldown";
    const rolloutPath = await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId,
      userMessage: "实现 provider test 命令",
      lastAgentMessage: "已经补上 provider test 和 config print",
      updatedAt: "2026-04-04T12:00:00.000Z"
    });

    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
      watch: {
        scanIntervalSeconds: 300,
        candidateIdleSeconds: 60,
        finalizeIdleSeconds: 120,
        renameCooldownSeconds: 3600,
        minRolloutGrowthBytes: 4096,
        minTaskCompleteDelta: 1,
        maxAutoRenamesPerSession: 2
      }
    });

    try {
      await manager.scan();
      const session = manager.db.getSessionByRolloutPath(rolloutPath);
      expect(session).toBeDefined();
      const revision = buildSessionRevision(
        session!,
        {
          sizeBytes: 123,
          mtime: "2026-04-04T12:00:00.000Z"
        },
        undefined
      );

      manager.db.recordRename({
        threadId,
        newName: "old auto name",
        source: "ai",
        kind: "auto",
        status: "applied",
        appliedAt: new Date().toISOString(),
        appliedRevision: revision.currentRevision,
        autoApply: true,
        operator: "test"
      });

      manager.db.upsertSession({
        session: {
          ...session!,
          lastUserMessage: "实现 provider test 命令并补充自动 rename 冷却逻辑",
          updatedAt: "2026-04-04T12:00:00.000Z"
        },
        revision: buildSessionRevision(
          {
            ...session!,
            lastUserMessage: "实现 provider test 命令并补充自动 rename 冷却逻辑",
            updatedAt: "2026-04-04T12:00:00.000Z"
          },
          {
            sizeBytes: 256,
            mtime: "2026-04-04T12:00:00.000Z"
          },
          revision
        ),
        cursor: {
          rolloutPath,
          lastOffset: 256,
          lastSize: 256,
          lastMtime: "2026-04-04T12:00:00.000Z",
          lastScanAt: "2026-04-04T12:00:00.000Z"
        }
      });

      const previews = await manager.previewAutoRename();
      expect(previews.find((item) => item.threadId === threadId)?.reason).toBe("rename_cooldown");
    } finally {
      await manager.close();
    }
  });

  it("skips finalize-ready sessions after reaching max auto renames", async () => {
    const workspace = await createTempWorkspace();
    const threadId = "019d-preview-max";
    const rolloutPath = await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId,
      userMessage: "实现 freeze 命令",
      lastAgentMessage: "已经补上 freeze 和 manual override",
      updatedAt: "2026-04-04T12:00:00.000Z"
    });

    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
      watch: {
        scanIntervalSeconds: 300,
        candidateIdleSeconds: 60,
        finalizeIdleSeconds: 120,
        renameCooldownSeconds: 0,
        minRolloutGrowthBytes: 4096,
        minTaskCompleteDelta: 1,
        maxAutoRenamesPerSession: 1
      }
    });

    try {
      await manager.scan();
      const session = manager.db.getSessionByRolloutPath(rolloutPath);
      expect(session).toBeDefined();
      const revision = buildSessionRevision(
        session!,
        {
          sizeBytes: 123,
          mtime: "2026-04-04T12:00:00.000Z"
        },
        undefined
      );

      manager.db.recordRename({
        threadId,
        newName: "first auto name",
        source: "ai",
        kind: "auto",
        status: "applied",
        appliedAt: "2026-04-04T10:00:00.000Z",
        appliedRevision: revision.currentRevision,
        autoApply: true,
        operator: "test"
      });

      manager.db.upsertSession({
        session: {
          ...session!,
          lastUserMessage: "实现 freeze 命令并补充后续 pipeline 审查",
          updatedAt: "2026-04-04T12:00:00.000Z"
        },
        revision: buildSessionRevision(
          {
            ...session!,
            lastUserMessage: "实现 freeze 命令并补充后续 pipeline 审查",
            updatedAt: "2026-04-04T12:00:00.000Z"
          },
          {
            sizeBytes: 256,
            mtime: "2026-04-04T12:00:00.000Z"
          },
          revision
        ),
        cursor: {
          rolloutPath,
          lastOffset: 256,
          lastSize: 256,
          lastMtime: "2026-04-04T12:00:00.000Z",
          lastScanAt: "2026-04-04T12:00:00.000Z"
        }
      });

      const previews = await manager.previewAutoRename();
      expect(previews.find((item) => item.threadId === threadId)?.reason).toBe(
        "max_auto_renames_reached"
      );
    } finally {
      await manager.close();
    }
  });
});
