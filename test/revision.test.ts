import { describe, expect, it } from "vitest";

import { buildSessionRevision, isDirtySinceRename } from "@codexnamer/core";

describe("revision and dirty tracking", () => {
  it("changes revision when last agent message changes", () => {
    const base = {
      threadId: "t1",
      rolloutPath: "/tmp/rollout.jsonl",
      cwd: "/tmp/project",
      taskCompleteCount: 1,
      tokenTotal: 100,
      firstUserMessage: "Implement rename",
      lastUserMessage: "Implement rename",
      lastAgentMessage: "Initial result"
    };

    const first = buildSessionRevision(base, { sizeBytes: 100, mtime: "2026-04-04T00:00:00Z" });
    const second = buildSessionRevision(
      {
        ...base,
        lastAgentMessage: "Updated result"
      },
      { sizeBytes: 120, mtime: "2026-04-04T00:10:00Z" },
      first
    );

    expect(first.currentRevision).not.toBe(second.currentRevision);
    expect(isDirtySinceRename(second.currentRevision, first.currentRevision)).toBe(true);
    expect(isDirtySinceRename(first.currentRevision, first.currentRevision)).toBe(false);
  });
});

