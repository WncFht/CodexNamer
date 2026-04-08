import { useEffect, useRef, useState } from "react";

import type { ConfigDocument, ConfigView, ProviderProfile } from "./types.js";

export type SettingsDraft = {
  uiLanguage: "en-US" | "zh-CN";
  namingPreset: string;
  namingTemplate: string;
  namingLanguage: string;
  namingMaxLength: string;
  namingContextStrategy: string;
  namingContextMaxChars: string;
  namingCompositionMode: "structured" | "prompt-override";
  namingBuilder: NamingBuilderItem[];
  namingTags: Array<{
    id: string;
    label: string;
    description: string;
    promptHint: string;
  }>;
  namingCustomPrompt: string;
  renameAutoApply: string;
  freezeManualName: boolean;
  scanIntervalSeconds: string;
  candidateIdleSeconds: string;
  finalizeIdleSeconds: string;
  renameCooldownSeconds: string;
  minRolloutGrowthBytes: string;
  minTaskCompleteDelta: string;
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

export type RenameAutoApply = "disabled" | "idle-finalize";
export type AiBackend = "none" | "responses" | "openai-compatible";
export type ProviderSource = "codex-config" | "manual";
export type NamingCompositionMode = "structured" | "prompt-override";
export type RenameContextStrategy =
  | "summary-signals"
  | "last-user-last-assistant"
  | "user-assistant-transcript"
  | "user-only-transcript"
  | "assistant-only-transcript"
  | "user-transcript-last-assistant"
  | "paired-user-turns";
export type NamingComponent = "timestamp" | "workspace" | "project" | "tag" | "kind" | "scope" | "summary";
export type NamingTimestampPreset = "%Y/%m/%d" | "%Y-%m-%d" | "%m/%d" | "%m-%d" | "%Y/%m/%d %H:%M" | "%H:%M";
export type NamingBuilderItem =
  | {
      type: "component";
      component: NamingComponent;
      format?: NamingTimestampPreset;
    }
  | {
      type: "separator";
      value: string;
    };

export type DraftUpdateOptions = {
  dirty?: boolean;
};

export type DraftStateUpdater = (
  updater: (current: SettingsDraft) => SettingsDraft,
  options?: DraftUpdateOptions
) => void;

export type DraftFieldUpdater = <K extends keyof SettingsDraft>(
  field: K,
  value: SettingsDraft[K],
  options?: DraftUpdateOptions
) => void;

export type SettingsTagDraft = SettingsDraft["namingTags"][number];

const DEFAULT_NAMING_COMPONENTS: NamingComponent[] = ["tag", "kind", "summary"];
export const DEFAULT_NAMING_BUILDER: NamingBuilderItem[] = [
  { type: "component", component: "tag" },
  { type: "separator", value: " · " },
  { type: "component", component: "kind" },
  { type: "separator", value: " · " },
  { type: "component", component: "summary" }
];
export const DEFAULT_TIMESTAMP_PRESET: NamingTimestampPreset = "%Y-%m-%d";
export const QUICK_SEPARATOR_OPTIONS = [
  { value: " · ", label: "·" },
  { value: " / ", label: "/" },
  { value: " | ", label: "|" },
  { value: " - ", label: "-" },
  { value: " ", label: "space" },
  { value: " · [", label: "· [" },
  { value: "] ", label: "]" },
  { value: " (", label: "(" },
  { value: ") ", label: ")" }
] as const;
export const TIMESTAMP_PRESET_OPTIONS: Array<{ value: NamingTimestampPreset; label: string }> = [
  { value: "%Y/%m/%d", label: "YYYY/MM/DD" },
  { value: "%Y-%m-%d", label: "YYYY-MM-DD" },
  { value: "%m/%d", label: "MM/DD" },
  { value: "%m-%d", label: "MM-DD" },
  { value: "%Y/%m/%d %H:%M", label: "YYYY/MM/DD HH:mm" },
  { value: "%H:%M", label: "HH:mm" }
];
const TAG_TONE_CLASSES = [
  "settings-tag-tone-0",
  "settings-tag-tone-1",
  "settings-tag-tone-2",
  "settings-tag-tone-3",
  "settings-tag-tone-4",
  "settings-tag-tone-5"
] as const;

export function asRecord(value: unknown): Record<string, unknown> {
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

function normalizeNamingComponents(raw: unknown): NamingComponent[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_NAMING_COMPONENTS;
  }
  const allowed: NamingComponent[] = ["timestamp", "workspace", "project", "tag", "kind", "scope", "summary"];
  const selected = raw.filter((value): value is NamingComponent => allowed.includes(value as NamingComponent));
  return selected.length > 0 ? selected : DEFAULT_NAMING_COMPONENTS;
}

function buildLegacyNamingBuilder(components: NamingComponent[], separator: string): NamingBuilderItem[] {
  const builder: NamingBuilderItem[] = [];
  components.forEach((component, index) => {
    builder.push({
      type: "component",
      component,
      ...(component === "timestamp" ? { format: DEFAULT_TIMESTAMP_PRESET } : {})
    });
    if (separator && index < components.length - 1) {
      builder.push({
        type: "separator",
        value: separator
      });
    }
  });
  return builder.length > 0 ? builder : DEFAULT_NAMING_BUILDER;
}

function normalizeNamingBuilder(raw: unknown, legacyComponents: NamingComponent[], legacySeparator: string): NamingBuilderItem[] {
  if (!Array.isArray(raw)) {
    return buildLegacyNamingBuilder(legacyComponents, legacySeparator);
  }

  const builder = raw
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"))
    .map((record) => {
      if (record.type === "separator" && typeof record.value === "string") {
        return {
          type: "separator" as const,
          value: record.value
        };
      }
      if (record.type === "component" && typeof record.component === "string") {
        const component = record.component as NamingComponent;
        if (!["timestamp", "workspace", "project", "tag", "kind", "scope", "summary"].includes(component)) {
          return undefined;
        }
        const format = typeof record.format === "string" ? (record.format as NamingTimestampPreset) : undefined;
        return {
          type: "component" as const,
          component,
          ...(component === "timestamp" ? { format: format ?? DEFAULT_TIMESTAMP_PRESET } : {})
        };
      }
      return undefined;
    })
    .filter((item): item is NamingBuilderItem => Boolean(item));

  return builder.length > 0 ? builder : buildLegacyNamingBuilder(legacyComponents, legacySeparator);
}

function deriveNamingComponents(builder: NamingBuilderItem[]): NamingComponent[] {
  const components = builder
    .filter((item): item is Extract<NamingBuilderItem, { type: "component" }> => item.type === "component")
    .map((item) => item.component);
  return components.length > 0 ? components : DEFAULT_NAMING_COMPONENTS;
}

function deriveNamingSeparator(builder: NamingBuilderItem[]): string | undefined {
  const separators = builder
    .filter((item): item is Extract<NamingBuilderItem, { type: "separator" }> => item.type === "separator")
    .map((item) => item.value);
  if (separators.length === 0) {
    return undefined;
  }
  const [first] = separators;
  return separators.every((value) => value === first) ? first : undefined;
}

function normalizeNamingTags(raw: unknown): SettingsDraft["namingTags"] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"))
    .map((record) => ({
      id: asString(record.id),
      label: asString(record.label),
      description: asString(record.description),
      promptHint: asString(record.promptHint || record.prompt_hint)
    }))
    .filter((tag) => tag.id.trim().length > 0);
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  if (moved === undefined) {
    return items;
  }
  next.splice(to, 0, moved);
  return next;
}

