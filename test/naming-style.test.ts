import { describe, expect, it } from "vitest";

import { createManagerForTest, createTempWorkspace, writeRolloutFixture } from "./helpers.js";

describe("naming style versions", () => {
  it("stores preferred style and keeps style-specific history even when the name text is unchanged", async () => {
    const workspace = await createTempWorkspace();
    const threadId = "019d-style-history";
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir
    });

    try {
      await writeRolloutFixture({
        codexHome: workspace.codexHome,
        threadId,
        userMessage: "把 rename 风格做成详细和简略两个版本",
        lastAgentMessage: "已经把 per-session 风格和命名历史接起来"
      });
      await manager.scan();

      const briefSelection = await manager.setNamingStyle(threadId, "brief");
      expect(briefSelection.preferredStyle).toBe("brief");
      expect(briefSelection.effectiveStyle).toBe("brief");

      await manager.rename(threadId, "Shared manual title");

      const detailedSelection = await manager.setNamingStyle(threadId, "detailed");
      expect(detailedSelection.preferredStyle).toBe("detailed");
      expect(detailedSelection.effectiveStyle).toBe("detailed");

      const secondRename = await manager.rename(threadId, "Shared manual title");
      expect(secondRename.written).toBe(false);

      const detail = await manager.getSessionDetail(threadId);
      expect(detail?.officialName).toBe("Shared manual title");
      expect(detail?.preferredNamingStyle).toBe("detailed");
      expect(detail?.effectiveNamingStyle).toBe("detailed");
      expect(detail?.officialNamingStyle).toBe("detailed");
      expect(detail?.renameHistory?.some((entry) => entry.style === "brief" && entry.status === "applied")).toBe(true);
      expect(detail?.renameHistory?.some((entry) => entry.style === "detailed" && entry.status === "skipped")).toBe(true);
    } finally {
      await manager.close();
    }
  });

  it("clears stale candidate names when the session naming style changes", async () => {
    const workspace = await createTempWorkspace();
    const threadId = "019d-style-candidate";
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir
    });

    try {
      await writeRolloutFixture({
        codexHome: workspace.codexHome,
        threadId,
        userMessage: "给当前会话切换成详细版本",
        lastAgentMessage: "已经加了 per-session 风格切换"
      });
      await manager.scan();

      manager.db.saveCandidate(threadId, {
        name: "brief candidate",
        source: "ai",
        style: "brief",
        generatedAt: "2026-04-06T00:00:00.000Z"
      });

      await manager.setNamingStyle(threadId, "detailed");

      const detail = await manager.getSessionDetail(threadId);
      expect(detail?.preferredNamingStyle).toBe("detailed");
      expect(detail?.candidateName).toBeUndefined();
    } finally {
      await manager.close();
    }
  });
});
