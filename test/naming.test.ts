import { describe, expect, it } from "vitest";

import { buildConfigForTests, buildRenamePrompt, suggestNameHeuristically } from "@codex-session-manager/core";

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
    expect(suggestion.scope).toBe("settings");
    expect(suggestion.summary).toContain("设置");
    expect(suggestion.summary).toContain("自动重命名逻辑");
    expect(suggestion.name).toContain("fix(settings):");
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
    expect(prompt).toContain("Allowed kind values: feat, fix, debug, refactor, docs, research, review, design, migration, test, chore, ops.");
  });
});