function normalizeProfile(raw: unknown): ProviderProfile {
  const record = asRecord(raw);
  return {
    profileId: asString(record.profileId, "default"),
    requestType: (asString(record.requestType || record.request_type, "responses") as ProviderProfile["requestType"]) ?? "responses",
    displayName: asString(record.displayName || record.display_name),
    providerRef: asString(record.providerRef || record.provider_ref),
    baseUrl: asString(record.baseUrl || record.base_url),
    model: asString(record.model),
    apiKey: asString(record.apiKey || record.api_key),
    apiKeyRef: asString(record.apiKeyRef || record.api_key_ref),
    headers: (record.headers as Record<string, string> | undefined) ?? {},
    enabled: asBoolean(record.enabled, true),
    isDefault: asBoolean(record.isDefault || record.is_default, false)
  };
}

export function buildDraft(configView: ConfigView): SettingsDraft {
  const effective = asRecord(configView.effectiveConfig);
  const naming = asRecord(effective.naming);
  const rename = asRecord(effective.rename);
  const watch = asRecord(effective.watch);
  const legacyNamingComponents = normalizeNamingComponents(naming.components);
  const legacyNamingSeparator = asString(naming.componentSeparator || naming.component_separator, " · ");
  const ai = asRecord(effective.ai);
  const maintenance = asRecord(effective.maintenance);
  const providerProfilesRaw = Array.isArray(effective.providerProfiles) ? effective.providerProfiles : [];
  const providerProfiles = providerProfilesRaw.map(normalizeProfile);
  const selectedProfileId = asString(
    ai.profile,
    providerProfiles.find((item) => item.isDefault)?.profileId ?? providerProfiles[0]?.profileId ?? "default"
  );

  return {
    uiLanguage: asString(asRecord(effective.general).uiLanguage, "en-US") as "en-US" | "zh-CN",
    namingPreset: asString(naming.preset, "conventional"),
    namingTemplate: asString(naming.template, "{{time:%m%d-%H%M}} {{kind}}{{scope_paren}}: {{summary}}"),
    namingLanguage: asString(naming.language, "zh-CN"),
    namingMaxLength: asNumberString(naming.maxLength || naming.max_length, "72"),
    namingContextStrategy: asString(naming.contextStrategy || naming.context_strategy, "summary-signals"),
    namingContextMaxChars: asNumberString(naming.contextMaxChars || naming.context_max_chars, "8000"),
    namingCompositionMode: asString(
      naming.compositionMode || naming.composition_mode,
      "structured"
    ) as NamingCompositionMode,
    namingBuilder: normalizeNamingBuilder(naming.builder, legacyNamingComponents, legacyNamingSeparator),
    namingTags: normalizeNamingTags(naming.tags),
    namingCustomPrompt: asString(naming.customPrompt || naming.custom_prompt),
    renameAutoApply: asString(rename.autoApply || rename.auto_apply, "idle-finalize"),
    freezeManualName: asBoolean(rename.freezeManualName || rename.freeze_manual_name, true),
    scanIntervalSeconds: asNumberString(watch.scanIntervalSeconds || watch.scan_interval_seconds, "300"),
    candidateIdleSeconds: asNumberString(watch.candidateIdleSeconds || watch.candidate_idle_seconds, "120"),
    finalizeIdleSeconds: asNumberString(watch.finalizeIdleSeconds || watch.finalize_idle_seconds, "600"),
    renameCooldownSeconds: asNumberString(watch.renameCooldownSeconds || watch.rename_cooldown_seconds, "900"),
    minRolloutGrowthBytes: asNumberString(
      watch.minRolloutGrowthBytes || watch.min_rollout_growth_bytes,
      "4096"
    ),
    minTaskCompleteDelta: asNumberString(watch.minTaskCompleteDelta || watch.min_task_complete_delta, "1"),
    maxAutoRenamesPerSession: asNumberString(
      watch.maxAutoRenamesPerSession || watch.max_auto_renames_per_session,
      "2"
    ),
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
    providerProfiles,
    selectedProfileId
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

function stripEmptyString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function firstNonEmptyString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

export function encodedConfigKey(document: ConfigDocument): string {
  return JSON.stringify(document);
}

export function isDraftDirty(draft: SettingsDraft, baseline: ConfigDocument): boolean {
  return encodedConfigKey(encodeDraft(draft)) !== encodedConfigKey(baseline);
}

export function encodeDraft(draft: SettingsDraft): ConfigDocument {
  const derivedComponents = deriveNamingComponents(draft.namingBuilder);
  const derivedSeparator = deriveNamingSeparator(draft.namingBuilder);
  return {
    general: {
      uiLanguage: draft.uiLanguage
    },
    rename: {
      autoApply: draft.renameAutoApply as RenameAutoApply,
      freezeManualName: draft.freezeManualName
    },
    watch: {
      scanIntervalSeconds: parseNumber(draft.scanIntervalSeconds),
      candidateIdleSeconds: parseNumber(draft.candidateIdleSeconds),
      finalizeIdleSeconds: parseNumber(draft.finalizeIdleSeconds),
      renameCooldownSeconds: parseNumber(draft.renameCooldownSeconds),
      minRolloutGrowthBytes: parseNumber(draft.minRolloutGrowthBytes),
      minTaskCompleteDelta: parseNumber(draft.minTaskCompleteDelta),
      maxAutoRenamesPerSession: parseNumber(draft.maxAutoRenamesPerSession)
    },
    naming: {
      preset: stripEmptyString(draft.namingPreset),
      template: stripEmptyString(draft.namingTemplate),
      language: stripEmptyString(draft.namingLanguage),
      maxLength: parseNumber(draft.namingMaxLength),
      contextStrategy: stripEmptyString(draft.namingContextStrategy) as RenameContextStrategy | undefined,
      contextMaxChars: parseNumber(draft.namingContextMaxChars),
      compositionMode: draft.namingCompositionMode,
      builder: draft.namingBuilder.map((item) =>
        item.type === "separator"
          ? {
              type: "separator" as const,
              value: item.value
            }
          : {
              type: "component" as const,
              component: item.component,
              ...(item.component === "timestamp" ? { format: item.format ?? DEFAULT_TIMESTAMP_PRESET } : {})
            }
      ),
      components: derivedComponents,
      componentSeparator: derivedSeparator,
      tags: draft.namingTags
        .map((tag) => ({
          id: tag.id.trim(),
          label: stripEmptyString(tag.label),
          description: stripEmptyString(tag.description),
          promptHint: stripEmptyString(tag.promptHint)
        }))
        .filter((tag) => tag.id.length > 0),
      customPrompt: stripEmptyString(draft.namingCustomPrompt)
    },
    ai: {
      backend: draft.aiBackend as AiBackend,
      providerSource: draft.aiProviderSource as ProviderSource,
      profile: stripEmptyString(draft.aiProfile),
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
      displayName: stripEmptyString(profile.displayName ?? ""),
      providerRef: stripEmptyString(profile.providerRef ?? ""),
      baseUrl: stripEmptyString(profile.baseUrl ?? ""),
      model: stripEmptyString(profile.model ?? ""),
      apiKey: stripEmptyString(profile.apiKey ?? ""),
      apiKeyRef: stripEmptyString(profile.apiKeyRef ?? ""),
      headers: profile.headers,
      enabled: profile.enabled,
      isDefault: profile.isDefault
    }))
  };
}

