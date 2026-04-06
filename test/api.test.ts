import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CodexSessionManager } from "@codex-session-manager/core";
import { buildApiServer } from "../packages/api/src/app.ts";

import { createManagerForTest, createTempWorkspace, writeRolloutFixture } from "./helpers.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    const action = cleanup.pop();
    if (action) {
      await action();
    }
  }
});

describe("local api", () => {
  it("serves health and sessions endpoints", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir
    });
    cleanup.push(async () => manager.close());

    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-api-1",
      userMessage: "实现 local api",
      lastAgentMessage: "已经补上 health 和 sessions 路由"
    });
    await manager.scan();

    const app = await buildApiServer({ manager, operator: "api-test" });
    cleanup.push(async () => {
      await app.close();
    });

    const health = await app.inject({
      method: "GET",
      url: "/api/v1/health"
    });
    expect(health.statusCode).toBe(200);
    expect(health.json().ok).toBe(true);

    const sessions = await app.inject({
      method: "GET",
      url: "/api/v1/sessions"
    });
    expect(sessions.statusCode).toBe(200);
    const payload = sessions.json();
    expect(payload.total).toBeGreaterThanOrEqual(1);
    expect(payload.items[0]?.threadId).toBe("019d-api-1");
    expect(payload.workspaces).toHaveLength(1);
    expect(payload.workspaces[0]?.workspacePath).toBe("/tmp/project-alpha");
  });

  it("supports session actions and config/provider endpoints", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir
    });
    cleanup.push(async () => manager.close());

    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-api-2",
      userMessage: "实现 provider test",
      lastAgentMessage: "已经补上 provider diagnostics"
    });
    await manager.scan();

    const app = await buildApiServer({ manager, operator: "api-test" });
    cleanup.push(async () => {
      await app.close();
    });

    const suggest = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/019d-api-2/suggest"
    });
    expect(suggest.statusCode).toBe(200);
    expect(suggest.json().threadId).toBe("019d-api-2");
    expect(suggest.json().style).toBe("detailed");

    const namingStyle = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/019d-api-2/naming-style",
      payload: {
        style: "brief"
      }
    });
    expect(namingStyle.statusCode).toBe(200);
    expect(namingStyle.json().preferredStyle).toBe("brief");
    expect(namingStyle.json().effectiveStyle).toBe("brief");

    const freeze = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/019d-api-2/freeze"
    });
    expect(freeze.statusCode).toBe(200);
    expect(freeze.json().frozen).toBe(true);

    const providerTest = await app.inject({
      method: "POST",
      url: "/api/v1/providers/test"
    });
    expect(providerTest.statusCode).toBe(200);
    expect(providerTest.json().diagnostics.configuredBackend).toBe("none");

    const config = await app.inject({
      method: "GET",
      url: "/api/v1/config"
    });
    expect(config.statusCode).toBe(200);
    expect(config.json().effectiveConfig.general.codexHome).toBe(workspace.codexHome);

    const doctor = await app.inject({
      method: "GET",
      url: "/api/v1/doctor"
    });
    expect(doctor.statusCode).toBe(200);
    expect(doctor.json().provider).toBeDefined();

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/overview"
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().sessions.total).toBeGreaterThanOrEqual(1);
    expect(overview.json().runtime.daemonStatus).toBe("not_seen");
    expect(overview.json().workload.averageTitleLength).toBeGreaterThanOrEqual(0);

    const logId = manager.db.startAiRequestLog({
      threadId: "019d-api-2",
      projectName: "project-alpha",
      backend: "openai-compatible",
      transport: "responses",
      startedAt: "2026-04-04T12:00:00.000Z",
      baseUrl: "http://example.test/v1",
      model: "gpt-test",
      promptChars: 128
    });
    manager.db.finishAiRequestLog({
      id: logId,
      status: "succeeded",
      finishedAt: "2026-04-04T12:00:01.000Z",
      durationMs: 1000,
      responseChars: 64
    });

    const requestLogs = await app.inject({
      method: "GET",
      url: "/api/v1/ai/request-logs?limit=10"
    });
    expect(requestLogs.statusCode).toBe(200);
    expect(requestLogs.json().activeCount).toBe(0);
    expect(requestLogs.json().items[0].threadId).toBe("019d-api-2");
    expect(requestLogs.json().items[0].status).toBe("succeeded");
  });

  it("supports session filters and auto-rename preview endpoint", async () => {
    const workspace = await createTempWorkspace();
    const candidateReadyAt = new Date(Date.now() - 3 * 60_000).toISOString();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
      watch: {
        scanIntervalSeconds: 300,
        candidateIdleSeconds: 60,
        finalizeIdleSeconds: 600,
        renameCooldownSeconds: 900,
        minRolloutGrowthBytes: 4096,
        minTaskCompleteDelta: 1,
        maxAutoRenamesPerSession: 2
      }
    });
    cleanup.push(async () => manager.close());

    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-api-filter-1",
      userMessage: "实现 web 页面",
      lastAgentMessage: "已经补上 sessions 页面",
      updatedAt: candidateReadyAt
    });
    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-api-filter-2",
      userMessage: "实现 tui 页面",
      lastAgentMessage: "已经补上 tui 页面",
      cwd: "/tmp/project-beta"
    });
    await manager.scan();
    await manager.freeze("019d-api-filter-2");

    const app = await buildApiServer({ manager, operator: "api-test" });
    cleanup.push(async () => {
      await app.close();
    });

    const filtered = await app.inject({
      method: "GET",
      url: "/api/v1/sessions?search=web&frozen=false&workspace=project-alpha"
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().items).toHaveLength(1);
    expect(filtered.json().items[0].threadId).toBe("019d-api-filter-1");
    expect(filtered.json().workspaces).toHaveLength(2);

    const preview = await app.inject({
      method: "GET",
      url: "/api/v1/auto-rename/preview"
    });
    expect(preview.statusCode).toBe(200);
    expect(Array.isArray(preview.json().items)).toBe(true);
    expect(preview.json().items.find((item: { threadId: string }) => item.threadId === "019d-api-filter-1")?.status).toBe("suggest");

    const promptPreview = await app.inject({
      method: "GET",
      url: "/api/v1/ai/prompt-preview?threadId=019d-api-filter-1"
    });
    expect(promptPreview.statusCode).toBe(200);
    expect(promptPreview.json().threadId).toBe("019d-api-filter-1");
    expect(promptPreview.json().prompt).toContain("实现 web 页面");
    expect(promptPreview.json().renameContext.strategy).toBeDefined();

    const overriddenPromptPreview = await app.inject({
      method: "POST",
      url: "/api/v1/ai/prompt-preview",
      payload: {
        threadId: "019d-api-filter-1",
        userConfig: {
          general: {
            uiLanguage: "zh-CN"
          },
          naming: {
            contextStrategy: "paired-user-turns"
          }
        }
      }
    });
    expect(overriddenPromptPreview.statusCode).toBe(200);
    expect(overriddenPromptPreview.json().renameContext.requestedStrategy).toBe("paired-user-turns");
    expect(overriddenPromptPreview.json().renameContext.strategy).toBe("paired-user-turns");
    expect(overriddenPromptPreview.json().prompt).toContain("你要为 Codex Session Manager 生成一个用于会话列表的命名建议");
  });

  it("returns paginated session transcript details", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir
    });
    cleanup.push(async () => manager.close());

    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-api-transcript-1",
      userMessage: "把 transcript 浏览做出来",
      lastAgentMessage: "已经把 transcript 和 workspace sidebar 做出来",
      toolCallName: "shell_command",
      toolCallArguments: {
        command: "jj st",
        workdir: "/tmp/project-alpha"
      },
      toolCallOutput: "Working copy clean"
    });
    await manager.scan();

    const app = await buildApiServer({ manager, operator: "api-test" });
    cleanup.push(async () => {
      await app.close();
    });

    const detail = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/019d-api-transcript-1"
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().transcript).toBeUndefined();

    const transcript = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/019d-api-transcript-1/transcript?page=1&pageSize=2"
    });
    expect(transcript.statusCode).toBe(200);
    expect(transcript.json().items.some((item: { role: string }) => item.role === "assistant" || item.role === "tool")).toBe(true);
    expect(transcript.json().totalPages).toBeGreaterThanOrEqual(2);
  });

  it("supports config writeback and event polling", async () => {
    const workspace = await createTempWorkspace();
    const configPath = path.join(workspace.root, "config.toml");
    await fs.writeFile(
      configPath,
      [
        "[general]",
        `codex_home = "${workspace.codexHome}"`,
        `state_dir = "${workspace.stateDir}"`,
        "",
        "[ai]",
        'backend = "none"',
        'provider_source = "inherit-codex"',
        'profile = "default"'
      ].join("\n"),
      "utf8"
    );

    const manager = await CodexSessionManager.create({
      cwd: workspace.root,
      configPath,
      operator: "api-test"
    });
    cleanup.push(async () => manager.close());

    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-api-config-1",
      userMessage: "实现 config writeback",
      lastAgentMessage: "已经补上 config 接口"
    });
    await manager.scan();

    const app = await buildApiServer({ manager, operator: "api-test" });
    cleanup.push(async () => {
      await app.close();
    });

    const update = await app.inject({
      method: "PUT",
      url: "/api/v1/config",
      payload: {
        general: {
          uiLanguage: "zh-CN"
        },
        naming: {
          maxLength: 48,
          defaultStyle: "brief",
          template: "{{summary}}",
          contextStrategy: "user-assistant-transcript",
          contextMaxChars: 4096,
          compositionMode: "prompt-override",
          components: ["tag", "summary"],
          componentSeparator: " / ",
          tags: [
            {
              id: "settings",
              label: "设置",
              description: "配置和保存问题",
              promptHint: "config settings save"
            }
          ],
          customPrompt: "Always output a Chinese classification tag first."
        },
        watch: {
          candidateIdleSeconds: 33
        }
      }
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().config.effectiveConfig.general.uiLanguage).toBe("zh-CN");
    expect(update.json().config.effectiveConfig.naming.maxLength).toBe(48);
    expect(update.json().config.effectiveConfig.naming.defaultStyle).toBe("brief");
    expect(update.json().config.effectiveConfig.naming.contextStrategy).toBe("user-assistant-transcript");
    expect(update.json().config.effectiveConfig.naming.contextMaxChars).toBe(4096);
    expect(update.json().config.effectiveConfig.naming.compositionMode).toBe("prompt-override");
    expect(update.json().config.effectiveConfig.naming.components).toEqual(["tag", "summary"]);
    expect(update.json().config.effectiveConfig.naming.componentSeparator).toBe(" / ");
    expect(update.json().config.effectiveConfig.naming.tags[0].id).toBe("settings");
    expect(update.json().config.effectiveConfig.naming.customPrompt).toBe(
      "Always output a Chinese classification tag first."
    );
    expect(update.json().config.effectiveConfig.watch.candidateIdleSeconds).toBe(33);

    const events = await app.inject({
      method: "GET",
      url: "/api/v1/events/since?cursor=0"
    });
    expect(events.statusCode).toBe(200);
    expect(events.json().items.some((item: { type: string }) => item.type === "config.updated")).toBe(true);

    const written = await fs.readFile(configPath, "utf8");
    expect(written).toContain('ui_language = "zh-CN"');
    expect(written).toContain('max_length = 48');
    expect(written).toContain('default_style = "brief"');
    expect(written).toContain('context_strategy = "user-assistant-transcript"');
    expect(written).toContain("context_max_chars = 4_096");
    expect(written).toContain('composition_mode = "prompt-override"');
    expect(written).toContain('components = [ "tag", "summary" ]');
    expect(written).toContain('component_separator = " / "');
    expect(written).toContain('custom_prompt = "Always output a Chinese classification tag first."');
    expect(written).toContain('candidate_idle_seconds = 33');
  });
});
