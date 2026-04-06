import fs from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  CodexRenameInferenceService,
  OpenAICompatibleRenameInferenceService,
  buildRenameContext,
  buildRenamePrompt,
  buildConfigForTests,
  createRenameInferenceService
} from "@codex-session-manager/core";
import type { SessionTranscript } from "@codex-session-manager/shared";

describe("provider backends", () => {
  it("uses openai-compatible responses API and parses structured JSON", async () => {
    const service = new OpenAICompatibleRenameInferenceService(
      buildConfigForTests({
        naming: {
          preset: "conventional",
          template: "{{summary}}",
          maxLength: 24,
          language: "zh-CN"
        },
        ai: {
          backend: "openai-compatible",
          providerSource: "explicit",
          profile: "default",
          timeoutSeconds: 10,
          temperature: 0.2
        },
        providerProfiles: [
          {
            profileId: "default",
            backendKind: "openai-compatible",
            displayName: "default",
            providerSource: "explicit",
            baseUrl: "http://example.test/v1",
            model: "gpt-test",
            apiKey: "test-key",
            wireApi: "responses",
            enabled: true,
            isDefault: true
          }
        ]
      }),
      async () =>
        new Response(
          JSON.stringify({
            output_text: '{"name":"0404 feat: rename sessions","kind":"feat","summary":"rename sessions","scope":"codex"}'
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
    );

    const suggestion = await service.suggest({
      threadId: "t1",
      rolloutPath: "/tmp/r.jsonl",
      cwd: "/tmp/project",
      projectName: "project",
      taskCompleteCount: 1,
      tokenTotal: 100,
      firstUserMessage: "实现 session rename",
      lastAgentMessage: "完成 session rename"
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
          providerSource: "explicit",
          profile: "default",
          timeoutSeconds: 10,
          temperature: 0.2
        },
        providerProfiles: [
          {
            profileId: "default",
            backendKind: "openai-compatible",
            displayName: "default",
            providerSource: "explicit",
            baseUrl: "http://example.test/v1",
            model: "gpt-test",
            apiKey: "test-key",
            wireApi: "responses",
            enabled: true,
            isDefault: true
          }
        ]
      }),
      async () =>
        new Response(
          JSON.stringify({
            output_text: '{"name":"0404 feat: rename sessions","kind":"feat","summary":"rename sessions","scope":"codex"}'
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        ),
      {
        start(entry) {
          events.push({ phase: "start", ...entry });
          return 1;
        },
        finish(entry) {
          events.push({ phase: "finish", ...entry });
        }
      }
    );

    await service.suggest({
      threadId: "t-http-log",
      rolloutPath: "/tmp/r.jsonl",
      cwd: "/tmp/project",
      projectName: "project",
      taskCompleteCount: 1,
      tokenTotal: 100,
      firstUserMessage: "实现 session rename",
      lastAgentMessage: "完成 session rename"
    });

    expect(events).toHaveLength(2);
    expect(events[0]?.phase).toBe("start");
    expect(events[0]?.transport).toBe("responses");
    expect(events[1]?.phase).toBe("finish");
    expect(events[1]?.status).toBe("succeeded");
  });

  it("does not include legacy template reference in the AI prompt", async () => {
    let capturedPrompt = "";
    const service = new OpenAICompatibleRenameInferenceService(
      buildConfigForTests({
        general: {
          codexHome: "~/.codex",
          stateDir: "~/.local/state/codex-session-manager",
          uiLanguage: "zh-CN"
        },
        naming: {
          preset: "conventional",
          template: "{{summary}}",
          maxLength: 24,
          language: "zh-CN",
          contextStrategy: "user-only-transcript"
        },
        ai: {
          backend: "openai-compatible",
          providerSource: "explicit",
          profile: "default",
          timeoutSeconds: 10,
          temperature: 0.2
        },
        providerProfiles: [
          {
            profileId: "default",
            backendKind: "openai-compatible",
            displayName: "default",
            providerSource: "explicit",
            baseUrl: "http://example.test/v1",
            model: "gpt-test",
            apiKey: "test-key",
            wireApi: "responses",
            enabled: true,
            isDefault: true
          }
        ]
      }),
      async (_url, init) => {
        capturedPrompt = JSON.parse(String(init?.body)).input;
        return new Response(
          JSON.stringify({
            output_text: '{"name":"0404 feat: rename sessions","kind":"feat","summary":"rename sessions","scope":"codex"}'
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }
    );

    await service.suggest({
      threadId: "t-prompt",
      rolloutPath: "/tmp/r.jsonl",
      cwd: "/tmp/project",
      projectName: "project",
      taskCompleteCount: 1,
      tokenTotal: 100,
      firstUserMessage: "实现 session rename",
      lastAgentMessage: "完成 session rename"
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
        stateDir: "~/.local/state/codex-session-manager",
        uiLanguage: "zh-CN"
      },
      naming: {
        ...base.naming,
        contextStrategy: "paired-user-turns",
        language: "zh-CN"
      }
    });

    const transcript: SessionTranscript = {
      items: [
        { id: "1", role: "user", kind: "message", content: "先修 settings 保存状态" },
        { id: "2", role: "assistant", kind: "message", content: "我先看一下表单状态逻辑。" },
        { id: "3", role: "assistant", kind: "message", content: "已经定位到 dirty baseline 比较链路会造成误判。" },
        { id: "4", role: "user", kind: "message", content: "然后加 paired context strategy" }
      ],
      counts: {
        total: 4,
        visible: 4,
        hidden: 0,
        tools: 0
      }
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
          lastAgentMessage: "已经定位到 dirty baseline 比较链路会造成误判。"
        },
        config,
        { transcript }
      )
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

  it("uses codex exec runner and reads structured output file", async () => {
    const writes: string[] = [];
    let schemaPayload = "";
    let capturedArgs: string[] = [];
    const service = new CodexRenameInferenceService(
      buildConfigForTests({
        ai: {
          backend: "codex",
          providerSource: "inherit-codex",
          profile: "default",
          timeoutSeconds: 10,
          temperature: 0.2
        }
      }),
      {
        async run(args) {
          capturedArgs = args;
          const outputIndex = args.indexOf("-o");
          const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
          const schemaIndex = args.indexOf("--output-schema");
          const schemaPath = schemaIndex >= 0 ? args[schemaIndex + 1] : undefined;
          if (!outputPath) {
            throw new Error("missing output path");
          }
          if (!schemaPath) {
            throw new Error("missing schema path");
          }
          writes.push(outputPath);
          schemaPayload = await fs.readFile(schemaPath, "utf8");
          await fs.writeFile(
            outputPath,
            '{"name":"0404 research: codex provider","kind":"research","summary":"codex provider","scope":"core","tagId":"provider"}',
            "utf8"
          );
        }
      }
    );

    const suggestion = await service.suggest({
      threadId: "t2",
      rolloutPath: "/tmp/r2.jsonl",
      cwd: "/tmp/project",
      projectName: "project",
      taskCompleteCount: 2,
      tokenTotal: 200,
      firstUserMessage: "实现 codex backend",
      lastAgentMessage: "已经接上 codex exec"
    });

    expect(writes).toHaveLength(1);
    expect(capturedArgs).toContain("--ephemeral");
    expect(capturedArgs).toContain('model_reasoning_effort="minimal"');
    expect(capturedArgs).toContain('model_reasoning_summary="none"');
    expect(JSON.parse(schemaPayload).required).toEqual(["name", "kind", "summary", "scope"]);
    expect(JSON.parse(schemaPayload).properties.tagId.type).toBe("string");
    expect(suggestion.source).toBe("ai");
    expect(suggestion.kind).toBe("research");
    expect(suggestion.tagId).toBe("provider");
    expect(suggestion.name).toContain("#Provider");
  });

  it("uses AI-selected tagId when structured naming mode is active", async () => {
    const service = new OpenAICompatibleRenameInferenceService(
      buildConfigForTests({
        naming: {
          language: "zh-CN",
          components: ["tag", "kind", "summary"],
          componentSeparator: " · "
        },
        ai: {
          backend: "openai-compatible",
          providerSource: "explicit",
          profile: "default",
          timeoutSeconds: 10,
          temperature: 0.2
        },
        providerProfiles: [
          {
            profileId: "default",
            backendKind: "openai-compatible",
            displayName: "default",
            providerSource: "explicit",
            baseUrl: "http://example.test/v1",
            model: "gpt-test",
            apiKey: "test-key",
            wireApi: "responses",
            enabled: true,
            isDefault: true
          }
        ]
      }),
      async () =>
        new Response(
          JSON.stringify({
            output_text:
              '{"name":"ignored raw name","kind":"fix","summary":"修复设置保存循环","scope":"settings","tagId":"settings"}'
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
    );

    const suggestion = await service.suggest({
      threadId: "t-structured-tag",
      rolloutPath: "/tmp/r-tag.jsonl",
      cwd: "/tmp/project",
      projectName: "project",
      taskCompleteCount: 1,
      tokenTotal: 100,
      firstUserMessage: "修复 web settings 保存后重置的问题"
    });

    expect(suggestion.source).toBe("ai");
    expect(suggestion.tagId).toBe("settings");
    expect(suggestion.name).toContain("#设置");
    expect(suggestion.name).toContain("fix");
  });

  it("prefers direct HTTP when backend=codex can inherit auth from Codex", async () => {
    let runnerCalled = false;
    const service = createRenameInferenceService(
      buildConfigForTests({
        ai: {
          backend: "codex",
          providerSource: "inherit-codex",
          profile: "default",
          timeoutSeconds: 10,
          temperature: 0.2
        },
        inheritedCodex: {
          modelProvider: "OpenAI",
          model: "gpt-5.4",
          providers: {
            OpenAI: {
              name: "OpenAI",
              baseUrl: "http://example.test/v1",
              wireApi: "responses",
              requiresOpenaiAuth: true
            }
          },
          auth: {
            authMode: "apikey",
            openaiApiKey: "codex-auth-key"
          }
        }
      }),
      {
        fetchImpl: async (_input, init) => {
          const headers = init?.headers as Record<string, string>;
          expect(headers.Authorization).toBe("Bearer codex-auth-key");
          expect(headers["x-api-key"]).toBe("codex-auth-key");
          return new Response(
            JSON.stringify({
              output_text:
                '{"name":"0404 feat: inherited auth","kind":"feat","summary":"inherited auth","scope":"provider"}'
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        },
        codexRunner: {
          async run() {
            runnerCalled = true;
            throw new Error("runner should not be called");
          }
        }
      }
    );

    const suggestion = await service.suggest({
      threadId: "t3",
      rolloutPath: "/tmp/r3.jsonl",
      cwd: "/tmp/project",
      projectName: "project",
      taskCompleteCount: 1,
      tokenTotal: 50,
      firstUserMessage: "沿用 codex 配置命名"
    });

    expect(runnerCalled).toBe(false);
    expect(suggestion.source).toBe("ai");
    expect(suggestion.metadata?.requestedBackend).toBe("codex");
    expect(suggestion.metadata?.transport).toBe("http");
    expect(suggestion.name).toContain("inherited auth");
  });
});
