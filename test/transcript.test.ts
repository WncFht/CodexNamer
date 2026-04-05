import { describe, expect, it } from "vitest";

import { readRenameTranscriptContext, readSessionTranscript, readSessionTranscriptPage } from "@codex-session-manager/core";

import { createTempWorkspace, writeRolloutFixture } from "./helpers.js";

describe("session transcript", () => {
  it("extracts user, assistant, and tool events from rollout files", async () => {
    const workspace = await createTempWorkspace();
    const rolloutPath = await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-transcript-1",
      userMessage: "把 workspace 和 transcript 都做上",
      lastAgentMessage: "已经把 workspace 分组和 transcript 详情都做上",
      toolCallName: "shell_command",
      toolCallArguments: {
        command: "rg --files",
        workdir: "/tmp/project-alpha"
      },
      toolCallOutput: "README.md\nsrc/index.ts"
    });

    const transcript = await readSessionTranscript(rolloutPath);
    expect(transcript.counts.total).toBeGreaterThanOrEqual(4);
    expect(transcript.items.some((item) => item.role === "user" && item.content.includes("workspace"))).toBe(true);
    expect(transcript.items.some((item) => item.role === "assistant" && item.content.includes("workspace 分组"))).toBe(true);
    expect(transcript.items.some((item) => item.kind === "tool_call" && item.content.includes("rg --files"))).toBe(true);
    expect(transcript.items.some((item) => item.kind === "tool_output" && item.content.includes("README.md"))).toBe(true);
  });

  it("supports history-style transcript pagination", async () => {
    const workspace = await createTempWorkspace();
    const rolloutPath = await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-transcript-page-1",
      userMessage: "第一页 transcript",
      lastAgentMessage: "第二页 transcript",
      toolCallName: "shell_command",
      toolCallArguments: {
        command: "pwd",
        workdir: "/tmp/project-alpha"
      },
      toolCallOutput: "/tmp/project-alpha"
    });

    const latestPage = await readSessionTranscriptPage({
      rolloutPath,
      page: 1,
      pageSize: 2
    });
    expect(latestPage.items).toHaveLength(2);
    expect(latestPage.totalPages).toBeGreaterThanOrEqual(2);

    const olderPage = await readSessionTranscriptPage({
      rolloutPath,
      page: 2,
      pageSize: 2
    });
    expect(olderPage.items[0]?.role).toBe("user");
  });

  it("builds rename context from user and assistant messages only", async () => {
    const workspace = await createTempWorkspace();
    const rolloutPath = await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-transcript-rename-1",
      userMessage: "把 user 和 assistant 的内容拼起来重命名",
      lastAgentMessage: "已整理 transcript，并排除 tool 调用",
      toolCallName: "shell_command",
      toolCallArguments: {
        command: "rg --files",
        workdir: "/tmp/project-alpha"
      },
      toolCallOutput: "README.md\nsrc/index.ts"
    });

    const context = await readRenameTranscriptContext({
      rolloutPath,
      strategy: "user-assistant-transcript",
      maxChars: 1200
    });

    expect(context.userMessagesText).toContain("user 和 assistant");
    expect(context.assistantMessagesText).toContain("排除 tool 调用");
    expect(context.contextText).toContain("User:");
    expect(context.contextText).toContain("Assistant:");
    expect(context.contextText).not.toContain("rg --files");
    expect(context.contextText).not.toContain("README.md");
  });
});
