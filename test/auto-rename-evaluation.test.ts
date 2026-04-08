import { describe, expect, it } from "vitest";

import { buildConfigForTests, evaluateAutoRename } from "@codexnamer/core";
import type { RenameStateRecord, SessionDetail } from "@codexnamer/shared";

function makeDetail(overrides?: Partial<SessionDetail>): SessionDetail {
  return {
    threadId: "thread-eval",
    rolloutPath: "/tmp/rollout.jsonl",
    workspaceId: "/tmp/project-alpha",
    workspaceLabel: "project-alpha",
    updatedAt: "2026-04-04T12:00:00.000Z",
    officialName: "旧名字",
    candidateName: undefined,
    dirty: true,
    frozen: false,
    taskCompleteCount: 2,
    provider: "OpenAI",
    model: "gpt-5.4",
    statusEstimate: "active",
    createdAt: "2026-04-04T11:00:00.000Z",
    firstUserMessage: "先实现自动 rename",
    lastUserMessage: "补上 transcript context",
    lastAgentMessage: "已经完成基础重构",
    tokenTotal: 1234,
    revision: "rev-1",
    lastAppliedAt: undefined,
    lastAppliedRevision: undefined,
    renameHistory: [],
    transcript: undefined,
    ...overrides
  };
}

function makeRenameState(overrides?: Partial<RenameStateRecord>): RenameStateRecord {
  return {
    threadId: "thread-eval",
    dirtySinceRename: true,
    frozen: false,
    autoApplyCount: 0,
    ...overrides
  };
}

describe("auto rename evaluation", () => {
  it("returns suggest for candidate-ready dirty sessions", () => {
    const config = buildConfigForTests({
      watch: {
        scanIntervalSeconds: 300,
        candidateIdleSeconds: 60,
        finalizeIdleSeconds: 300,
        renameCooldownSeconds: 900,
        minRolloutGrowthBytes: 4096,
        minTaskCompleteDelta: 1,
        maxAutoRenamesPerSession: 2
      }
    });

    const evaluation = evaluateAutoRename(makeDetail(), config, {
      now: new Date("2026-04-04T12:02:30.000Z"),
      renameState: makeRenameState()
    });

    expect(evaluation.statusEstimate).toBe("candidate_ready");
    expect(evaluation.action).toBe("suggest");
    expect(evaluation.reason).toBe("candidate_ready");
  });

  it("returns apply for finalize-ready sessions that pass guards", () => {
    const config = buildConfigForTests({
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

    const evaluation = evaluateAutoRename(makeDetail(), config, {
      now: new Date("2026-04-04T12:10:00.000Z"),
      renameState: makeRenameState()
    });

    expect(evaluation.statusEstimate).toBe("finalize_ready");
    expect(evaluation.action).toBe("apply");
    expect(evaluation.reason).toBe("finalize_ready");
  });

  it("returns guard reasons before apply when cooldown or freeze is active", () => {
    const config = buildConfigForTests({
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

    const cooldownEvaluation = evaluateAutoRename(makeDetail(), config, {
      now: new Date("2026-04-04T12:10:00.000Z"),
      renameState: makeRenameState({
        lastAutoApplySuccessAt: "2026-04-04T11:30:00.000Z"
      })
    });
    expect(cooldownEvaluation.action).toBe("skip");
    expect(cooldownEvaluation.reason).toBe("rename_cooldown");

    const frozenEvaluation = evaluateAutoRename(makeDetail({ frozen: true }), config, {
      now: new Date("2026-04-04T12:10:00.000Z"),
      renameState: makeRenameState()
    });
    expect(frozenEvaluation.action).toBe("skip");
    expect(frozenEvaluation.reason).toBe("frozen");
  });
});
