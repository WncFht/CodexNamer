import { describe, expect, test } from "vitest";

import {
  buildDraft,
  encodeDraft,
  isDraftDirty,
  renderNamingStructurePreview
} from "../packages/web/src/settings-model.js";
import {
  buildSettingsDraft,
  buildSettingsFields,
  encodeSettingsDraft,
  isSettingsDraftDirty
} from "../packages/tui/src/settings-model.js";

describe("web settings model", () => {
  test("tracks draft dirtiness from encoded config instead of mutation events", () => {
    const configView = {
      paths: {
        cwd: "/tmp/csm",
        userConfigPath: "/tmp/config.toml",
        projectConfigPath: "/tmp/project.toml"
      },
      userConfig: {},
      projectOverride: {},
      effectiveConfig: {
        general: {
          uiLanguage: "zh-CN"
        },
        rename: {
          autoApply: "idle-finalize"
        },
        naming: {
          preset: "conventional",
          language: "zh-CN",
          contextStrategy: "paired-user-turns",
          compositionMode: "structured",
          builder: [
            { type: "component", component: "timestamp", format: "%Y-%m-%d" },
            { type: "separator", value: " · " },
            { type: "component", component: "summary" }
          ],
          tags: [{ id: "bugfix", label: "修复", description: "", promptHint: "bugfix" }]
        },
        ai: {
          backend: "responses",
          providerSource: "codex-config",
          profile: "default",
          maxConcurrency: 2
        },
        watch: {},
        maintenance: {},
        providerProfiles: [{ profileId: "default", isDefault: true, baseUrl: "http://127.0.0.1:23141/v1" }]
      }
    } as const;

    const draft = buildDraft(configView);
    const baseline = encodeDraft(draft);
    expect(isDraftDirty(draft, baseline)).toBe(false);

    const changed = { ...draft, namingMaxLength: "96" };
    expect(isDraftDirty(changed, baseline)).toBe(true);

    const reverted = { ...changed, namingMaxLength: draft.namingMaxLength };
    expect(isDraftDirty(reverted, baseline)).toBe(false);
    expect(renderNamingStructurePreview(draft, "zh-CN")).toContain("修复设置保存与语言切换");
  });
});

describe("tui settings model", () => {
  test("keeps field definitions aligned with encoded draft semantics", () => {
    const configView = {
      paths: {
        cwd: "/tmp/csm",
        userConfigPath: "/tmp/config.toml",
        projectConfigPath: "/tmp/project.toml"
      },
      userConfig: {},
      projectOverride: {},
      effectiveConfig: {
        general: {
          uiLanguage: "en-US"
        },
        rename: {
          autoApply: "disabled"
        },
        naming: {
          template: "{{summary}}",
          contextStrategy: "paired-user-turns",
          language: "en-US"
        },
        watch: {
          candidateIdleSeconds: 120,
          finalizeIdleSeconds: 600,
          renameCooldownSeconds: 900
        },
        ai: {
          backend: "openai-compatible",
          providerSource: "manual",
          profile: "primary",
          timeoutSeconds: 45,
          temperature: 0.2,
          maxConcurrency: 3
        },
        providerProfiles: [
          {
            profileId: "primary",
            isDefault: true,
            baseUrl: "https://relay.example/v1",
            model: "gpt-5.4",
            requestType: "responses"
          }
        ]
      }
    } as const;

    const draft = buildSettingsDraft(configView);
    const baseline = encodeSettingsDraft(draft);
    expect(isSettingsDraftDirty(draft, baseline)).toBe(false);

    const modified = { ...draft, aiMaxConcurrency: "5" };
    expect(isSettingsDraftDirty(modified, baseline)).toBe(true);
    expect(isSettingsDraftDirty({ ...modified, aiMaxConcurrency: draft.aiMaxConcurrency }, baseline)).toBe(false);

    const fields = buildSettingsFields({
      draft,
      selectedProfile: draft.providerProfiles[0],
      uiLanguage: "en-US",
      tt: (key) => key,
      inline: (_zh, en) => en
    });
    expect(fields.some((field) => field.key === "aiMaxConcurrency" && field.value === "3")).toBe(true);
    expect(fields.some((field) => field.key === "namingContextStrategy" && field.value === "paired-user-turns")).toBe(
      true
    );
  });
});
