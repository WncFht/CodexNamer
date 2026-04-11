import type { ConfigDocument, ConfigView, ProviderProfile } from "./types.js";
import type { UiLanguage } from "./i18n.js";

export type SettingKey =
  | "uiLanguage"
  | "namingPreset"
  | "namingTemplate"
  | "namingMaxLength"
  | "namingLanguage"
  | "namingContextStrategy"
  | "namingContextMaxChars"
  | "namingCompositionMode"
  | "namingBuilderJson"
  | "namingTagsJson"
  | "namingCustomPrompt"
  | "renameAutoApply"
  | "scanIntervalSeconds"
  | "candidateIdleSeconds"
  | "finalizeIdleSeconds"
  | "renameCooldownSeconds"
  | "maxAutoRenamesPerSession"
  | "aiBackend"
  | "aiProviderSource"
  | "aiProfile"
  | "aiTimeoutSeconds"
  | "aiTemperature"
  | "aiMaxConcurrency"
  | "maintenanceCompactMb"
  | "maintenanceCompactLines"
  | "maintenanceBackupBeforeCompact"
  | "providerBaseUrl"
  | "providerModel"
  | "providerApiKey"
  | "providerApiKeyRef"
  | "providerRef"
  | "providerWireApi";

export type SettingsDraft = {
  uiLanguage: UiLanguage;
  namingPreset: string;
  namingTemplate: string;
  namingMaxLength: string;
  namingLanguage: string;
  namingContextStrategy: string;
  namingContextMaxChars: string;
  namingCompositionMode: string;
  namingBuilderJson: string;
  namingTagsJson: string;
  namingCustomPrompt: string;
  renameAutoApply: string;
  scanIntervalSeconds: string;
  candidateIdleSeconds: string;
  finalizeIdleSeconds: string;
  renameCooldownSeconds: string;
  maxAutoRenamesPerSession: string;
  aiBackend: string;
  aiProviderSource: string;
  aiProfile: string;
  aiTimeoutSeconds: string;
  aiTemperature: string;
  aiMaxConcurrency: string;
  maintenanceCompactMb: string;
  maintenanceCompactLines: string;
  maintenanceBackupBeforeCompact: boolean;
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
type TuiRenameAutoApply = NonNullable<NonNullable<ConfigDocument["rename"]>["autoApply"]>;
type TuiNamingCompositionMode = NonNullable<NonNullable<ConfigDocument["naming"]>["compositionMode"]>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumberString(value: unknown, fallback = ""): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toJsonString(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value ?? JSON.parse(fallback), null, 0);
  } catch {
    return fallback;
  }
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

function parseJsonArray<T>(value: string, fallback: T[]): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

export function validateSettingsDraft(draft: SettingsDraft): string | null {
  try {
    const parsedBuilder = JSON.parse(draft.namingBuilderJson);
    if (!Array.isArray(parsedBuilder)) {
      return "Naming builder must be a JSON array.";
    }
  } catch {
    return "Naming builder must be valid JSON.";
  }

  try {
    const parsedTags = JSON.parse(draft.namingTagsJson);
    if (!Array.isArray(parsedTags)) {
      return "Naming tags must be a JSON array.";
    }
  } catch {
    return "Naming tags must be valid JSON.";
  }

  return null;
}

