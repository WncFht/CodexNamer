import { describe, expect, it } from "vitest";

import type { SessionTranscript } from "@codex-session-manager/shared";
import { buildConfigForTests, buildRenameContext } from "@codex-session-manager/core";

describe("rename context", () => {
  it("builds summary-signals context from first and last messages", () => {
    const base = buildConfigForTests();
    const config = buildConfigForTests({
      naming: {
        ...base.naming,
        contextStrategy: "summary-signals",
        contextMaxChars: 512
      }
    });

    const context = buildRenameContext(
      {
        threadId: "thread-summary",
        rolloutPath: "/tmp/rollout.jsonl",
        projectName: "project-alpha",
        firstUserMessage: "先把自动 rename 的评估逻辑梳理清楚",
        lastUserMessage: "再补 context 构建和文档",
        lastAgentMessage: "已经完成 evaluateAutoRename 和 buildRenameContext",
        taskCompleteCount: 1,
        tokenTotal: 100
      },
      config
    );

    expect(context.requestedStrategy).toBe("summary-signals");
    expect(context.strategy).toBe("summary-signals");
    expect(context.fallbackReason).toBeUndefined();
    expect(context.text).toContain("user(first): 先把自动 rename 的评估逻辑梳理清楚");
    expect(context.text).toContain("user(last): 再补 context 构建和文档");
    expect(context.text).toContain("assistant(last): 已经完成 evaluateAutoRename 和 buildRenameContext");
  });

  it("builds transcript context from visible user and assistant messages only", () => {
    const base = buildConfigForTests();
    const config = buildConfigForTests({
      naming: {
        ...base.naming,
        contextStrategy: "user-assistant-transcript",
        contextMaxChars: 140
      }
    });

    const transcript: SessionTranscript = {
      items: [
        {
          id: "1",
          role: "system",
          kind: "message",
          content: "AGENTS.md instructions",
          hidden: true,
          hiddenReason: "bootstrap_context"
        },
        {
          id: "2",
          role: "user",
          kind: "message",
          content: "最初目标是把 rename 的规则和上下文都单独抽出来"
        },
        {
          id: "3",
          role: "assistant",
          kind: "message",
          content: "先把当前 manager 里的判断链路理出来"
        },
        {
          id: "4",
          role: "tool",
          kind: "tool_call",
          content: "rg --files"
        },
        {
          id: "5",
          role: "assistant",
          kind: "reasoning",
          content: "隐藏推理",
          hidden: true,
          hiddenReason: "reasoning"
        },
        {
          id: "6",
          role: "user",
          kind: "message",
          content: "后面改成 transcript strategy 时，工具输出不要混进去"
        },
        {
          id: "7",
          role: "assistant",
          kind: "message",
          content: "已经接上 transcript context，并且过滤掉 tool call 和 bootstrap"
        }
      ],
      counts: {
        total: 7,
        visible: 4,
        hidden: 2,
        tools: 1
      }
    };

    const context = buildRenameContext(
      {
        threadId: "thread-transcript",
        rolloutPath: "/tmp/rollout.jsonl",
        projectName: "project-alpha",
        firstUserMessage: "最初目标是把 rename 的规则和上下文都单独抽出来",
        lastUserMessage: "后面改成 transcript strategy 时，工具输出不要混进去",
        lastAgentMessage: "已经接上 transcript context，并且过滤掉 tool call 和 bootstrap",
        taskCompleteCount: 2,
        tokenTotal: 200
      },
      config,
      {
        transcript
      }
    );

    expect(context.requestedStrategy).toBe("user-assistant-transcript");
    expect(context.strategy).toBe("user-assistant-transcript");
    expect(context.segments.some((segment) => segment.source === "transcript_seed")).toBe(true);
    expect(context.text).toContain("user(goal): 最初目标是把 rename 的规则和上下文都单独抽出来");
    expect(context.text).not.toContain("AGENTS.md instructions");
    expect(context.text).not.toContain("rg --files");
    expect(context.text).not.toContain("隐藏推理");
    expect(context.truncated).toBe(true);
  });

  it("falls back to summary-signals when transcript strategy lacks transcript data", () => {
    const base = buildConfigForTests();
    const config = buildConfigForTests({
      naming: {
        ...base.naming,
        contextStrategy: "user-assistant-transcript",
        contextMaxChars: 512
      }
    });

    const context = buildRenameContext(
      {
        threadId: "thread-fallback",
        rolloutPath: "/tmp/rollout.jsonl",
        projectName: "project-alpha",
        firstUserMessage: "先做一个 fallback",
        lastUserMessage: "缺 transcript 时回退到 summary-signals",
        lastAgentMessage: "已经回退",
        taskCompleteCount: 1,
        tokenTotal: 100
      },
      config
    );

    expect(context.requestedStrategy).toBe("user-assistant-transcript");
    expect(context.strategy).toBe("summary-signals");
    expect(context.fallbackReason).toBe("missing_transcript");
  });
});
