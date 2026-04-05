import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { EffectiveConfig } from "@codex-session-manager/shared";
import { buildConfigForTests, CodexSessionManager } from "@codex-session-manager/core";

export async function createTempWorkspace(): Promise<{
  root: string;
  codexHome: string;
  stateDir: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "csm-"));
  const codexHome = path.join(root, ".codex");
  const stateDir = path.join(root, ".state");
  await fs.mkdir(path.join(codexHome, "sessions"), { recursive: true });
  await fs.writeFile(path.join(codexHome, "config.toml"), 'model_provider = "OpenAI"\nmodel = "gpt-5.4"\n');
  return { root, codexHome, stateDir };
}

export async function writeRolloutFixture(params: {
  codexHome: string;
  threadId: string;
  userMessage: string;
  lastAgentMessage: string;
  updatedAt?: string;
  cwd?: string;
  toolCallName?: string;
  toolCallArguments?: Record<string, unknown>;
  toolCallOutput?: string;
}): Promise<string> {
  const updatedAt = params.updatedAt ?? "2026-04-04T12:10:00.000Z";
  const rolloutDir = path.join(params.codexHome, "sessions", "2026", "04", "04");
  await fs.mkdir(rolloutDir, { recursive: true });
  const rolloutPath = path.join(rolloutDir, `rollout-${params.threadId}.jsonl`);
  const lines = [
    JSON.stringify({
      timestamp: "2026-04-04T12:00:00.000Z",
      type: "session_meta",
      payload: {
        id: params.threadId,
        timestamp: "2026-04-04T12:00:00.000Z",
        cwd: params.cwd ?? "/tmp/project-alpha",
        model_provider: "OpenAI"
      }
    }),
    JSON.stringify({
      timestamp: "2026-04-04T12:00:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: params.userMessage
          }
        ]
      }
    }),
    JSON.stringify({
      timestamp: "2026-04-04T12:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: params.userMessage
      }
    }),
    JSON.stringify({
      timestamp: "2026-04-04T12:00:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        phase: "commentary",
        content: [
          {
            type: "output_text",
            text: params.lastAgentMessage
          }
        ]
      }
    }),
    ...(params.toolCallName
      ? [
          JSON.stringify({
            timestamp: "2026-04-04T12:00:03.000Z",
            type: "response_item",
            payload: {
              type: "function_call",
              name: params.toolCallName,
              arguments: JSON.stringify(params.toolCallArguments ?? {}),
              call_id: "call_test_1"
            }
          }),
          JSON.stringify({
            timestamp: "2026-04-04T12:00:04.000Z",
            type: "response_item",
            payload: {
              type: "function_call_output",
              call_id: "call_test_1",
              output: params.toolCallOutput ?? "ok"
            }
          })
        ]
      : []),
    JSON.stringify({
      timestamp: updatedAt,
      type: "event_msg",
      payload: {
        type: "task_complete",
        last_agent_message: params.lastAgentMessage
      }
    }),
    JSON.stringify({
      timestamp: updatedAt,
      type: "task_complete",
      payload: {
        last_agent_message: params.lastAgentMessage
      }
    }),
    JSON.stringify({
      timestamp: updatedAt,
      type: "token_count",
      payload: {
        info: {
          total_token_usage: {
            total_tokens: 1234
          }
        }
      }
    })
  ];
  await fs.writeFile(rolloutPath, `${lines.join("\n")}\n`, "utf8");
  return rolloutPath;
}

export async function createManagerForTest(overrides: Partial<EffectiveConfig> & {
  codexHome: string;
  stateDir: string;
}): Promise<CodexSessionManager> {
  return CodexSessionManager.create({
    overrides: buildConfigForTests({
      general: {
        codexHome: overrides.codexHome,
        stateDir: overrides.stateDir
      },
      ai: {
        backend: "none",
        providerSource: "inherit-codex",
        profile: "default",
        timeoutSeconds: 45,
        temperature: 0.2
      },
      ...(overrides as Partial<EffectiveConfig>)
    }),
    operator: "test"
  });
}
