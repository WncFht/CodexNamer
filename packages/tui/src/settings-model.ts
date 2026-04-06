import type { ConfigDocument, ConfigView, ProviderProfile } from "./types.js";
import type { UiLanguage } from "./i18n.js";

export type SettingKey =
  | "uiLanguage"
  | "namingTemplate"
  | "namingDefaultStyle"
  | "namingMaxLength"
  | "namingLanguage"
  | "namingContextStrategy"
  | "renameAutoApply"
  | "candidateIdleSeconds"
  | "finalizeIdleSeconds"
  | "renameCooldownSeconds"
  | "aiBackend"
  | "aiProviderSource"
  | "aiProfile"
  | "aiTimeoutSeconds"
  | "aiTemperature"
  | "aiMaxConcurrency"
  | "providerBaseUrl"
  | "providerModel"
  | "providerApiKey"
  | "providerWireApi";

export type SettingsDraft = {
  uiLanguage: UiLanguage;
  namingTemplate: string;
  namingDefaultStyle: "brief" | "detailed";
  namingMaxLength: string;
  namingLanguage: string;
  namingContextStrategy: string;
  renameAutoApply: string;
  candidateIdleSeconds: string;
  finalizeIdleSeconds: string;
  renameCooldownSeconds: string;
  aiBackend: string;
  aiProviderSource: string;
  aiProfile: string;
  aiTimeoutSeconds: string;
  aiTemperature: string;
  aiMaxConcurrency: string;
  providerProfiles: ProviderProfile[];
  selectedProfileId: string;
};

export type SettingsField = {
  key: SettingKey;
  label: string;
  value: string;
};

export type SettingsTranslate = (key: "nA") => string;
export type SettingsLanguageText = (zh: string, en: string) => string;
type TuiNamingContextStrategy = NonNullable<NonNullable<ConfigDocument["naming"]>["contextStrategy"]>;
type TuiAiBackend = NonNullable<NonNullable<ConfigDocument["ai"]>["backend"]>;
type TuiProviderSource = NonNullable<NonNullable<ConfigDocument["ai"]>["providerSource"]>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumberString(value: unknown, fallback = ""): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : fallback;
}

export function normalizeProfile(raw: unknown): ProviderProfile {
  const record = asRecord(raw);
  return {
    profileId: asString(record.profileId, "default"),
    backendKind:
      (asString(record.backendKind || record.backend_kind, "openai-compatible") as ProviderProfile["backendKind"]) ??
      "openai-compatible",
    displayName: asString(record.displayName || record.display_name),
    providerSource:
      (asString(record.providerSource || record.provider_source, "explicit") as ProviderProfile["providerSource"]) ??
      "explicit",
    providerRef: asString(record.providerRef || record.provider_ref),
    baseUrl: asString(record.baseUrl || record.base_url),
    model: asString(record.model),
    apiKey: asString(record.apiKey || record.api_key),
    apiKeyRef: asString(record.apiKeyRef || record.api_key_ref),
    headers: (record.headers as Record<string, string> | undefined) ?? {},
    wireApi: (asString(record.wireApi || record.wire_api, "auto") as ProviderProfile["wireApi"]) ?? "auto",
    enabled: typeof record.enabled === "boolean" ? record.enabled : true,
    isDefault:
      typeof record.isDefault === "boolean"
        ? record.isDefault
        : typeof record.is_default === "boolean"
          ? Boolean(record.is_default)
          : false
  };
}

