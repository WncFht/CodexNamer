import { describe, expect, it } from "vitest";

import { buildConfigForTests, buildRenamePrompt, suggestNameHeuristically } from "@codex-session-manager/core";

describe("naming specificity", () => {
  it("builds a more specific heuristic summary from settings and rename logic topics", () => {
    const config = buildConfigForTests({
      naming: {
        template: "{{kind}}{{scope_paren}}: {{summary}}",
        maxLength: 80,
        language: "zh-CN",
        defaultStyle: "detailed"
      }
    });

    const suggestion = suggestNameHeuristically(
      {
        threadId: "t-settings",
        rolloutPath: "/tmp/r.jsonl",
        cwd: "/tmp/codex-session-manager",
        projectName: "codex-session-manager",
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
    expect(suggestion.style).toBe("detailed");
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
        language: "zh-CN",
        defaultStyle: "detailed"
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
    expect(prompt).toContain("Preferred naming style: detailed");
    expect(prompt).toContain("namingStyle: detailed");
    expect(prompt).toContain("namingCompositionMode: structured");
    expect(prompt).toContain("namingComponents: tag, kind, summary");
    expect(prompt).toContain("Structured naming tags:");
    expect(prompt).toContain("Return only a JSON object with keys: name, kind, summary, scope, tagId.");
    expect(prompt).toContain("set tagId to the matching preset id");
    expect(prompt).toContain("Allowed kind values: feat, fix, debug, refactor, docs, research, review, design, migration, test, chore, ops.");
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

  it("keeps brief style names shorter than detailed ones", () => {
    const detailedConfig = buildConfigForTests({
      naming: {
        template: "{{kind}}{{scope_paren}}: {{summary}}",
        maxLength: 80,
        language: "zh-CN",
        defaultStyle: "detailed"
      }
    });
    const briefConfig = buildConfigForTests({
      naming: {
        template: "{{kind}}{{scope_paren}}: {{summary}}",
        maxLength: 80,
        language: "zh-CN",
        defaultStyle: "brief"
      }
    });
    const session = {
      threadId: "t-style",
      rolloutPath: "/tmp/r.jsonl",
      cwd: "/tmp/project",
      projectName: "project",
      taskCompleteCount: 0,
      tokenTotal: 0,
      firstUserMessage: "把设置页里的 inherit-codex 和中文切换修好",
      lastUserMessage: "顺便把 rename style 版本切换和历史展示也接起来",
      lastAgentMessage: "我会先拆 style state，再补 history 和 web 操作。"
    };

    const detailed = suggestNameHeuristically(session, detailedConfig);
    const brief = suggestNameHeuristically(session, briefConfig);

    expect(detailed.style).toBe("detailed");
    expect(brief.style).toBe("brief");
    expect(detailed.name.length).toBeGreaterThanOrEqual(brief.name.length);
  });
});
