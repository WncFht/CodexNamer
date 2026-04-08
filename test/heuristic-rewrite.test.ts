import { describe, expect, it } from "vitest";

import { createManagerForTest, createTempWorkspace, writeRolloutFixture } from "./helpers.js";

describe("heuristic names are treated as pending AI rewrite", () => {
  it("hides heuristic-applied names from official named state when AI is enabled", async () => {
    const workspace = await createTempWorkspace();
    const threadId = "019d-heuristic-rewrite";
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
      ai: {
        backend: "responses",
        providerSource: "codex-config",
        profile: "default",
        timeoutSeconds: 45,
        temperature: 0.2
      }
    });

    try {
      await writeRolloutFixture({
        codexHome: workspace.codexHome,
        threadId,
        userMessage: "把旧 heuristic 命名改成 AI 正式命名",
        lastAgentMessage: "已经确认 heuristic 名字后续要重新交给 AI",
        updatedAt: "2026-04-04T12:00:00.000Z"
      });
      await manager.scan();

      const rawDetail = manager.db.getSessionDetail(threadId);
      expect(rawDetail?.revision).toBeDefined();
      manager.db.recordRename({
        threadId,
        newName: "0405 fix(settings): 旧 heuristic 名字",
        source: "heuristic",
        kind: "auto",
        status: "applied",
        appliedAt: "2026-04-04T12:00:00.000Z",
        appliedRevision: rawDetail?.revision,
        autoApply: false,
        operator: "test"
      });

      const sessions = await manager.listSessions();
      const session = sessions.find((item) => item.threadId === threadId);
      expect(session?.officialName).toBeUndefined();
      expect(session?.dirty).toBe(true);

      const detail = await manager.getSessionDetail(threadId);
      expect(detail?.officialName).toBeUndefined();
      expect(detail?.dirty).toBe(true);
      expect(detail?.renameHistory).toHaveLength(0);

      const preview = await manager.previewAutoRename();
      expect(preview.find((item) => item.threadId === threadId)?.status).toBe("apply");

      const overview = await manager.overview();
      expect(overview.sessions.named).toBe(0);
      expect(overview.renameHistory.applied).toBe(0);
      expect(overview.renameHistory.aiApplied).toBe(0);
      expect(overview.renameHistory.manualApplied).toBe(0);
    } finally {
      await manager.close();
    }
  });
});
