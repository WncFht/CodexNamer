import os from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildConfigForTests, buildRenamePrompt, suggestNameHeuristically } from "@codexnamer/core";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("naming specificity", () => {
  it("builds a more specific heuristic summary from settings and rename logic topics", () => {
    const config = buildConfigForTests({
      naming: {
        template: "{{kind}}{{scope_paren}}: {{summary}}",
        maxLength: 80,
        language: "zh-CN"
      }
    });

    const suggestion = suggestNameHeuristically(
      {
        threadId: "t-settings",
        rolloutPath: "/tmp/r.jsonl",
        cwd: "/tmp/codexnamer",
        projectName: "codexnamer",
        taskCompleteCount: 0,
        tokenTotal: 0,
        firstUserMessage:
          "web 我尝试 config 修改，但是 save setting 以后直接给我重置了，没有重新加载，仍然是英文。",
        lastUserMessage:
          "现在好像我都 settting 不了，你仔细看看为什么，为什么我不能配置了。讲讲现在这个是什么逻辑，有没有启动自动 rename。",
        lastAgentMessage: "我会先复现设置页保存，再解释自动 rename 当前是不是只做 preview。"
      },
      config
    );

    expect(suggestion.kind).toBe("fix");
    expect(suggestion.scope).toBe("settings");
    expect(suggestion.summary).toContain("设置");
    expect(suggestion.summary).toContain("自动重命名逻辑");
    expect(suggestion.summary).toContain("聚焦");
    expect(suggestion.name).toContain("fix");
    expect(suggestion.tagId).toBeUndefined();
  });

  it("asks AI for specific names with expanded kind options", () => {
    const config = buildConfigForTests({
      naming: {
        language: "zh-CN"
      }
    });

    const prompt = buildRenamePrompt(
      {
        threadId: "t-prompt",
        rolloutPath: "/tmp/r.jsonl",
        cwd: "/tmp/project",
        projectName: "project",
        taskCompleteCount: 2,
        tokenTotal: 123,
        firstUserMessage: "帮我把自动 rename 的名字变得更具体一点",
        lastUserMessage: "希望保留主子系统和实际动作，不要太泛",
        lastAgentMessage: "我会先升级 heuristic，再同步 prompt。"
      },
      config
    );

    expect(prompt).toContain("Make the rename concrete");
    expect(prompt).toContain("namingCompositionMode: structured");
    expect(prompt).toContain("## Naming builder");
    expect(prompt).toContain("1. tag");
    expect(prompt).toContain('2. separator " · "');
    expect(prompt).toContain("## Tag presets");
    expect(prompt).toContain("```conversation");
    expect(prompt).toContain("Return only a JSON object with keys: name, kind, summary, scope, tagId.");
    expect(prompt).toContain("set tagId to the matching preset id");
    expect(prompt).toContain("Allowed kind values: feat, fix, debug, refactor, docs, research, review, design, migration, test, chore, ops.");
  });

  it("switches prompt instruction language with the UI language", () => {
    const config = buildConfigForTests({
      general: {
        uiLanguage: "zh-CN"
      },
      naming: {
        language: "zh-CN"
      }
    });

    const prompt = buildRenamePrompt(
      {
        threadId: "t-zh-prompt",
        rolloutPath: "/tmp/r.jsonl",
        cwd: "/tmp/project",
        projectName: "project",
        taskCompleteCount: 1,
        tokenTotal: 64,
        firstUserMessage: "把自动 rename 的标题做得更具体一些",
        lastUserMessage: "顺便把 builder 和 prompt 放到设置页里",
        lastAgentMessage: "我会先调整核心 builder，再同步 Web 设置页。"
      },
      config
    );

    expect(prompt).toContain("你要为 CodexNamer 生成一个用于会话列表的命名建议。");
    expect(prompt).toContain("Prompt 语言：中文。");
    expect(prompt).toContain("## 命名构建器");
    expect(prompt).toContain("## Tag 预设");
  });

  it("includes a custom prompt override when prompt-override mode is enabled", () => {
    const config = buildConfigForTests({
      naming: {
        compositionMode: "prompt-override",
        customPrompt: "Always prefer a domain tag first, then produce a concrete Chinese title."
      }
    });

    const prompt = buildRenamePrompt(
      {
        threadId: "t-override",
        rolloutPath: "/tmp/r.jsonl",
        cwd: "/tmp/project",
        projectName: "project",
        taskCompleteCount: 1,
        tokenTotal: 88,
        firstUserMessage: "把 rename 做成可以加 tag 的样子",
        lastUserMessage: "同时允许 prompt override",
        lastAgentMessage: "我会把配置和 prompt 一起接上。"
      },
      config
    );

    expect(prompt).toContain("namingCompositionMode: prompt-override");
    expect(prompt).toContain("Custom naming override:");
    expect(prompt).toContain("Always prefer a domain tag first");
  });

  it("does not hardcode a user home directory name as scope", () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/tester");

    const config = buildConfigForTests({
      naming: {
        template: "{{kind}}{{scope_paren}}: {{summary}}",
        maxLength: 80,
        language: "en"
      }
    });

    const suggestion = suggestNameHeuristically(
      {
        threadId: "t-home",
        rolloutPath: "/tmp/r.jsonl",
        cwd: "/home/tester",
        projectName: "tester",
        taskCompleteCount: 0,
        tokenTotal: 0,
        firstUserMessage: "check why the local launch script keeps restarting",
        lastUserMessage: "make sure the rename does not use my username as project scope",
        lastAgentMessage: "I will remove the user-specific fallback and keep the title generic."
      },
      config
    );

    expect(suggestion.scope).not.toBe("tester");
    expect(suggestion.name).not.toContain("(tester)");
  });
});
