import {
  buildConfigForTests,
  buildRenameContext,
  buildRenamePrompt,
  createRenameInferenceService,
  OpenAICompatibleRenameInferenceService,
  probeRenameProvider,
} from "@codexnamer/core";
import type { SessionTranscript } from "@codexnamer/shared";
import { describe, expect, it } from "vitest";

describe("provider backends", () => {
  it("uses openai-compatible responses API and parses structured JSON", async () => {
    const service = new OpenAICompatibleRenameInferenceService(
      buildConfigForTests({
        naming: {
          preset: "conventional",
          template: "{{summary}}",
          maxLength: 24,
          language: "zh-CN",
        },
        ai: {
          backend: "openai-compatible",
          providerSource: "manual",
          profile: "default",
          timeoutSeconds: 10,
          temperature: 0.2,
        },
        providerProfiles: [
          {
            profileId: "default",
            requestType: "responses",
            displayName: "default",
            baseUrl: "http://example.test/v1",
            model: "gpt-test",
            apiKey: "test-key",
            enabled: true,
            isDefault: true,
          },
        ],
      }),
      async () =>
        new Response(
          JSON.stringify({
            output_text:
              '{"name":"0404 feat: rename sessions","kind":"feat","summary":"rename sessions","scope":"codex"}',
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
    );

    const suggestion = await service.suggest({
      threadId: "t1",
      rolloutPath: "/tmp/r.jsonl",
      cwd: "/tmp/project",
      projectName: "project",
      taskCompleteCount: 1,
      tokenTotal: 100,
      firstUserMessage: "实现 session rename",
      lastAgentMessage: "完成 session rename",
    });

    expect(suggestion.source).toBe("ai");
    expect(suggestion.name).toContain("rename");
    expect(suggestion.name.length).toBeLessThanOrEqual(24);
    expect(suggestion.kind).toBe("feat");
  });

  it("records request logs for direct HTTP inference", async () => {
    const events: Array<Record<string, unknown>> = [];
    const service = new OpenAICompatibleRenameInferenceService(
      buildConfigForTests({
        ai: {
          backend: "openai-compatible",
          providerSource: "manual",
          profile: "default",
          timeoutSeconds: 10,
          temperature: 0.2,
        },
        providerProfiles: [
          {
            profileId: "default",
            requestType: "responses",
            displayName: "default",
            baseUrl: "http://example.test/v1",
            model: "gpt-test",
            apiKey: "test-key",
            enabled: true,
            isDefault: true,
          },
        ],
      }),
      async () =>
        new Response(
          JSON.stringify({
            output_text:
              '{"name":"0404 feat: rename sessions","kind":"feat","summary":"rename sessions","scope":"codex"}',
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      {
        start(entry) {
          events.push({ phase: "start", ...entry });
          return 1;
        },
        finish(entry) {
          events.push({ phase: "finish", ...entry });
        },
      },
    );

    await service.suggest({
      threadId: "t-http-log",
      rolloutPath: "/tmp/r.jsonl",
      cwd: "/tmp/project",
      projectName: "project",
      taskCompleteCount: 1,
      tokenTotal: 100,
      firstUserMessage: "实现 session rename",
      lastAgentMessage: "完成 session rename",
    });

    expect(events).toHaveLength(2);
    expect(events[0]?.phase).toBe("start");
    expect(events[0]?.transport).toBe("responses");
    expect(events[1]?.phase).toBe("finish");
    expect(events[1]?.status).toBe("succeeded");
  });

  it("does not include removed template reference in the AI prompt", async () => {
    let capturedPrompt = "";
    const service = new OpenAICompatibleRenameInferenceService(
      buildConfigForTests({
        general: {
          codexHome: "~/.codex",
          stateDir: "~/.local/state/codexnamer",
          uiLanguage: "zh-CN",
        },
        naming: {
          preset: "conventional",
          template: "{{summary}}",
          maxLength: 24,
          language: "zh-CN",
          contextStrategy: "user-only-transcript",
        },
        ai: {
          backend: "openai-compatible",
          providerSource: "manual",
          profile: "default",
          timeoutSeconds: 10,
          temperature: 0.2,
        },
        providerProfiles: [
          {
            profileId: "default",
            requestType: "responses",
            displayName: "default",
            baseUrl: "http://example.test/v1",
            model: "gpt-test",
            apiKey: "test-key",
            enabled: true,
            isDefault: true,
          },
        ],
      }),
      async (_url, init) => {
        capturedPrompt = JSON.parse(String(init?.body)).input;
        return new Response(
          JSON.stringify({
            output_text:
              '{"name":"0404 feat: rename sessions","kind":"feat","summary":"rename sessions","scope":"codex"}',
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      },
    );

    await service.suggest({
      threadId: "t-prompt",
      rolloutPath: "/tmp/r.jsonl",
      cwd: "/tmp/project",
      projectName: "project",
      taskCompleteCount: 1,
      tokenTotal: 100,
      firstUserMessage: "实现 session rename",
      lastAgentMessage: "完成 session rename",
    });

    expect(capturedPrompt).toContain("Prompt 语言：中文。");
    expect(capturedPrompt).toContain("requestedContextStrategy: user-only-transcript");
    expect(capturedPrompt).not.toContain("兼容层");
    expect(capturedPrompt).not.toContain("Legacy template reference");
  });

  it("formats paired user turns as turn blocks in the prompt", () => {
    const base = buildConfigForTests();
    const config = buildConfigForTests({
      general: {
        codexHome: "~/.codex",
        stateDir: "~/.local/state/codexnamer",
        uiLanguage: "zh-CN",
      },
      naming: {
        ...base.naming,
        contextStrategy: "paired-user-turns",
        language: "zh-CN",
      },
    });

    const transcript: SessionTranscript = {
      items: [
        { id: "1", role: "user", kind: "message", content: "先修 settings 保存状态" },
        { id: "2", role: "assistant", kind: "message", content: "我先看一下表单状态逻辑。" },
        {
          id: "3",
          role: "assistant",
          kind: "message",
          content: "已经定位到 dirty baseline 比较链路会造成误判。",
        },
        { id: "4", role: "user", kind: "message", content: "然后加 paired context strategy" },
      ],
      counts: {
        total: 4,
        visible: 4,
        hidden: 0,
        tools: 0,
      },
    };

    const session = {
      threadId: "t-paired-prompt",
      rolloutPath: "/tmp/r.jsonl",
      cwd: "/tmp/project",
      projectName: "project",
      taskCompleteCount: 1,
      tokenTotal: 100,
      firstUserMessage: "先修 settings 保存状态",
      lastUserMessage: "然后加 paired context strategy",
      lastAgentMessage: "已经定位到 dirty baseline 比较链路会造成误判。",
      renameContext: buildRenameContext(
        {
          threadId: "t-paired-prompt",
          rolloutPath: "/tmp/r.jsonl",
          cwd: "/tmp/project",
          projectName: "project",
          taskCompleteCount: 1,
          tokenTotal: 100,
          firstUserMessage: "先修 settings 保存状态",
          lastUserMessage: "然后加 paired context strategy",
          lastAgentMessage: "已经定位到 dirty baseline 比较链路会造成误判。",
        },
        config,
        { transcript },
      ),
    };

    const prompt = buildRenamePrompt(session, config);
    expect(prompt).toContain("requestedContextStrategy: paired-user-turns");
    expect(prompt).toContain("```conversation");
    expect(prompt).toContain("turn 1");
    expect(prompt).toContain("turn 2");
    expect(prompt).toContain("assistant_context");
    expect(prompt).toContain("user");
    expect(prompt).not.toContain("我先看一下表单状态逻辑");
    expect(prompt).toContain("已经定位到 dirty baseline 比较链路会造成误判");
  });

  it("probes manual provider connectivity with the same request stack used by rename", async () => {
    const result = await probeRenameProvider(
      buildConfigForTests({
        ai: {
          backend: "responses",
          providerSource: "manual",
          profile: "default",
          timeoutSeconds: 10,
          temperature: 0.2,
        },
        providerProfiles: [
          {
            profileId: "default",
            requestType: "responses",
            displayName: "default",
            baseUrl: "http://example.test/v1",
            model: "gpt-test",
            apiKey: "test-key",
            enabled: true,
            isDefault: true,
          },
        ],
      }),
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              output_text:
                '{"name":"ignored raw name","kind":"debug","summary":"验证 provider test 走真实 rename 请求链路","scope":"provider"}',
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
              },
            },
          ),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.responseText).toContain("验证 provider test 走真实 rename 请求链路");
    expect(result.diagnostics.requestedBackend).toBe("responses");
  });

  it("falls back to streaming probe parsing when the relay returns empty non-stream text", async () => {
    const result = await probeRenameProvider(
      buildConfigForTests({
        ai: {
          backend: "responses",
          providerSource: "manual",
          profile: "default",
          timeoutSeconds: 10,
          temperature: 0.2,
        },
        providerProfiles: [
          {
            profileId: "default",
            requestType: "responses",
            displayName: "default",
            baseUrl: "http://example.test/v1",
            model: "gpt-test",
            apiKey: "test-key",
            enabled: true,
            isDefault: true,
          },
        ],
      }),
      {
        fetchImpl: async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          if (body.stream === true) {
            return new Response(
              [
                "event: response.output_text.delta",
                'data: {"type":"response.output_text.delta","delta":"{\\"kind\\":\\"debug\\",\\"summary\\":\\"stream probe 成功\\",\\"scope\\":\\"provider\\",\\"tagId\\":\\"provider\\"}"}',
                "",
                "event: response.output_text.done",
                'data: {"type":"response.output_text.done","text":"{\\"kind\\":\\"debug\\",\\"summary\\":\\"stream probe 成功\\",\\"scope\\":\\"provider\\",\\"tagId\\":\\"provider\\"}"}',
                "",
              ].join("\n"),
              {
                status: 200,
                headers: {
                  "content-type": "text/event-stream",
                },
              },
            );
          }
          return new Response(
            JSON.stringify({
              output_text: "",
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
              },
            },
          );
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(result.responseText).toContain("stream probe 成功");
  });

  it("uses streaming fallback for rename when the relay returns empty non-stream text", async () => {
    const events: Array<Record<string, unknown>> = [];
    const service = new OpenAICompatibleRenameInferenceService(
      buildConfigForTests({
        ai: {
          backend: "responses",
          providerSource: "manual",
          profile: "default",
          timeoutSeconds: 10,
          temperature: 0.2,
        },
        providerProfiles: [
          {
            profileId: "default",
            requestType: "responses",
            displayName: "default",
            baseUrl: "http://example.test/v1",
            model: "gpt-test",
            apiKey: "test-key",
            enabled: true,
            isDefault: true,
          },
        ],
      }),
      async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if (body.stream === true) {
          return new Response(
            [
              "event: response.output_text.done",
              'data: {"type":"response.output_text.done","text":"{\\"kind\\":\\"debug\\",\\"summary\\":\\"stream rename 成功\\",\\"scope\\":\\"provider\\",\\"tagId\\":\\"provider\\"}"}',
              "",
            ].join("\n"),
            {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
              },
            },
          );
        }
        return new Response(
          JSON.stringify({
            output_text: "",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      },
      {
        start(entry) {
          events.push({ phase: "start", ...entry });
          return 1;
        },
        finish(entry) {
          events.push({ phase: "finish", ...entry });
        },
      },
    );

    const suggestion = await service.suggest({
      threadId: "t-stream-fallback",
      rolloutPath: "/tmp/r-stream.jsonl",
      cwd: "/tmp/project",
      projectName: "project",
      taskCompleteCount: 1,
      tokenTotal: 100,
      firstUserMessage: "检查 rename SSE fallback",
    });

    expect(suggestion.name).toContain("stream rename 成功");
    expect(events).toHaveLength(2);
    expect(events[1]?.status).toBe("succeeded");
    expect(events[1]?.metadata).toMatchObject({
      responseMode: "sse-fallback",
      sseFallbackReason: "empty-response",
    });
  });

  it("uses AI-selected tagId when structured naming mode is active", async () => {
    const service = new OpenAICompatibleRenameInferenceService(
      buildConfigForTests({
        naming: {
          language: "zh-CN",
          builder: [
            { type: "component", component: "tag" },
            { type: "separator", value: " · " },
            { type: "component", component: "kind" },
            { type: "separator", value: " · " },
            { type: "component", component: "summary" },
          ],
        },
        ai: {
          backend: "openai-compatible",
          providerSource: "manual",
          profile: "default",
          timeoutSeconds: 10,
          temperature: 0.2,
        },
        providerProfiles: [
          {
            profileId: "default",
            requestType: "responses",
            displayName: "default",
            baseUrl: "http://example.test/v1",
            model: "gpt-test",
            apiKey: "test-key",
            enabled: true,
            isDefault: true,
          },
        ],
      }),
      async () =>
        new Response(
          JSON.stringify({
            output_text:
              '{"name":"ignored raw name","kind":"fix","summary":"修复设置保存循环","scope":"settings","tagId":"settings"}',
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
    );

    const suggestion = await service.suggest({
      threadId: "t-structured-tag",
      rolloutPath: "/tmp/r-tag.jsonl",
      cwd: "/tmp/project",
      projectName: "project",
      taskCompleteCount: 1,
      tokenTotal: 100,
      firstUserMessage: "修复 web settings 保存后重置的问题",
    });

    expect(suggestion.source).toBe("ai");
    expect(suggestion.tagId).toBe("settings");
    expect(suggestion.name).toContain("#设置");
    expect(suggestion.name).toContain("fix");
  });

  it("uses inherited Codex config as the default streaming HTTP source", async () => {
    let runnerCalled = false;
    const service = createRenameInferenceService(
      buildConfigForTests({
        ai: {
          backend: "responses",
          providerSource: "codex-config",
          profile: "default",
          timeoutSeconds: 10,
          temperature: 0.2,
        },
        inheritedCodex: {
          modelProvider: "OpenAI",
          model: "gpt-5.4",
          providers: {
            OpenAI: {
              name: "OpenAI",
              baseUrl: "http://example.test/v1",
              wireApi: "responses",
              requiresOpenaiAuth: true,
            },
          },
          auth: {
            authMode: "apikey",
            openaiApiKey: "codex-auth-key",
          },
        },
      }),
      {
        fetchImpl: async (_input, init) => {
          const headers = init?.headers as Record<string, string>;
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          expect(headers.Authorization).toBe("Bearer codex-auth-key");
          expect(headers["x-api-key"]).toBe("codex-auth-key");
          expect(body.stream).toBe(true);
          return new Response(
            [
              "event: response.output_text.done",
              'data: {"type":"response.output_text.done","text":"{\\"name\\":\\"0404 feat: inherited auth\\",\\"kind\\":\\"feat\\",\\"summary\\":\\"inherited auth\\",\\"scope\\":\\"provider\\"}"}',
              "",
            ].join("\n"),
            {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
              },
            },
          );
        },
        codexRunner: {
          async run() {
            runnerCalled = true;
            throw new Error("runner should not be called");
          },
        },
      },
    );

    const suggestion = await service.suggest({
      threadId: "t3",
      rolloutPath: "/tmp/r3.jsonl",
      cwd: "/tmp/project",
      projectName: "project",
      taskCompleteCount: 1,
      tokenTotal: 50,
      firstUserMessage: "沿用 codex 配置命名",
    });

    expect(runnerCalled).toBe(false);
    expect(suggestion.source).toBe("ai");
    expect(suggestion.metadata?.backend).toBe("responses");
    expect(suggestion.metadata?.requestType).toBe("responses");
    expect(suggestion.name).toContain("inherited auth");
  });
});