export function buildSettingsDraft(configView: ConfigView): SettingsDraft {
  const effective = asRecord(configView.effectiveConfig);
  const general = asRecord(effective.general);
  const naming = asRecord(effective.naming);
  const rename = asRecord(effective.rename);
  const watch = asRecord(effective.watch);
  const ai = asRecord(effective.ai);
  const profiles = Array.isArray(effective.providerProfiles) ? effective.providerProfiles.map(normalizeProfile) : [];
  const selectedProfileId = asString(
    ai.profile,
    profiles.find((item) => item.isDefault)?.profileId ?? profiles[0]?.profileId ?? "default"
  );
  const selectedProfile = profiles.find((profile) => profile.profileId === selectedProfileId) ?? profiles[0];

  return {
    uiLanguage: general.uiLanguage === "zh-CN" ? "zh-CN" : "en-US",
    namingTemplate: asString(naming.template, "{{time:%m%d-%H%M}} {{kind}}{{scope_paren}}: {{summary}}"),
    namingDefaultStyle:
      asString(naming.defaultStyle || naming.default_style, "detailed") === "brief" ? "brief" : "detailed",
    namingMaxLength: asNumberString(naming.maxLength || naming.max_length, "72"),
    namingLanguage: asString(naming.language, "zh-CN"),
    namingContextStrategy: asString(naming.contextStrategy || naming.context_strategy, "summary-signals"),
    renameAutoApply: asString(rename.autoApply || rename.auto_apply, "idle-finalize"),
    candidateIdleSeconds: asNumberString(watch.candidateIdleSeconds || watch.candidate_idle_seconds, "120"),
    finalizeIdleSeconds: asNumberString(watch.finalizeIdleSeconds || watch.finalize_idle_seconds, "600"),
    renameCooldownSeconds: asNumberString(watch.renameCooldownSeconds || watch.rename_cooldown_seconds, "900"),
    aiBackend: asString(ai.backend, "codex"),
    aiProviderSource: asString(ai.providerSource || ai.provider_source, "inherit-codex"),
    aiProfile: asString(ai.profile, selectedProfileId),
    aiTimeoutSeconds: asNumberString(ai.timeoutSeconds || ai.timeout_seconds, "45"),
    aiTemperature: asNumberString(ai.temperature, "0.2"),
    aiMaxConcurrency: asNumberString(ai.maxConcurrency || ai.max_concurrency, "1"),
    providerProfiles: profiles,
    selectedProfileId: selectedProfile?.profileId ?? selectedProfileId
  };
}

function parseNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stripEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function updateSelectedProfile(
  profiles: ProviderProfile[],
  profileId: string,
  patch: Partial<ProviderProfile>
): ProviderProfile[] {
  return profiles.map((profile) => (profile.profileId === profileId ? { ...profile, ...patch } : profile));
}

export function encodeSettingsDraft(draft: SettingsDraft): ConfigDocument {
  return {
    general: {
      uiLanguage: draft.uiLanguage
    },
    rename: {
      autoApply: draft.renameAutoApply as "disabled" | "idle-finalize"
    },
    watch: {
      candidateIdleSeconds: parseNumber(draft.candidateIdleSeconds),
      finalizeIdleSeconds: parseNumber(draft.finalizeIdleSeconds),
      renameCooldownSeconds: parseNumber(draft.renameCooldownSeconds)
    },
    naming: {
      template: stripEmpty(draft.namingTemplate),
      defaultStyle: draft.namingDefaultStyle,
      maxLength: parseNumber(draft.namingMaxLength),
      language: stripEmpty(draft.namingLanguage),
      contextStrategy: stripEmpty(draft.namingContextStrategy) as TuiNamingContextStrategy | undefined,
      contextMaxChars: undefined
    },
    ai: {
      backend: draft.aiBackend as TuiAiBackend,
      providerSource: draft.aiProviderSource as TuiProviderSource,
      profile: stripEmpty(draft.aiProfile),
      timeoutSeconds: parseNumber(draft.aiTimeoutSeconds),
      temperature: parseNumber(draft.aiTemperature),
      maxConcurrency: parseNumber(draft.aiMaxConcurrency)
    },
    providerProfiles: draft.providerProfiles.map((profile) => ({
      profileId: profile.profileId,
      backendKind: profile.backendKind,
      displayName: stripEmpty(profile.displayName ?? ""),
      providerSource: profile.providerSource,
      providerRef: stripEmpty(profile.providerRef ?? ""),
      baseUrl: stripEmpty(profile.baseUrl ?? ""),
      model: stripEmpty(profile.model ?? ""),
      apiKey: stripEmpty(profile.apiKey ?? ""),
      apiKeyRef: stripEmpty(profile.apiKeyRef ?? ""),
      headers: profile.headers,
      wireApi: profile.wireApi,
      enabled: profile.enabled,
      isDefault: profile.isDefault
    }))
  };
}

export function encodeSettingsKey(document: ConfigDocument): string {
  return JSON.stringify(document);
}

export function isSettingsDraftDirty(draft: SettingsDraft, baseline: ConfigDocument): boolean {
  return encodeSettingsKey(encodeSettingsDraft(draft)) !== encodeSettingsKey(baseline);
}

function cycle<T extends string>(current: T, values: readonly T[]): T {
  const index = values.indexOf(current);
  return values[(index + 1) % values.length] as T;
}

