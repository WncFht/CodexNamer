import { buildConfigForTests, buildRenameContext } from "@codexnamer/core";

import type { SessionTranscript } from "@codexnamer/shared";
import { describe, expect, it } from "vitest";

describe("rename context", () => {
  it("builds summary-signals context from first and last messages", () => {
    const base = buildConfigForTests();
    const config = buildConfigForTests({
      naming: {
        ...base.naming,
        contextStrategy: "summary-signals",
        contextMaxChars: 512,
      },
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
        tokenTotal: 100,
      },
      config,
    );

    expect(context.requestedStrategy).toBe("summary-signals");
    expect(context.strategy).toBe("summary-signals");
    expect(context.fallbackReason).toBeUndefined();
    expect(context.text).toContain("user(first): 先把自动 rename 的评估逻辑梳理清楚");
    expect(context.text).toContain("user(last): 再补 context 构建和文档");
    expect(context.text).toContain(
      "assistant(last): 已经完成 evaluateAutoRename 和 buildRenameContext",
    );
  });

  it("builds transcript context from visible user and assistant messages only", () => {
    const base = buildConfigForTests();
    const config = buildConfigForTests({
      naming: {
        ...base.naming,
        contextStrategy: "user-assistant-transcript",
        contextMaxChars: 140,
      },
    });

    const transcript: SessionTranscript = {
      items: [
        {
          id: "1",
          role: "system",
          kind: "message",
          content: "AGENTS.md instructions",
          hidden: true,
          hiddenReason: "bootstrap_context",
        },
        {
          id: "2",
          role: "user",
          kind: "message",
          content: "最初目标是把 rename 的规则和上下文都单独抽出来",
        },
        {
          id: "3",
          role: "assistant",
          kind: "message",
          content: "先把当前 manager 里的判断链路理出来",
        },
        {
          id: "4",
          role: "tool",
          kind: "tool_call",
          content: "rg --files",
        },
        {
          id: "5",
          role: "assistant",
          kind: "reasoning",
          content: "隐藏推理",
          hidden: true,
          hiddenReason: "reasoning",
        },
        {
          id: "6",
          role: "user",
          kind: "message",
          content: "后面改成 transcript strategy 时，工具输出不要混进去",
        },
        {
          id: "7",
          role: "assistant",
          kind: "message",
          content: "已经接上 transcript context，并且过滤掉 tool call 和 bootstrap",
        },
      ],
      counts: {
        total: 7,
        visible: 4,
        hidden: 2,
        tools: 1,
      },
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
        tokenTotal: 200,
      },
      config,
      {
        transcript,
      },
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
        contextMaxChars: 512,
      },
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
        tokenTotal: 100,
      },
      config,
    );

    expect(context.requestedStrategy).toBe("user-assistant-transcript");
    expect(context.strategy).toBe("summary-signals");
    expect(context.fallbackReason).toBe("missing_transcript");
  });

  it("can build context from user messages only", () => {
    const base = buildConfigForTests();
    const config = buildConfigForTests({
      naming: {
        ...base.naming,
        contextStrategy: "user-only-transcript",
        contextMaxChars: 180,
      },
    });

    const transcript: SessionTranscript = {
      items: [
        { id: "1", role: "user", kind: "message", content: "先把设置页里的命名模式整理成下拉" },
        {
          id: "2",
          role: "assistant",
          kind: "message",
          content: "我会先改 SettingsPanel 和 provider prompt",
        },
        { id: "3", role: "user", kind: "message", content: "再把 context 策略扩成几种可选模式" },
        { id: "4", role: "assistant", kind: "message", content: "最后补测试和文档" },
      ],
      counts: {
        total: 4,
        visible: 4,
        hidden: 0,
        tools: 0,
      },
    };

    const context = buildRenameContext(
      {
        threadId: "thread-user-only",
        rolloutPath: "/tmp/rollout.jsonl",
        firstUserMessage: "先把设置页里的命名模式整理成下拉",
        lastUserMessage: "再把 context 策略扩成几种可选模式",
        lastAgentMessage: "最后补测试和文档",
        taskCompleteCount: 1,
        tokenTotal: 100,
      },
      config,
      { transcript },
    );

    expect(context.requestedStrategy).toBe("user-only-transcript");
    expect(context.strategy).toBe("user-only-transcript");
    expect(context.text).toContain("user(goal): 先把设置页里的命名模式整理成下拉");
    expect(context.text).toContain("user: 再把 context 策略扩成几种可选模式");
    expect(context.text).not.toContain("assistant:");
  });

  it("can append the last assistant summary after user transcript", () => {
    const base = buildConfigForTests();
    const config = buildConfigForTests({
      naming: {
        ...base.naming,
        contextStrategy: "user-transcript-last-assistant",
        contextMaxChars: 220,
      },
    });

    const transcript: SessionTranscript = {
      items: [
        { id: "1", role: "user", kind: "message", content: "我要把 prompt 里的兼容层彻底去掉" },
        {
          id: "2",
          role: "assistant",
          kind: "message",
          content: "先改 provider.ts，再重启 live API",
        },
        { id: "3", role: "user", kind: "message", content: "然后把 context 选项扩成更细粒度" },
      ],
      counts: {
        total: 3,
        visible: 3,
        hidden: 0,
        tools: 0,
      },
    };

    const context = buildRenameContext(
      {
        threadId: "thread-user-plus-last-assistant",
        rolloutPath: "/tmp/rollout.jsonl",
        firstUserMessage: "我要把 prompt 里的兼容层彻底去掉",
        lastUserMessage: "然后把 context 选项扩成更细粒度",
        lastAgentMessage: "先改 provider.ts，再重启 live API",
        taskCompleteCount: 1,
        tokenTotal: 100,
      },
      config,
      { transcript },
    );

    expect(context.requestedStrategy).toBe("user-transcript-last-assistant");
    expect(context.strategy).toBe("user-transcript-last-assistant");
    expect(context.text).toContain("user(goal): 我要把 prompt 里的兼容层彻底去掉");
    expect(context.text).toContain("user: 然后把 context 选项扩成更细粒度");
    expect(context.text).toContain("assistant(last): 先改 provider.ts，再重启 live API");
  });

  it("pairs each user turn with the last substantive assistant from the preceding cluster", () => {
    const base = buildConfigForTests();
    const config = buildConfigForTests({
      naming: {
        ...base.naming,
        contextStrategy: "paired-user-turns",
        contextMaxChars: 320,
      },
    });

    const transcript: SessionTranscript = {
      items: [
        { id: "1", role: "user", kind: "message", content: "先修 save button 的 dirty 判断" },
        {
          id: "2",
          role: "assistant",
          kind: "message",
          content: "我先检查 SettingsPanel 里的 draft 同步。",
        },
        {
          id: "3",
          role: "assistant",
          kind: "message",
          content: "已经定位到 baseline 对比会让 Save 状态误判，问题在 encoded config key。",
        },
        { id: "4", role: "assistant", kind: "message", content: "我现在开始改。" },
        {
          id: "5",
          role: "user",
          kind: "message",
          content: "然后把 context 也扩成 paired strategy",
        },
        { id: "6", role: "assistant", kind: "message", content: "先补 rename-context。" },
        { id: "7", role: "user", kind: "message", content: "最后补一个对比实验报告" },
      ],
      counts: {
        total: 7,
        visible: 7,
        hidden: 0,
        tools: 0,
      },
    };

    const context = buildRenameContext(
      {
        threadId: "thread-paired-turns",
        rolloutPath: "/tmp/rollout.jsonl",
        firstUserMessage: "先修 save button 的 dirty 判断",
        lastUserMessage: "最后补一个对比实验报告",
        lastAgentMessage: "先补 rename-context。",
        taskCompleteCount: 2,
        tokenTotal: 220,
      },
      config,
      { transcript },
    );

    expect(context.requestedStrategy).toBe("paired-user-turns");
    expect(context.strategy).toBe("paired-user-turns");
    expect(context.text).toContain("user(goal): 先修 save button 的 dirty 判断");
    expect(context.text).toContain(
      "assistant(context): 已经定位到 baseline 对比会让 Save 状态误判",
    );
    expect(context.text).toContain("user(turn): 然后把 context 也扩成 paired strategy");
    expect(context.text).toContain("user(turn): 最后补一个对比实验报告");
    expect(context.text).not.toContain("我现在开始改");
    expect(context.text).not.toContain("先补 rename-context");
  });
});