export function normalizeProfile(raw: unknown): ProviderProfile {
  const record = asRecord(raw);
  return {
    profileId: asString(record.profileId, "default"),
    requestType:
      (asString(record.requestType || record.request_type, "responses") as ProviderProfile["requestType"]) ??
      "responses",
    displayName: asString(record.displayName || record.display_name),
    providerRef: asString(record.providerRef || record.provider_ref),
    baseUrl: asString(record.baseUrl || record.base_url),
    model: asString(record.model),
    apiKey: asString(record.apiKey || record.api_key),
    apiKeyRef: asString(record.apiKeyRef || record.api_key_ref),
    headers: (record.headers as Record<string, string> | undefined) ?? {},
    enabled: asBoolean(record.enabled, true),
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
  const maintenance = asRecord(effective.maintenance);
  const profiles = Array.isArray(effective.providerProfiles) ? effective.providerProfiles.map(normalizeProfile) : [];
  const selectedProfileId = asString(
    ai.profile,
    profiles.find((item) => item.isDefault)?.profileId ?? profiles[0]?.profileId ?? "default"
  );
  const selectedProfile = profiles.find((profile) => profile.profileId === selectedProfileId) ?? profiles[0];

  return {
    uiLanguage: general.uiLanguage === "zh-CN" ? "zh-CN" : "en-US",
    namingPreset: asString(naming.preset, "conventional"),
    namingTemplate: asString(naming.template, "{{time:%m%d-%H%M}} {{kind}}{{scope_paren}}: {{summary}}"),
    namingMaxLength: asNumberString(naming.maxLength || naming.max_length, "72"),
    namingLanguage: asString(naming.language, "zh-CN"),
    namingContextStrategy: asString(naming.contextStrategy || naming.context_strategy, "summary-signals"),
    namingContextMaxChars: asNumberString(naming.contextMaxChars || naming.context_max_chars, "8000"),
    namingCompositionMode: asString(naming.compositionMode || naming.composition_mode, "structured"),
    namingBuilderJson: toJsonString(naming.builder, "[]"),
    namingTagsJson: toJsonString(naming.tags, "[]"),
    namingCustomPrompt: asString(naming.customPrompt || naming.custom_prompt),
    renameAutoApply: asString(rename.autoApply || rename.auto_apply, "idle-finalize"),
    scanIntervalSeconds: asNumberString(watch.scanIntervalSeconds || watch.scan_interval_seconds, "300"),
    candidateIdleSeconds: asNumberString(watch.candidateIdleSeconds || watch.candidate_idle_seconds, "120"),
    finalizeIdleSeconds: asNumberString(watch.finalizeIdleSeconds || watch.finalize_idle_seconds, "600"),
    renameCooldownSeconds: asNumberString(watch.renameCooldownSeconds || watch.rename_cooldown_seconds, "900"),
    maxAutoRenamesPerSession: asNumberString(watch.maxAutoRenamesPerSession || watch.max_auto_renames_per_session, "2"),
    aiBackend: asString(ai.backend, "responses"),
    aiProviderSource: asString(ai.providerSource || ai.provider_source, "codex-config"),
    aiProfile: asString(ai.profile, selectedProfileId),
    aiTimeoutSeconds: asNumberString(ai.timeoutSeconds || ai.timeout_seconds, "45"),
    aiTemperature: asNumberString(ai.temperature, "0.2"),
    aiMaxConcurrency: asNumberString(ai.maxConcurrency || ai.max_concurrency, "1"),
    maintenanceCompactMb: asNumberString(
      maintenance.suggestCompactIndexAboveMb || maintenance.suggest_compact_index_above_mb,
      "5"
    ),
    maintenanceCompactLines: asNumberString(
      maintenance.suggestCompactIndexAboveLines || maintenance.suggest_compact_index_above_lines,
      "20000"
    ),
    maintenanceBackupBeforeCompact: asBoolean(
      maintenance.backupBeforeCompact || maintenance.backup_before_compact,
      true
    ),
    providerProfiles: profiles,
    selectedProfileId: selectedProfile?.profileId ?? selectedProfileId
  };
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
      autoApply: draft.renameAutoApply as TuiRenameAutoApply
    },
    watch: {
      scanIntervalSeconds: parseNumber(draft.scanIntervalSeconds),
      candidateIdleSeconds: parseNumber(draft.candidateIdleSeconds),
      finalizeIdleSeconds: parseNumber(draft.finalizeIdleSeconds),
      renameCooldownSeconds: parseNumber(draft.renameCooldownSeconds),
      maxAutoRenamesPerSession: parseNumber(draft.maxAutoRenamesPerSession)
    },
    naming: {
      preset: stripEmpty(draft.namingPreset),
      template: stripEmpty(draft.namingTemplate),
      maxLength: parseNumber(draft.namingMaxLength),
      language: stripEmpty(draft.namingLanguage),
      contextStrategy: stripEmpty(draft.namingContextStrategy) as TuiNamingContextStrategy | undefined,
      contextMaxChars: parseNumber(draft.namingContextMaxChars),
      compositionMode: stripEmpty(draft.namingCompositionMode) as TuiNamingCompositionMode | undefined,
      builder: parseJsonArray(draft.namingBuilderJson, []),
      tags: parseJsonArray(draft.namingTagsJson, []),
      customPrompt: stripEmpty(draft.namingCustomPrompt)
    },
    ai: {
      backend: draft.aiBackend as TuiAiBackend,
      providerSource: draft.aiProviderSource as TuiProviderSource,
      profile: stripEmpty(draft.aiProfile),
      timeoutSeconds: parseNumber(draft.aiTimeoutSeconds),
      temperature: parseNumber(draft.aiTemperature),
      maxConcurrency: parseNumber(draft.aiMaxConcurrency)
    },
    maintenance: {
      suggestCompactIndexAboveMb: parseNumber(draft.maintenanceCompactMb),
      suggestCompactIndexAboveLines: parseNumber(draft.maintenanceCompactLines),
      backupBeforeCompact: draft.maintenanceBackupBeforeCompact
    },
    providerProfiles: draft.providerProfiles.map((profile) => ({
      profileId: profile.profileId,
      requestType: profile.requestType,
      displayName: stripEmpty(profile.displayName ?? ""),
      providerRef: stripEmpty(profile.providerRef ?? ""),
      baseUrl: stripEmpty(profile.baseUrl ?? ""),
      model: stripEmpty(profile.model ?? ""),
      apiKey: stripEmpty(profile.apiKey ?? ""),
      apiKeyRef: stripEmpty(profile.apiKeyRef ?? ""),
      headers: profile.headers,
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
  if (key === "namingCompositionMode") {
    return {
      ...draft,
      namingCompositionMode: cycle(draft.namingCompositionMode, ["structured", "prompt-override"] as const)
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
      aiBackend: cycle(draft.aiBackend, ["responses", "openai-compatible", "none"] as const)
    };
  }
  if (key === "aiProviderSource") {
    return {
      ...draft,
      aiProviderSource: cycle(draft.aiProviderSource, ["codex-config", "manual"] as const)
    };
  }
  if (key === "maintenanceBackupBeforeCompact") {
    return {
      ...draft,
      maintenanceBackupBeforeCompact: !draft.maintenanceBackupBeforeCompact
    };
  }
  if (key === "providerWireApi" && selectedProfile) {
    return {
      ...draft,
      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
        requestType: cycle(selectedProfile.requestType ?? "responses", ["responses", "openai-compatible"] as const)
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
  const { draft, selectedProfile, tt, inline } = params;
  const profile = selectedProfile;
  return [
    { key: "uiLanguage", label: inline("界面 / 语言", "UI / Language"), value: draft?.uiLanguage ?? "" },
    { key: "namingPreset", label: inline("命名 / Preset", "Naming / Preset"), value: draft?.namingPreset ?? "" },
    { key: "namingTemplate", label: inline("命名 / 模板", "Naming / Template"), value: draft?.namingTemplate ?? "" },
    { key: "namingMaxLength", label: inline("命名 / 最大长度", "Naming / Max length"), value: draft?.namingMaxLength ?? "" },
    { key: "namingLanguage", label: inline("命名 / 语言", "Naming / Language"), value: draft?.namingLanguage ?? "" },
    { key: "namingContextStrategy", label: inline("命名 / 上下文策略", "Naming / Context strategy"), value: draft?.namingContextStrategy ?? "" },
    { key: "namingContextMaxChars", label: inline("命名 / 上下文字数", "Naming / Context chars"), value: draft?.namingContextMaxChars ?? "" },
    { key: "namingCompositionMode", label: inline("命名 / 组合模式", "Naming / Composition mode"), value: draft?.namingCompositionMode ?? "" },
    { key: "namingBuilderJson", label: inline("命名 / Builder JSON", "Naming / Builder JSON"), value: draft?.namingBuilderJson ?? "" },
    { key: "namingTagsJson", label: inline("命名 / Tags JSON", "Naming / Tags JSON"), value: draft?.namingTagsJson ?? "" },
    { key: "namingCustomPrompt", label: inline("命名 / Prompt override", "Naming / Prompt override"), value: draft?.namingCustomPrompt ?? "" },
    { key: "renameAutoApply", label: inline("重命名 / 自动应用", "Rename / Auto apply"), value: draft?.renameAutoApply ?? "" },
    { key: "scanIntervalSeconds", label: inline("调度 / 扫描间隔", "Scheduler / Scan interval"), value: draft?.scanIntervalSeconds ?? "" },
    { key: "candidateIdleSeconds", label: inline("调度 / 候选空闲秒数", "Scheduler / Candidate idle sec"), value: draft?.candidateIdleSeconds ?? "" },
    { key: "finalizeIdleSeconds", label: inline("调度 / 终稿空闲秒数", "Scheduler / Finalize idle sec"), value: draft?.finalizeIdleSeconds ?? "" },
    { key: "renameCooldownSeconds", label: inline("调度 / 冷却秒数", "Scheduler / Cooldown sec"), value: draft?.renameCooldownSeconds ?? "" },
    { key: "maxAutoRenamesPerSession", label: inline("调度 / 单会话自动上限", "Scheduler / Max auto renames"), value: draft?.maxAutoRenamesPerSession ?? "" },
    { key: "aiBackend", label: "AI / Backend", value: draft?.aiBackend ?? "" },
    { key: "aiProviderSource", label: inline("AI / Provider 来源", "AI / Provider source"), value: draft?.aiProviderSource ?? "" },
    { key: "aiProfile", label: "AI / Profile", value: draft?.aiProfile ?? "" },
    { key: "aiTimeoutSeconds", label: inline("AI / 超时", "AI / Timeout"), value: draft?.aiTimeoutSeconds ?? "" },
    { key: "aiTemperature", label: inline("AI / 温度", "AI / Temperature"), value: draft?.aiTemperature ?? "" },
    { key: "aiMaxConcurrency", label: inline("AI / 并发数", "AI / Max concurrency"), value: draft?.aiMaxConcurrency ?? "" },
    { key: "maintenanceCompactMb", label: inline("维护 / Compact 阈值 MB", "Maintenance / Compact MB"), value: draft?.maintenanceCompactMb ?? "" },
    { key: "maintenanceCompactLines", label: inline("维护 / Compact 阈值行数", "Maintenance / Compact lines"), value: draft?.maintenanceCompactLines ?? "" },
    { key: "maintenanceBackupBeforeCompact", label: inline("维护 / Compact 前备份", "Maintenance / Backup before compact"), value: String(draft?.maintenanceBackupBeforeCompact ?? false) },
    {
      key: "providerBaseUrl",
      label: inline(`Provider / Base URL (${profile?.profileId ?? tt("nA")})`, `Provider / baseUrl (${profile?.profileId ?? tt("nA")})`),
      value: profile?.baseUrl ?? ""
    },
    { key: "providerModel", label: inline("Provider / 模型", "Provider / model"), value: profile?.model ?? "" },
    { key: "providerApiKey", label: "Provider / API key", value: profile?.apiKey ?? "" },
    { key: "providerApiKeyRef", label: "Provider / API key ref", value: profile?.apiKeyRef ?? "" },
    { key: "providerRef", label: "Provider / ref", value: profile?.providerRef ?? "" },
    { key: "providerWireApi", label: "Provider / Request type", value: profile?.requestType ?? "" }
  ];
}
