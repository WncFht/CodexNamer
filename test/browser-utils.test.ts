import { describe, expect, test } from "vitest";

import {
  groupSessionsByTime,
  sessionDisplayTitle,
  sessionListSubtitle,
  sessionListTitle
} from "../packages/web/src/browser-utils.js";

describe("browser-utils", () => {
  test("groups sessions by recency buckets", () => {
    const now = new Date();
    const today = new Date(now);
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const lastWeek = new Date(now);
    lastWeek.setUTCDate(lastWeek.getUTCDate() - 4);
    const lastMonth = new Date(now);
    lastMonth.setUTCDate(lastMonth.getUTCDate() - 12);

    const groups = groupSessionsByTime([
      {
        threadId: "today",
        updatedAt: today.toISOString(),
        workspaceId: "w",
        workspaceLabel: "w",
        dirty: true,
        frozen: false,
        taskCompleteCount: 1
      },
      {
        threadId: "yesterday",
        updatedAt: yesterday.toISOString(),
        workspaceId: "w",
        workspaceLabel: "w",
        dirty: true,
        frozen: false,
        taskCompleteCount: 1
      },
      {
        threadId: "week",
        updatedAt: lastWeek.toISOString(),
        workspaceId: "w",
        workspaceLabel: "w",
        dirty: true,
        frozen: false,
        taskCompleteCount: 1
      },
      {
        threadId: "month",
        updatedAt: lastMonth.toISOString(),
        workspaceId: "w",
        workspaceLabel: "w",
        dirty: true,
        frozen: false,
        taskCompleteCount: 1
      }
    ]);

    expect(groups.map((item) => item.label)).toEqual(["Today", "Yesterday", "This Week", "This Month"]);
  });

  test("prefers official name over candidate and id", () => {
    expect(
      sessionDisplayTitle({
        threadId: "abc",
        officialName: "Official",
        candidateName: "Candidate",
        workspaceId: "w",
        workspaceLabel: "w",
        dirty: false,
        frozen: false,
        taskCompleteCount: 0
      })
    ).toBe("Official");
  });

  test("prefers the first user message in the session list while keeping the rename in subtitle", () => {
    const session = {
      threadId: "abc",
      firstUserMessage: "修复 settings 保存后被重置的问题",
      officialName: "fix(settings): persist ui language",
      candidateName: "Candidate",
      workspaceId: "w",
      workspaceLabel: "w",
      dirty: false,
      frozen: false,
      taskCompleteCount: 0
    };

    expect(sessionListTitle(session)).toBe("修复 settings 保存后被重置的问题");
    expect(sessionListSubtitle(session)).toBe("fix(settings): persist ui language");
  });
});