export function cycleSettingsFieldValue(
  draft: SettingsDraft,
  key: SettingKey,
  selectedProfile?: ProviderProfile
): SettingsDraft {
  if (key === "uiLanguage") {
    return { ...draft, uiLanguage: cycle(draft.uiLanguage, ["en-US", "zh-CN"] as const) };
  }
  if (key === "namingDefaultStyle") {
    return { ...draft, namingDefaultStyle: cycle(draft.namingDefaultStyle, ["detailed", "brief"] as const) };
  }
  if (key === "namingContextStrategy") {
    return {
      ...draft,
      namingContextStrategy: cycle(draft.namingContextStrategy, [
        "summary-signals",
        "last-user-last-assistant",
        "user-assistant-transcript",
        "user-only-transcript",
        "assistant-only-transcript",
        "user-transcript-last-assistant",
        "paired-user-turns"
      ] as const)
    };
  }
  if (key === "renameAutoApply") {
    return {
      ...draft,
      renameAutoApply: cycle(draft.renameAutoApply, ["disabled", "idle-finalize"] as const)
    };
  }
  if (key === "aiBackend") {
    return {
      ...draft,
      aiBackend: cycle(draft.aiBackend, ["codex", "openai-compatible", "none"] as const)
    };
  }
  if (key === "aiProviderSource") {
    return {
      ...draft,
      aiProviderSource: cycle(draft.aiProviderSource, ["inherit-codex", "explicit"] as const)
    };
  }
  if (key === "providerWireApi" && selectedProfile) {
    return {
      ...draft,
      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
        wireApi: cycle(selectedProfile.wireApi ?? "auto", ["auto", "responses", "chat_completions"] as const)
      })
    };
  }
  return draft;
}

export function buildSettingsFields(params: {
  draft: SettingsDraft | null;
  selectedProfile?: ProviderProfile;
  uiLanguage: UiLanguage;
  tt: SettingsTranslate;
  inline: SettingsLanguageText;
}): SettingsField[] {
  const { draft, selectedProfile, uiLanguage, tt, inline } = params;
  const profile = selectedProfile;
  return [
    { key: "uiLanguage", label: inline("界面 / 语言", "UI / Language"), value: draft?.uiLanguage ?? "" },
    { key: "namingTemplate", label: inline("命名 / 模板", "Naming / Template"), value: draft?.namingTemplate ?? "" },
    { key: "namingDefaultStyle", label: inline("命名 / 默认风格", "Naming / Default style"), value: draft?.namingDefaultStyle ?? "" },
    { key: "namingMaxLength", label: inline("命名 / 最大长度", "Naming / Max length"), value: draft?.namingMaxLength ?? "" },
    { key: "namingLanguage", label: inline("命名 / 语言", "Naming / Language"), value: draft?.namingLanguage ?? "" },
    { key: "namingContextStrategy", label: inline("命名 / 上下文策略", "Naming / Context strategy"), value: draft?.namingContextStrategy ?? "" },
    { key: "renameAutoApply", label: inline("重命名 / 自动应用", "Rename / Auto apply"), value: draft?.renameAutoApply ?? "" },
    { key: "candidateIdleSeconds", label: inline("节奏 / 候选空闲秒数", "Cadence / Candidate idle sec"), value: draft?.candidateIdleSeconds ?? "" },
    { key: "finalizeIdleSeconds", label: inline("节奏 / 终稿空闲秒数", "Cadence / Finalize idle sec"), value: draft?.finalizeIdleSeconds ?? "" },
    { key: "renameCooldownSeconds", label: inline("节奏 / 冷却秒数", "Cadence / Cooldown sec"), value: draft?.renameCooldownSeconds ?? "" },
    { key: "aiBackend", label: "AI / Backend", value: draft?.aiBackend ?? "" },
    { key: "aiProviderSource", label: inline("AI / Provider 来源", "AI / Provider source"), value: draft?.aiProviderSource ?? "" },
    { key: "aiProfile", label: "AI / Profile", value: draft?.aiProfile ?? "" },
    { key: "aiTimeoutSeconds", label: inline("AI / 超时", "AI / Timeout"), value: draft?.aiTimeoutSeconds ?? "" },
    { key: "aiTemperature", label: inline("AI / 温度", "AI / Temperature"), value: draft?.aiTemperature ?? "" },
    { key: "aiMaxConcurrency", label: inline("AI / 并发数", "AI / Max concurrency"), value: draft?.aiMaxConcurrency ?? "" },
    {
      key: "providerBaseUrl",
      label: inline(`Provider / Base URL (${profile?.profileId ?? tt("nA")})`, `Provider / baseUrl (${profile?.profileId ?? tt("nA")})`),
      value: profile?.baseUrl ?? ""
    },
    { key: "providerModel", label: inline("Provider / 模型", "Provider / model"), value: profile?.model ?? "" },
    { key: "providerApiKey", label: "Provider / API key", value: profile?.apiKey ?? "" },
    { key: "providerWireApi", label: "Provider / Wire API", value: profile?.wireApi ?? "" }
  ];
}