export function updateSelectedProfile(
  profiles: ProviderProfile[],
  profileId: string,
  patch: Partial<ProviderProfile>
): ProviderProfile[] {
  return profiles.map((profile) => (profile.profileId === profileId ? { ...profile, ...patch } : profile));
}

export function blankTagDraft(): SettingsTagDraft {
  return {
    id: "",
    label: "",
    description: "",
    promptHint: ""
  };
}

export function tagToneClass(index: number): string {
  return TAG_TONE_CLASSES[index % TAG_TONE_CLASSES.length] ?? TAG_TONE_CLASSES[0];
}

export function renderTagLabel(tag: SettingsTagDraft, uiLanguage: "en-US" | "zh-CN"): string {
  const explicit = tag.label.trim();
  if (explicit) {
    return explicit;
  }
  if (tag.id.trim()) {
    return tag.id.trim();
  }
  return uiLanguage === "zh-CN" ? "未命名" : "Untitled";
}

function formatPreviewTimestamp(format: NamingTimestampPreset): string {
  const sample = new Date(Date.UTC(2026, 3, 6, 14, 32));
  const replacements: Record<string, string> = {
    "%Y": String(sample.getUTCFullYear()),
    "%m": String(sample.getUTCMonth() + 1).padStart(2, "0"),
    "%d": String(sample.getUTCDate()).padStart(2, "0"),
    "%H": String(sample.getUTCHours()).padStart(2, "0"),
    "%M": String(sample.getUTCMinutes()).padStart(2, "0")
  };
  let output: string = format;
  for (const [token, value] of Object.entries(replacements)) {
    output = output.replaceAll(token, value);
  }
  return output;
}

