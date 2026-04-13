import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CodexNamer } from "@codexnamer/core";
import { afterEach, describe, expect, it } from "vitest";
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
      stateDir: workspace.stateDir,
    });
    cleanup.push(async () => manager.close());

    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-api-1",
      userMessage: "实现 local api",
      lastAgentMessage: "已经补上 health 和 sessions 路由",
    });
    await manager.scan();

    const app = await buildApiServer({ manager, operator: "api-test" });
    cleanup.push(async () => {
      await app.close();
    });

    const health = await app.inject({
      method: "GET",
      url: "/api/v1/health",
    });
    expect(health.statusCode).toBe(200);
    expect(health.json().ok).toBe(true);

    const sessions = await app.inject({
      method: "GET",
      url: "/api/v1/sessions",
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
      stateDir: workspace.stateDir,
    });
    cleanup.push(async () => manager.close());

    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-api-2",
      userMessage: "实现 provider test",
      lastAgentMessage: "已经补上 provider diagnostics",
    });
    await manager.scan();

    const app = await buildApiServer({ manager, operator: "api-test" });
    cleanup.push(async () => {
      await app.close();
    });

    const suggest = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/019d-api-2/suggest",
    });
    expect(suggest.statusCode).toBe(200);
    expect(suggest.json().threadId).toBe("019d-api-2");
    expect(suggest.json().source).toBe("ai");

    const apply = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/019d-api-2/apply",
    });
    expect(apply.statusCode).toBe(200);
    expect(apply.json().written).toBe(true);
    expect(apply.json().name).toContain("019d-api-2");

    const replayPreview = await app.inject({
      method: "POST",
      url: "/api/v1/maintenance/requeue-preview",
      payload: {
        since: "2026-04-01T00:00:00.000Z",
        basis: "session-updated-at",
      },
    });
    expect(replayPreview.statusCode).toBe(200);
    expect(replayPreview.json().queued).toBe(0);
    expect(replayPreview.json().skipped).toBeGreaterThanOrEqual(1);
    expect(
      replayPreview
        .json()
        .items.find((item: { threadId: string }) => item.threadId === "019d-api-2")?.reason,
    ).toBe("already_latest_rule");

    const providerTest = await app.inject({
      method: "POST",
      url: "/api/v1/providers/test",
    });
    expect(providerTest.statusCode).toBe(200);
    expect(providerTest.json().diagnostics.configuredBackend).toBe("none");

    const config = await app.inject({
      method: "GET",
      url: "/api/v1/config",
    });
    expect(config.statusCode).toBe(200);
    expect(config.json().effectiveConfig.general.codexHome).toBe(workspace.codexHome);

    const configUpdate = await app.inject({
      method: "PUT",
      url: "/api/v1/config",
      payload: {
        userConfig: {
          naming: {
            customPrompt: "Always prefix a workspace-heavy Chinese tag.",
          },
        },
      },
    });
    expect(configUpdate.statusCode).toBe(200);

    const doctor = await app.inject({
      method: "GET",
      url: "/api/v1/doctor",
    });
    expect(doctor.statusCode).toBe(200);
    expect(doctor.json().provider).toBeDefined();

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/overview",
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().sessions.total).toBeGreaterThanOrEqual(1);
    expect(overview.json().runtime.daemonStatus).toBe("not_seen");
    expect(overview.json().workload.averageTitleLength).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(overview.json().replay.recentRuns)).toBe(true);

    const logId = manager.db.startAiRequestLog({
      threadId: "019d-api-2",
      projectName: "project-alpha",
      backend: "openai-compatible",
      transport: "responses",
      startedAt: "2026-04-04T12:00:00.000Z",
      baseUrl: "http://example.test/v1",
      model: "gpt-test",
      promptChars: 128,
    });
    manager.db.finishAiRequestLog({
      id: logId,
      status: "succeeded",
      finishedAt: "2026-04-04T12:00:01.000Z",
      durationMs: 1000,
      responseChars: 64,
      result: {
        composition: {
          mode: "structured",
          builder: [],
          finalName: "project-alpha / api log final name",
        },
      },
    });

    const requestLogs = await app.inject({
      method: "GET",
      url: "/api/v1/ai/request-logs?limit=10",
    });
    expect(requestLogs.statusCode).toBe(200);
    expect(requestLogs.json().activeCount).toBe(0);
    expect(requestLogs.json().items[0].threadId).toBe("019d-api-2");
    expect(requestLogs.json().items[0].status).toBe("succeeded");
    expect(requestLogs.json().items[0].finalName).toBe("project-alpha / api log final name");

    const requestLogDetail = await app.inject({
      method: "GET",
      url: `/api/v1/ai/request-logs/${logId}`,
    });
    expect(requestLogDetail.statusCode).toBe(200);
    expect(requestLogDetail.json().finalName).toBe("project-alpha / api log final name");

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/maintenance/requeue-renames",
      payload: {
        since: "2026-04-01T00:00:00.000Z",
        basis: "session-updated-at",
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().queued).toBeGreaterThanOrEqual(1);
    expect(replay.json().skipped).toBeGreaterThanOrEqual(0);

    const overviewAfterReplay = await app.inject({
      method: "GET",
      url: "/api/v1/overview",
    });
    expect(overviewAfterReplay.statusCode).toBe(200);
    expect(overviewAfterReplay.json().replay.recentRuns[0].basis).toBe("session-updated-at");
    expect(overviewAfterReplay.json().replay.recentRuns[0].queued).toBeGreaterThanOrEqual(1);
    expect(overviewAfterReplay.json().ruleCoverage.currentSignature).toBeTruthy();

    const freeze = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/019d-api-2/freeze",
    });
    expect(freeze.statusCode).toBe(200);
    expect(freeze.json().frozen).toBe(true);
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
        maxAutoRenamesPerSession: 2,
      },
    });
    cleanup.push(async () => manager.close());

    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-api-filter-1",
      userMessage: "实现 web 页面",
      lastAgentMessage: "已经补上 sessions 页面",
      updatedAt: candidateReadyAt,
    });
    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-api-filter-2",
      userMessage: "实现 tui 页面",
      lastAgentMessage: "已经补上 tui 页面",
      cwd: "/tmp/project-beta",
    });
    await manager.scan();
    await manager.freeze("019d-api-filter-2");

    const app = await buildApiServer({ manager, operator: "api-test" });
    cleanup.push(async () => {
      await app.close();
    });

    const filtered = await app.inject({
      method: "GET",
      url: "/api/v1/sessions?search=web&frozen=false&workspace=project-alpha",
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().items).toHaveLength(1);
    expect(filtered.json().items[0].threadId).toBe("019d-api-filter-1");
    expect(filtered.json().workspaces).toHaveLength(2);

    const limited = await app.inject({
      method: "GET",
      url: "/api/v1/sessions?limit=1",
    });
    expect(limited.statusCode).toBe(200);
    expect(limited.json().items).toHaveLength(1);
    expect(limited.json().total).toBe(2);

    const invalidLimit = await app.inject({
      method: "GET",
      url: "/api/v1/sessions?limit=0",
    });
    expect(invalidLimit.statusCode).toBe(400);

    const preview = await app.inject({
      method: "GET",
      url: "/api/v1/auto-rename/preview",
    });
    expect(preview.statusCode).toBe(200);
    expect(Array.isArray(preview.json().items)).toBe(true);
    expect(
      preview
        .json()
        .items.find((item: { threadId: string }) => item.threadId === "019d-api-filter-1")?.status,
    ).toBe("suggest");

    const promptPreview = await app.inject({
      method: "GET",
      url: "/api/v1/ai/prompt-preview?threadId=019d-api-filter-1",
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
            uiLanguage: "zh-CN",
          },
          naming: {
            contextStrategy: "paired-user-turns",
          },
        },
      },
    });
    expect(overriddenPromptPreview.statusCode).toBe(200);
    expect(overriddenPromptPreview.json().renameContext.requestedStrategy).toBe(
      "paired-user-turns",
    );
    expect(overriddenPromptPreview.json().renameContext.strategy).toBe("paired-user-turns");
    expect(overriddenPromptPreview.json().prompt).toContain(
      "你要为 CodexNamer 生成一个用于会话列表的命名建议",
    );
  });

  it("returns paginated session transcript details", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
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
        workdir: "/tmp/project-alpha",
      },
      toolCallOutput: "Working copy clean",
    });
    await manager.scan();

    const app = await buildApiServer({ manager, operator: "api-test" });
    cleanup.push(async () => {
      await app.close();
    });

    const detail = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/019d-api-transcript-1",
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().transcript).toBeUndefined();

    const transcript = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/019d-api-transcript-1/transcript?page=1&pageSize=2",
    });
    expect(transcript.statusCode).toBe(200);
    expect(
      transcript
        .json()
        .items.some((item: { role: string }) => item.role === "assistant" || item.role === "tool"),
    ).toBe(true);
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
        'provider_source = "codex-config"',
        'profile = "default"',
      ].join("\n"),
      "utf8",
    );

    const manager = await CodexNamer.create({
      cwd: workspace.root,
      configPath,
      operator: "api-test",
    });
    cleanup.push(async () => manager.close());

    await writeRolloutFixture({
      codexHome: workspace.codexHome,
      threadId: "019d-api-config-1",
      userMessage: "实现 config writeback",
      lastAgentMessage: "已经补上 config 接口",
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
          uiLanguage: "zh-CN",
        },
        naming: {
          maxLength: 48,
          template: "{{summary}}",
          contextStrategy: "user-assistant-transcript",
          contextMaxChars: 4096,
          compositionMode: "prompt-override",
          builder: [
            { type: "component", component: "tag" },
            { type: "separator", value: " / " },
            { type: "component", component: "summary" },
          ],
          tags: [
            {
              id: "settings",
              label: "设置",
              description: "配置和保存问题",
              promptHint: "config settings save",
            },
          ],
          customPrompt: "Always output a Chinese classification tag first.",
        },
        watch: {
          candidateIdleSeconds: 33,
        },
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().config.effectiveConfig.general.uiLanguage).toBe("zh-CN");
    expect(update.json().config.effectiveConfig.naming.maxLength).toBe(48);
    expect(update.json().config.effectiveConfig.naming.contextStrategy).toBe(
      "user-assistant-transcript",
    );
    expect(update.json().config.effectiveConfig.naming.contextMaxChars).toBe(4096);
    expect(update.json().config.effectiveConfig.naming.compositionMode).toBe("prompt-override");
    expect(update.json().config.effectiveConfig.naming.builder).toEqual([
      { type: "component", component: "tag" },
      { type: "separator", value: " / " },
      { type: "component", component: "summary" },
    ]);
    expect(update.json().config.effectiveConfig.naming.tags[0].id).toBe("settings");
    expect(update.json().config.effectiveConfig.naming.customPrompt).toBe(
      "Always output a Chinese classification tag first.",
    );
    expect(update.json().config.effectiveConfig.watch.candidateIdleSeconds).toBe(33);

    const events = await app.inject({
      method: "GET",
      url: "/api/v1/events/since?cursor=0",
    });
    expect(events.statusCode).toBe(200);
    expect(
      events.json().items.some((item: { type: string }) => item.type === "config.updated"),
    ).toBe(true);

    const written = await fs.readFile(configPath, "utf8");
    expect(written).toContain('ui_language = "zh-CN"');
    expect(written).toContain("max_length = 48");
    expect(written).toContain('context_strategy = "user-assistant-transcript"');
    expect(written).toContain("context_max_chars = 4_096");
    expect(written).toContain('composition_mode = "prompt-override"');
    expect(written).toContain("[[naming.builder]]");
    expect(written).toContain('component = "tag"');
    expect(written).toContain('value = " / "');
    expect(written).toContain(
      'custom_prompt = "Always output a Chinese classification tag first."',
    );
    expect(written).toContain("candidate_idle_seconds = 33");
  });

  it("serves built web assets and SPA fallback when configured", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
    });
    cleanup.push(async () => manager.close());

    const webRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codexnamer-web-"));
    cleanup.push(async () => {
      await fs.rm(webRoot, { recursive: true, force: true });
    });
    await fs.mkdir(path.join(webRoot, "assets"), { recursive: true });
    await fs.writeFile(
      path.join(webRoot, "index.html"),
      '<!doctype html><html><body><div id="root">CodexNamer Web Shell</div></body></html>',
      "utf8",
    );
    await fs.writeFile(
      path.join(webRoot, "assets", "app.js"),
      "console.log('codexnamer');",
      "utf8",
    );

    const app = await buildApiServer({
      manager,
      operator: "api-test",
      staticWebRoot: webRoot,
    });
    cleanup.push(async () => {
      await app.close();
    });

    const root = await app.inject({
      method: "GET",
      url: "/",
    });
    expect(root.statusCode).toBe(200);
    expect(root.headers["content-type"]).toContain("text/html");
    expect(root.body).toContain("CodexNamer Web Shell");

    const asset = await app.inject({
      method: "GET",
      url: "/assets/app.js",
    });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain("codexnamer");

    const deepLink = await app.inject({
      method: "GET",
      url: "/daemon/runtime",
    });
    expect(deepLink.statusCode).toBe(200);
    expect(deepLink.headers["content-type"]).toContain("text/html");
    expect(deepLink.body).toContain("CodexNamer Web Shell");

    const missingApiRoute = await app.inject({
      method: "GET",
      url: "/api/v1/does-not-exist",
    });
    expect(missingApiRoute.statusCode).toBe(404);
  });
});
