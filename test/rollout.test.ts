import fs from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { buildSessionRevision } from "../packages/core/src/revision.js";
import { ingestRolloutFile } from "../packages/core/src/rollout.js";
import { createManagerForTest, createTempWorkspace, writeRolloutFixture } from "./helpers.js";

describe("rollout ingest", () => {
  test("reads token usage from event_msg token_count payloads", async () => {
    const temp = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: temp.codexHome,
      stateDir: temp.stateDir
    });

    try {
      const rolloutPath = await writeRolloutFixture({
        codexHome: temp.codexHome,
        threadId: "thread-token-event",
        userMessage: "看看 token 统计为什么是空的",
        lastAgentMessage: "我来修 token_count 解析。",
        tokenEventStyle: "event-msg"
      });
      const stat = await fs.stat(rolloutPath);
      const initial = await ingestRolloutFile({
        rolloutPath,
        stat
      });

      expect(initial.session?.tokenTotal).toBe(1234);

      const staleSession = {
        ...initial.session!,
        tokenTotal: 0
      };
      const revision = buildSessionRevision(
        staleSession,
        {
          sizeBytes: stat.size,
          mtime: stat.mtime.toISOString()
        },
        undefined
      );

      manager.db.upsertSession({
        session: staleSession,
        revision,
        cursor: {
          rolloutPath,
          lastOffset: stat.size,
          lastSize: stat.size,
          lastMtime: stat.mtime.toISOString(),
          lastScanAt: new Date().toISOString()
        }
      });

      await manager.scan();
      const detail = await manager.getSessionDetail("thread-token-event");
      expect(detail?.tokenTotal).toBe(1234);
    } finally {
      await manager.close();
    }
  });
});