export function renderNamingStructurePreview(draft: SettingsDraft, uiLanguage: "en-US" | "zh-CN"): string {
  const previewTag = draft.namingTags[0] ? `#${renderTagLabel(draft.namingTags[0], uiLanguage)}` : uiLanguage === "zh-CN" ? "#标签" : "#tag";
  const timestampBuilderItem = draft.namingBuilder.find(
    (item): item is { type: "component"; component: NamingComponent; format?: NamingTimestampPreset } =>
      item.type === "component" && item.component === "timestamp"
  );
  const componentMap: Record<NamingComponent, string> = {
    timestamp: formatPreviewTimestamp(timestampBuilderItem?.format ?? DEFAULT_TIMESTAMP_PRESET),
    workspace: "ai-tools",
    project: "codexnamer",
    tag: previewTag,
    kind: "fix",
    scope: "settings",
    summary: uiLanguage === "zh-CN" ? "修复设置保存与语言切换" : "fix settings save and language switching"
  };
  return draft.namingBuilder
    .map((item) => (item.type === "separator" ? item.value : componentMap[item.component]))
    .join("")
    .trim();
}

export function useSettingsDraft(configView: ConfigView | null) {
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const draftRef = useRef<SettingsDraft | null>(null);
  const baselineRef = useRef<ConfigDocument | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [dirty]);

  useEffect(() => {
    if (!configView) {
      return;
    }

    const nextDraft = buildDraft(configView);
    const nextBaseline = encodeDraft(nextDraft);
    const currentDraft = draftRef.current;
    baselineRef.current = nextBaseline;
    if (!dirty || !currentDraft) {
      setDraft(nextDraft);
      setDirty(false);
      return;
    }

    if (!isDraftDirty(currentDraft, nextBaseline)) {
      setDraft(nextDraft);
      setDirty(false);
    }
  }, [configView, dirty]);

  const updateDraftState: DraftStateUpdater = (updater, options) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const next = updater(current);
      if (options?.dirty ?? true) {
        setDirty(baselineRef.current ? isDraftDirty(next, baselineRef.current) : false);
      }
      return next;
    });
  };

  const updateDraftField: DraftFieldUpdater = (field, value, options) => {
    updateDraftState(
      (current) => ({
        ...current,
        [field]: value
      }),
      options
    );
  };

  return {
    draft,
    dirty,
    setDirty,
    draftRef,
    updateDraftState,
    updateDraftField
  };
}

export function summarizeProfileLabel(profile: ProviderProfile): string {
  return firstNonEmptyString(profile.displayName, profile.profileId, profile.model, profile.baseUrl) ?? profile.profileId;
}
