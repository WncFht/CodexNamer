import { describe, expect, it } from "vitest";

import { createManagerForTest, createTempWorkspace, writeRolloutFixture } from "./helpers.js";

describe("rename name collision handling", () => {
  it("deduplicates manual rename targets before writing", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir
    });

    try {
      await writeRolloutFixture({
        codexHome: workspace.codexHome,
        threadId: "dup-manual-1",
        userMessage: "第一个会话",
        lastAgentMessage: "第一个会话已完成"
      });
      await writeRolloutFixture({
        codexHome: workspace.codexHome,
        threadId: "dup-manual-2",
        userMessage: "第二个会话",
        lastAgentMessage: "第二个会话已完成"
      });

      const first = await manager.rename("dup-manual-1", "Shared title");
      const second = await manager.rename("dup-manual-2", "Shared title");

      expect(first.name).toBe("Shared title");
      expect(second.name).toBe("Shared title (2)");
    } finally {
      await manager.close();
    }
  });

  it("deduplicates applied candidate names against existing official names", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir
    });

    try {
      await writeRolloutFixture({
        codexHome: workspace.codexHome,
        threadId: "dup-apply-1",
        userMessage: "先占用一个正式名字",
        lastAgentMessage: "这个会话先写入正式名字"
      });
      await writeRolloutFixture({
        codexHome: workspace.codexHome,
        threadId: "dup-apply-2",
        userMessage: "后面的会话尝试应用同名候选",
        lastAgentMessage: "这个会话会复用同一个候选名"
      });

      await manager.rename("dup-apply-1", "Shared title");
      await manager.scan();
      manager.db.saveCandidate("dup-apply-2", {
        name: "Shared title",
        source: "ai",
        style: "detailed",
        generatedAt: "2026-04-04T12:10:00.000Z"
      });

      const result = await manager.apply("dup-apply-2");
      expect(result.name).toBe("Shared title (2)");

      const detail = await manager.getSessionDetail("dup-apply-2");
      expect(detail?.officialName).toBe("Shared title (2)");
    } finally {
      await manager.close();
    }
  });

  it("treats later duplicate official names as pending rewrite", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
      ai: {
        backend: "codex",
        providerSource: "inherit-codex",
        profile: "default",
        timeoutSeconds: 45,
        temperature: 0.2
      }
    });

    try {
      await writeRolloutFixture({
        codexHome: workspace.codexHome,
        threadId: "dup-existing-1",
        userMessage: "先出现的正式名",
        lastAgentMessage: "第一个会话先拿到正式标题"
      });
      await writeRolloutFixture({
        codexHome: workspace.codexHome,
        threadId: "dup-existing-2",
        userMessage: "后出现的正式名",
        lastAgentMessage: "第二个会话错误地拿到了同名标题"
      });

      await manager.scan();
      manager.db.recordRename({
        threadId: "dup-existing-1",
        newName: "Shared title",
        source: "manual",
        kind: "manual",
        style: "detailed",
        status: "applied",
        operator: "test",
        appliedAt: "2026-04-04T12:00:00.000Z",
        manualOverride: true,
        autoApply: false
      });
      manager.db.recordRename({
        threadId: "dup-existing-2",
        newName: "Shared title",
        source: "manual",
        kind: "manual",
        style: "detailed",
        status: "applied",
        operator: "test",
        appliedAt: "2026-04-04T12:00:01.000Z",
        manualOverride: true,
        autoApply: false
      });

      const sessions = await manager.listSessions();
      const first = sessions.find((item) => item.threadId === "dup-existing-1");
      const second = sessions.find((item) => item.threadId === "dup-existing-2");

      expect(first?.officialName).toBe("Shared title");
      expect(first?.dirty).toBe(false);
      expect(second?.officialName).toBeUndefined();
      expect(second?.dirty).toBe(true);
    } finally {
      await manager.close();
    }
  });
});
