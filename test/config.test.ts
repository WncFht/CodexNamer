import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadEffectiveConfig } from "@codex-session-manager/core";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "csm-config-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("config loading", () => {
  it("loads inherited Codex auth.json and explicit provider api_key", async () => {
    const root = await makeTempDir();
    const codexHome = path.join(root, ".codex");
    const configPath = path.join(root, "config.toml");

    await fs.mkdir(codexHome, { recursive: true });
    await fs.writeFile(
      path.join(codexHome, "config.toml"),
      [
        'model_provider = "OpenAI"',
        'model = "gpt-5.4"',
        "",
        "[model_providers.OpenAI]",
        'base_url = "http://relay.test/v1"',
        'wire_api = "responses"',
        "requires_openai_auth = true"
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(codexHome, "auth.json"),
      JSON.stringify({
        auth_mode: "apikey",
        OPENAI_API_KEY: "codex-file-key"
      }),
      "utf8"
    );
    await fs.writeFile(
      configPath,
      [
        "[general]",
        `codex_home = "${codexHome}"`,
        `state_dir = "${path.join(root, "state")}"`,
        "",
        "[provider.default]",
        'backend_kind = "openai-compatible"',
        'display_name = "default"',
        'provider_source = "explicit"',
        'base_url = "http://explicit.test/v1"',
        'model = "gpt-explicit"',
        'api_key = "explicit-key"'
      ].join("\n"),
      "utf8"
    );

    const effective = await loadEffectiveConfig({
      cwd: root,
      configPath
    });

    expect(effective.inheritedCodex.auth?.authMode).toBe("apikey");
    expect(effective.inheritedCodex.auth?.openaiApiKey).toBe("codex-file-key");
    expect(effective.providerProfiles[0]?.apiKey).toBe("explicit-key");
  });
});
