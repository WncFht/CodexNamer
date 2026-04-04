import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfigView, loadEffectiveConfig, writeUserConfig } from "@codex-session-manager/core";
import { REDACTED_SECRET } from "@codex-session-manager/shared";

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

  it("preserves provider api keys when config patch uses redacted placeholder", async () => {
    const root = await makeTempDir();
    const codexHome = path.join(root, ".codex");
    const configPath = path.join(root, "config.toml");

    await fs.mkdir(codexHome, { recursive: true });
    await fs.writeFile(path.join(codexHome, "config.toml"), 'model_provider = "OpenAI"\nmodel = "gpt-5.4"\n');
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
        'api_key = "keep-me"'
      ].join("\n"),
      "utf8"
    );

    await writeUserConfig({
      cwd: root,
      configPath,
      patch: {
        naming: {
          maxLength: 48
        },
        providerProfiles: [
          {
            profileId: "default",
            backendKind: "openai-compatible",
            displayName: "default",
            providerSource: "explicit",
            baseUrl: "http://explicit.test/v1",
            model: "gpt-next",
            apiKey: REDACTED_SECRET,
            enabled: true,
            isDefault: true
          }
        ]
      }
    });

    const effective = await loadEffectiveConfig({
      cwd: root,
      configPath
    });
    const view = await loadConfigView({
      cwd: root,
      configPath,
      effectiveConfig: effective
    });
    const written = await fs.readFile(configPath, "utf8");

    expect(effective.naming.maxLength).toBe(48);
    expect(effective.providerProfiles[0]?.apiKey).toBe("keep-me");
    expect(view.userConfig.providerProfiles?.[0]?.apiKey).toBe(REDACTED_SECRET);
    expect(written).toContain('api_key = "keep-me"');
    expect(written).toContain('model = "gpt-next"');
  });
});
