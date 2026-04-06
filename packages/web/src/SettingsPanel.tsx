import { startTransition, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { formatUiNumber, normalizeUiLanguage, t } from "./i18n.js";
import type {
  ConfigDocument,
  ConfigView,
  OverviewResponse,
  PromptPreviewResponse,
  ProviderProfile,
  ProviderResponse
} from "./types.js";
import { addAppTransitionType, AppViewTransition } from "./view-transitions.js";

type SettingsDraft = {
  uiLanguage: "en-US" | "zh-CN";
  namingPreset: string;
  namingTemplate: string;
  namingLanguage: string;
  namingDefaultStyle: "brief" | "detailed";
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
  manualOverrideWins: boolean;
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

type RenameAutoApply = "disabled" | "idle-finalize";
type AiBackend = "none" | "codex" | "openai-compatible";
type ProviderSource = "inherit-codex" | "explicit";
type NamingCompositionMode = "structured" | "prompt-override";
type RenameContextStrategy =
  | "summary-signals"
  | "last-user-last-assistant"
  | "user-assistant-transcript"
  | "user-only-transcript"
  | "assistant-only-transcript"
  | "user-transcript-last-assistant"
  | "paired-user-turns";
type NamingComponent = "timestamp" | "workspace" | "project" | "tag" | "kind" | "scope" | "summary";
type NamingTimestampPreset = "%Y/%m/%d" | "%Y-%m-%d" | "%m/%d" | "%m-%d" | "%Y/%m/%d %H:%M" | "%H:%M";
type NamingBuilderItem =
  | {
      type: "component";
      component: NamingComponent;
      format?: NamingTimestampPreset;
    }
  | {
      type: "separator";
      value: string;
    };
type SettingsSectionId = "overview" | "naming" | "ai" | "scheduler" | "runtime";
type ChoiceOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
};
type DraftUpdateOptions = {
  dirty?: boolean;
};
type DraftStateUpdater = (
  updater: (current: SettingsDraft) => SettingsDraft,
  options?: DraftUpdateOptions
) => void;
type DraftFieldUpdater = <K extends keyof SettingsDraft>(
  field: K,
  value: SettingsDraft[K],
  options?: DraftUpdateOptions
) => void;
type Translate = (key: Parameters<typeof t>[1]) => string;
type InlineText = (zh: string, en: string) => string;
type TextTools = {
  tt: Translate;
  inline: InlineText;
  uiLanguage: "en-US" | "zh-CN";
};
type SettingsTagDraft = SettingsDraft["namingTags"][number];

const DEFAULT_NAMING_COMPONENTS: NamingComponent[] = ["tag", "kind", "summary"];
const DEFAULT_NAMING_BUILDER: NamingBuilderItem[] = [
  { type: "component", component: "tag" },
  { type: "separator", value: " · " },
  { type: "component", component: "kind" },
  { type: "separator", value: " · " },
  { type: "component", component: "summary" }
];
const DEFAULT_TIMESTAMP_PRESET: NamingTimestampPreset = "%Y-%m-%d";
const QUICK_SEPARATOR_OPTIONS = [
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
const TIMESTAMP_PRESET_OPTIONS: Array<{ value: NamingTimestampPreset; label: string }> = [
  { value: "%Y/%m/%d", label: "YYYY/MM/DD" },
  { value: "%Y-%m-%d", label: "YYYY-MM-DD" },
  { value: "%m/%d", label: "MM/DD" },
  { value: "%m-%d", label: "MM-DD" },
  { value: "%Y/%m/%d %H:%M", label: "YYYY/MM/DD HH:mm" },
  { value: "%H:%M", label: "HH:mm" }
];
const SECTION_ORDER: SettingsSectionId[] = ["naming", "ai", "scheduler", "runtime", "overview"];
const TAG_TONE_CLASSES = [
  "settings-tag-tone-0",
  "settings-tag-tone-1",
  "settings-tag-tone-2",
  "settings-tag-tone-3",
  "settings-tag-tone-4",
  "settings-tag-tone-5"
] as const;

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

function moveItem<T>(items: T[], from: number, to: number): T[] {
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
    backendKind: (asString(
      record.backendKind || record.backend_kind,
      "openai-compatible"
    ) as ProviderProfile["backendKind"]) ?? "openai-compatible",
    displayName: asString(record.displayName || record.display_name),
    providerSource: (asString(
      record.providerSource || record.provider_source,
      "explicit"
    ) as ProviderProfile["providerSource"]) ?? "explicit",
    providerRef: asString(record.providerRef || record.provider_ref),
    baseUrl: asString(record.baseUrl || record.base_url),
    model: asString(record.model),
    apiKey: asString(record.apiKey || record.api_key),
    apiKeyRef: asString(record.apiKeyRef || record.api_key_ref),
    headers: (record.headers as Record<string, string> | undefined) ?? {},
    wireApi: (asString(record.wireApi || record.wire_api, "auto") as ProviderProfile["wireApi"]) ?? "auto",
    enabled: asBoolean(record.enabled, true),
    isDefault: asBoolean(record.isDefault || record.is_default, false)
  };
}

function buildDraft(configView: ConfigView): SettingsDraft {
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
    namingDefaultStyle: asString(naming.defaultStyle || naming.default_style, "detailed") as "brief" | "detailed",
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
    manualOverrideWins: asBoolean(rename.manualOverrideWins || rename.manual_override_wins, true),
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
    aiBackend: asString(ai.backend, "codex"),
    aiProviderSource: asString(ai.providerSource || ai.provider_source, "inherit-codex"),
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

function firstNonEmptyString(...values: Array<unknown>): string | undefined {
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

function encodedConfigKey(document: ConfigDocument): string {
  return JSON.stringify(document);
}

function isDraftDirty(draft: SettingsDraft, baseline: ConfigDocument): boolean {
  return encodedConfigKey(encodeDraft(draft)) !== encodedConfigKey(baseline);
}

function encodeDraft(draft: SettingsDraft): ConfigDocument {
  const derivedComponents = deriveNamingComponents(draft.namingBuilder);
  const derivedSeparator = deriveNamingSeparator(draft.namingBuilder);
  return {
    general: {
      uiLanguage: draft.uiLanguage
    },
    rename: {
      autoApply: draft.renameAutoApply as RenameAutoApply,
      manualOverrideWins: draft.manualOverrideWins,
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
      defaultStyle: draft.namingDefaultStyle,
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
      backendKind: profile.backendKind,
      displayName: stripEmptyString(profile.displayName ?? ""),
      providerSource: profile.providerSource,
      providerRef: stripEmptyString(profile.providerRef ?? ""),
      baseUrl: stripEmptyString(profile.baseUrl ?? ""),
      model: stripEmptyString(profile.model ?? ""),
      apiKey: stripEmptyString(profile.apiKey ?? ""),
      apiKeyRef: stripEmptyString(profile.apiKeyRef ?? ""),
      headers: profile.headers,
      wireApi: profile.wireApi,
      enabled: profile.enabled,
      isDefault: profile.isDefault
    }))
  };
}

function updateSelectedProfile(
  profiles: ProviderProfile[],
  profileId: string,
  patch: Partial<ProviderProfile>
): ProviderProfile[] {
  return profiles.map((profile) => (profile.profileId === profileId ? { ...profile, ...patch } : profile));
}

function blankTagDraft(): SettingsTagDraft {
  return {
    id: "",
    label: "",
    description: "",
    promptHint: ""
  };
}

function tagToneClass(index: number): string {
  return TAG_TONE_CLASSES[index % TAG_TONE_CLASSES.length] ?? TAG_TONE_CLASSES[0];
}

function renderTagLabel(tag: SettingsTagDraft, uiLanguage: "en-US" | "zh-CN"): string {
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

function renderNamingStructurePreview(draft: SettingsDraft, uiLanguage: "en-US" | "zh-CN"): string {
  const previewTag = draft.namingTags[0] ? `#${renderTagLabel(draft.namingTags[0], uiLanguage)}` : uiLanguage === "zh-CN" ? "#标签" : "#tag";
  const timestampBuilderItem = draft.namingBuilder.find(
    (item): item is { type: "component"; component: NamingComponent; format?: NamingTimestampPreset } =>
      item.type === "component" && item.component === "timestamp"
  );
  const componentMap: Record<NamingComponent, string> = {
    timestamp: formatPreviewTimestamp(timestampBuilderItem?.format ?? DEFAULT_TIMESTAMP_PRESET),
    workspace: "ai-tools",
    project: "codex-session-manager",
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

function useSettingsDraft(configView: ConfigView | null) {
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

function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="settings-field">
      <span>{props.label}</span>
      <select
        onChange={(event) => {
          props.onChange(event.target.value as T);
        }}
        value={props.value}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {props.options.find((option) => option.value === props.value)?.description ? (
        <small className="settings-field-help">
          {props.options.find((option) => option.value === props.value)?.description}
        </small>
      ) : null}
    </label>
  );
}

function SettingsHeroMetric(props: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="settings-hero-metric">
      <span className="settings-hero-metric-label">{props.label}</span>
      <strong>{props.value}</strong>
      <p>{props.detail}</p>
    </article>
  );
}

function SettingsNav(props: {
  activeSection: SettingsSectionId;
  onChange: (section: SettingsSectionId) => void;
  text: TextTools;
}) {
  const labels: Record<SettingsSectionId, { title: string; copy: string }> = {
    naming: {
      title: props.text.inline("命名策略", "Naming policy"),
      copy: props.text.inline("风格、context、组件与 tag 预设。", "Style, context, components, and tag presets.")
    },
    ai: {
      title: props.text.inline("AI 提供方", "AI provider"),
      copy: props.text.inline("backend、provider source 与 profile。", "Backend, provider source, and profiles.")
    },
    scheduler: {
      title: props.text.inline("调度阈值", "Scheduler"),
      copy: props.text.inline("auto-apply 与 scan / idle 节奏。", "Auto-apply and scan / idle cadence.")
    },
    runtime: {
      title: props.text.inline("运行时", "Runtime"),
      copy: props.text.inline("解析后的环境、provider 结果与配置路径。", "Resolved environment, provider state, and config paths.")
    },
    overview: {
      title: props.text.inline("总览", "Overview"),
      copy: props.text.inline("当前命名系统和队列的总体健康度。", "High-level health of the rename system and queue.")
    }
  };

  return (
    <nav className="settings-nav" aria-label={props.text.inline("设置分区", "Settings sections")}>
      {SECTION_ORDER.map((section) => (
        <button
          className={props.activeSection === section ? "settings-nav-item active" : "settings-nav-item"}
          key={section}
          onClick={() =>
            startTransition(() => {
              addAppTransitionType("nav-lateral");
              props.onChange(section);
            })
          }
          type="button"
        >
          <strong>{labels[section].title}</strong>
          <span>{labels[section].copy}</span>
        </button>
      ))}
    </nav>
  );
}

function SettingsSectionFrame(props: {
  kicker: string;
  title: string;
  copy: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-stage-section">
      <header className="settings-section-header">
        <div>
          <p className="panel-kicker">{props.kicker}</p>
          <h3>{props.title}</h3>
          <p className="settings-copy">{props.copy}</p>
        </div>
      </header>
      <div className="settings-section-body">{props.children}</div>
    </section>
  );
}

function TagPresetDialog(props: {
  open: boolean;
  tag: SettingsTagDraft;
  mode: "create" | "edit";
  text: TextTools;
  onClose: () => void;
  onDelete?: () => void;
  onSave: (tag: SettingsTagDraft) => void;
}) {
  const [form, setForm] = useState<SettingsTagDraft>(props.tag);

  useEffect(() => {
    setForm(props.tag);
  }, [props.tag]);

  if (!props.open) {
    return null;
  }

  const previewLabel = renderTagLabel(form, props.text.uiLanguage);

  return (
    <div className="settings-modal-backdrop" role="presentation">
      <div
        aria-labelledby="settings-tag-dialog-title"
        aria-modal="true"
        className="settings-modal"
        role="dialog"
      >
        <div className="settings-modal-header">
          <div>
            <p className="panel-kicker">{props.text.inline("AI tag 预设", "AI tag preset")}</p>
            <h4 id="settings-tag-dialog-title">
              {props.mode === "create"
                ? props.text.inline("添加 tag 预设", "Add tag preset")
                : props.text.inline("编辑 tag 预设", "Edit tag preset")}
            </h4>
          </div>
          <button className="btn-refresh" onClick={props.onClose} type="button">
            {props.text.inline("关闭", "Close")}
          </button>
        </div>

        <div className="settings-modal-body">
          <div className="settings-modal-preview">
            <span className="settings-tag-pill settings-tag-tone-1">#{previewLabel}</span>
            <p>
              {props.text.inline(
                "tag 是给 AI 的命名规则预设。结构化模式下，AI 返回 tagId，后端再按组件顺序拼出最终标题。",
                "Tags are AI-facing naming presets. In structured mode, AI returns a tagId and the backend assembles the final title from components."
              )}
            </p>
          </div>

          <div className="settings-two-up">
            <label className="settings-field">
              <span>{props.text.inline("Tag ID", "Tag ID")}</span>
              <input
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    id: event.target.value
                  }));
                }}
                value={form.id}
              />
            </label>
            <label className="settings-field">
              <span>{props.text.inline("显示标签", "Display label")}</span>
              <input
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    label: event.target.value
                  }));
                }}
                value={form.label}
              />
            </label>
          </div>

          <label className="settings-field">
            <span>{props.text.inline("预设说明", "Preset description")}</span>
            <textarea
              onChange={(event) => {
                setForm((current) => ({
                  ...current,
                  description: event.target.value
                }));
              }}
              rows={3}
              value={form.description}
            />
          </label>

          <label className="settings-field">
            <span>{props.text.inline("AI 规则提示", "AI rule hint")}</span>
            <textarea
              onChange={(event) => {
                setForm((current) => ({
                  ...current,
                  promptHint: event.target.value
                }));
              }}
              rows={4}
              value={form.promptHint}
            />
          </label>

          <div className="settings-modal-note">
            <strong>{props.text.inline("写法建议", "Authoring hint")}</strong>
            <p>
              {props.text.inline(
                "不要只写关键词。更好的写法是告诉 AI 在什么场景下选这个 tag，以及它应该突出什么主题。",
                "Do not write only keywords. Better hints explain when AI should pick this tag and what focus the tag should imply."
              )}
            </p>
          </div>
        </div>

        <div className="settings-modal-actions">
          {props.onDelete ? (
            <button className="btn-refresh danger" onClick={props.onDelete} type="button">
              {props.text.inline("删除", "Delete")}
            </button>
          ) : (
            <span />
          )}
          <div className="settings-modal-actions-right">
            <button className="btn-refresh" onClick={props.onClose} type="button">
              {props.text.inline("取消", "Cancel")}
            </button>
            <button
              className="btn-sm primary"
              disabled={!form.id.trim()}
              onClick={() =>
                props.onSave({
                  id: form.id.trim(),
                  label: form.label.trim(),
                  description: form.description.trim(),
                  promptHint: form.promptHint.trim()
                })
              }
              type="button"
            >
              {props.text.inline("保存预设", "Save preset")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NamingSection(props: {
  draft: SettingsDraft;
  text: TextTools;
  promptPreview: PromptPreviewResponse | null;
  promptPreviewRefreshing: boolean;
  draftConfig: ConfigDocument;
  onRefreshPromptPreview: (
    userConfig?: ConfigDocument,
    options?: { urgent?: boolean }
  ) => void | Promise<void>;
  onReplayRenames: (params: {
    since: string;
    basis: "session-updated-at" | "last-applied-at";
  }) => Promise<unknown>;
  updateDraftState: DraftStateUpdater;
  updateDraftField: DraftFieldUpdater;
}) {
  const [dialogState, setDialogState] = useState<
    | {
        mode: "create";
        tag: SettingsTagDraft;
      }
    | {
        mode: "edit";
        index: number;
        tag: SettingsTagDraft;
      }
    | null
  >(null);
  const [customSeparator, setCustomSeparator] = useState("");
  const [replaySince, setReplaySince] = useState("");
  const [replayBasis, setReplayBasis] = useState<"session-updated-at" | "last-applied-at">("session-updated-at");
  const [replaying, setReplaying] = useState(false);

  const namingComponentOptions: Array<{ value: NamingComponent; label: string; copy: string }> = [
    {
      value: "timestamp",
      label: props.text.inline("时间戳", "Timestamp"),
      copy: props.text.inline("按选定格式输出日期或时间。", "Render date or time using the selected format.")
    },
    {
      value: "workspace",
      label: props.text.inline("工作区", "Workspace"),
      copy: props.text.inline("工作区标签，通常来自 cwd / project。", "Workspace label, usually derived from cwd / project.")
    },
    {
      value: "project",
      label: props.text.inline("项目", "Project"),
      copy: props.text.inline("项目目录名，适合做更短的路径信号。", "Project directory name for a shorter path signal.")
    },
    {
      value: "tag",
      label: props.text.inline("Tag", "Tag"),
      copy: props.text.inline("由 AI 选择的命名预设标签。", "AI-selected naming preset tag.")
    },
    {
      value: "kind",
      label: props.text.inline("Kind", "Kind"),
      copy: props.text.inline("任务动作，例如 fix / design / review。", "Task action such as fix / design / review.")
    },
    {
      value: "scope",
      label: props.text.inline("Scope", "Scope"),
      copy: props.text.inline("主子系统或主话题。", "Primary subsystem or scope.")
    },
    {
      value: "summary",
      label: props.text.inline("Summary", "Summary"),
      copy: props.text.inline("标题正文与具体动作焦点。", "Main title body and concrete focus.")
    }
  ];
  const updateNamingBuilder = (nextBuilder: NamingBuilderItem[]) => {
    props.updateDraftField("namingBuilder", nextBuilder);
  };
  const addComponent = (component: NamingComponent) => {
    updateNamingBuilder([
      ...props.draft.namingBuilder,
      {
        type: "component",
        component,
        ...(component === "timestamp" ? { format: DEFAULT_TIMESTAMP_PRESET } : {})
      }
    ]);
  };
  const addSeparator = (separator: string) => {
    if (!separator) {
      return;
    }
    updateNamingBuilder([
      ...props.draft.namingBuilder,
      {
        type: "separator",
        value: separator
      }
    ]);
    setCustomSeparator("");
  };
  const updateBuilderItem = (index: number, item: NamingBuilderItem) => {
    updateNamingBuilder(props.draft.namingBuilder.map((current, currentIndex) => (currentIndex === index ? item : current)));
  };
  const removeBuilderItem = (index: number) => {
    updateNamingBuilder(props.draft.namingBuilder.filter((_, currentIndex) => currentIndex !== index));
  };
  const moveBuilderItem = (index: number, delta: number) => {
    updateNamingBuilder(moveItem(props.draft.namingBuilder, index, index + delta));
  };
  const contextStrategyOptions: ChoiceOption<RenameContextStrategy>[] = [
    {
      value: "summary-signals",
      label: props.text.inline("首尾摘要", "Summary signals"),
      description: props.text.inline("首条用户 + 末条用户 + 末条助手。", "First user + last user + last assistant.")
    },
    {
      value: "last-user-last-assistant",
      label: props.text.inline("最后一轮", "Last turn pair"),
      description: props.text.inline("只读最后一条用户和最后一条助手。", "Only the last user and the last assistant.")
    },
    {
      value: "user-assistant-transcript",
      label: props.text.inline("用户+助手全文", "User + assistant transcript"),
      description: props.text.inline("读可见 user / assistant message。", "Read visible user / assistant messages.")
    },
    {
      value: "user-only-transcript",
      label: props.text.inline("仅用户全文", "User-only transcript"),
      description: props.text.inline("只读用户消息，适合保留原始目标。", "Read only user messages to keep the original goal.")
    },
    {
      value: "assistant-only-transcript",
      label: props.text.inline("仅助手全文", "Assistant-only transcript"),
      description: props.text.inline("只读助手消息，适合按产出总结。", "Read only assistant messages to summarize output.")
    },
    {
      value: "user-transcript-last-assistant",
      label: props.text.inline("用户全文 + 最后助手", "User transcript + last assistant"),
      description: props.text.inline("读用户过程，再补最后一条助手总结。", "Read user history, then append the last assistant summary.")
    },
    {
      value: "paired-user-turns",
      label: props.text.inline("配对用户轮次", "Paired user turns"),
      description: props.text.inline(
        "每个用户轮次只挂前一段里最后一条有效助手结论。",
        "For each user turn, attach only the last substantive assistant from the preceding assistant cluster."
      )
    }
  ];

  return (
    <SettingsSectionFrame
      kicker={props.text.inline("Naming policy", "Naming policy")}
      title={props.text.inline("按组件和上下文控制最终标题", "Control final titles with components and context")}
      copy={props.text.inline(
        "先决定 AI 读哪些内容，再排标题组件顺序，右侧直接看结构预览和真实 prompt。",
        "Choose what the AI reads, arrange title components, and inspect both structure and prompt on the right."
      )}
    >
      <div className="settings-stage-grid settings-stage-grid-wide">
        <article className="settings-surface-card">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("基础策略", "Core policy")}</p>
              <h4>{props.text.inline("风格与语言", "Style and language")}</h4>
            </div>
          </div>
          <div className="settings-two-up">
            <SelectField
              label={props.text.tt("uiLanguage")}
              onChange={(value) => {
                props.updateDraftField("uiLanguage", value);
              }}
              options={[
                { value: "en-US", label: "English" },
                { value: "zh-CN", label: "中文" }
              ]}
              value={props.draft.uiLanguage}
            />
            <SelectField
              label={props.text.tt("defaultNamingStyle")}
              onChange={(value) => {
                props.updateDraftField("namingDefaultStyle", value);
              }}
              options={[
                { value: "detailed", label: props.text.tt("detailed") },
                { value: "brief", label: props.text.tt("brief") }
              ]}
              value={props.draft.namingDefaultStyle}
            />
            <label className="settings-field">
              <span>{props.text.tt("language")}</span>
              <select
                onChange={(event) => {
                  props.updateDraftField("namingLanguage", event.target.value);
                }}
                value={props.draft.namingLanguage}
              >
                <option value="zh-CN">zh-CN</option>
                <option value="en-US">en-US</option>
              </select>
            </label>
            <label className="settings-field">
              <span>{props.text.tt("maxLength")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("namingMaxLength", event.target.value);
                }}
                value={props.draft.namingMaxLength}
              />
            </label>
          </div>
        </article>

        <article className="settings-surface-card">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Context", "Context")}</p>
              <h4>{props.text.inline("AI 读取哪些内容", "What the AI reads")}</h4>
            </div>
          </div>
          <div className="settings-two-up">
            <SelectField
              label={props.text.tt("contextStrategy")}
              onChange={(value) => {
                props.updateDraftField("namingContextStrategy", value);
              }}
              options={contextStrategyOptions}
              value={props.draft.namingContextStrategy as RenameContextStrategy}
            />
          </div>
          <div className="settings-inline-note">
            <strong>{props.text.inline("区别与 Prompt 语言", "Difference and prompt language")}</strong>
            <p>
              {props.text.inline(
                "摘要型策略更稳；transcript 与 paired 策略更具体。Prompt 指令语言跟随界面语言，最终标题输出语言由上面的 `language` 控制。",
                "Summary strategies are steadier; transcript and paired strategies are more specific. Prompt instruction language follows the UI language, while `language` above controls the final title language."
              )}
            </p>
          </div>
        </article>

        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Naming builder", "Naming builder")}</p>
              <h4>{props.text.inline("结构化组件与最终标题预览", "Structured components and final title preview")}</h4>
              <p className="settings-copy">
                {props.text.inline(
                  "结构化模式下，AI 返回字段，后端按这里的顺序组装标题；需要强制特殊规则时再用 prompt 覆写。",
                  "In structured mode, the AI returns fields and the backend assembles the title in this order; use prompt override only for special rules."
                )}
              </p>
            </div>
          </div>

          <div className="settings-two-up">
            <SelectField
              label={props.text.inline("命名模式", "Naming mode")}
              onChange={(value) => {
                props.updateDraftField("namingCompositionMode", value as NamingCompositionMode);
              }}
              options={[
                {
                  value: "structured",
                  label: props.text.inline("结构化", "Structured"),
                  description: props.text.inline("推荐。由组件和 AI 字段共同决定。", "Recommended. Driven by components plus AI fields.")
                },
                {
                  value: "prompt-override",
                  label: props.text.inline("Prompt 覆写", "Prompt override"),
                  description: props.text.inline("高级模式。允许直接改写命名指令。", "Advanced mode. Allows direct prompt override.")
                }
              ]}
              value={props.draft.namingCompositionMode}
            />
          </div>

          <div className="settings-builder-grid">
            <div className="settings-builder-column">
              <div className="settings-builder-strip">
                <span className="settings-builder-label">{props.text.inline("可用组件", "Available components")}</span>
                <div className="settings-chip-row">
                  {namingComponentOptions.map((option) => (
                    <button
                      className="settings-builder-chip"
                      key={option.value}
                      onClick={() => {
                        addComponent(option.value);
                      }}
                      type="button"
                    >
                      + {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-builder-strip">
                <span className="settings-builder-label">{props.text.inline("快捷分隔符", "Quick separators")}</span>
                <div className="settings-chip-row">
                  {QUICK_SEPARATOR_OPTIONS.map((separator) => (
                    <button
                      className="settings-builder-chip settings-builder-chip-separator"
                      key={`${separator.label}-${separator.value}`}
                      onClick={() => {
                        addSeparator(separator.value);
                      }}
                      type="button"
                    >
                      {separator.label}
                    </button>
                  ))}
                </div>
                <div className="settings-custom-separator">
                  <input
                    onChange={(event) => {
                      setCustomSeparator(event.target.value);
                    }}
                    placeholder={props.text.inline("自定义", "Custom")}
                    value={customSeparator}
                  />
                  <button className="btn-refresh" onClick={() => addSeparator(customSeparator)} type="button">
                    {props.text.inline("添加", "Add")}
                  </button>
                </div>
              </div>

              <div className="settings-builder-lane">
                {props.draft.namingBuilder.length === 0 ? (
                  <div className="settings-empty-state">
                    {props.text.inline("先从上方添加组件或分隔符。", "Start by adding components or separators above.")}
                  </div>
                ) : null}
                {props.draft.namingBuilder.map((item, index) => {
                  const option =
                    item.type === "component"
                      ? namingComponentOptions.find((candidate) => candidate.value === item.component)
                      : undefined;

                  return (
                    <article
                      className={item.type === "separator" ? "settings-builder-card separator" : "settings-builder-card"}
                      key={`${item.type}-${index}-${item.type === "separator" ? item.value : item.component}`}
                    >
                      <div>
                        <strong>
                          {item.type === "separator"
                            ? props.text.inline(`分隔符 ${JSON.stringify(item.value)}`, `Separator ${JSON.stringify(item.value)}`)
                            : option?.label ?? item.component}
                        </strong>
                        <p>
                          {item.type === "separator"
                            ? props.text.inline("原样拼进最终标题。", "Inserted into the final title verbatim.")
                            : option?.copy}
                        </p>
                      </div>
                      <div className="settings-builder-actions">
                        {item.type === "component" && item.component === "timestamp" ? (
                          <select
                            onChange={(event) => {
                              updateBuilderItem(index, {
                                ...item,
                                format: event.target.value as NamingTimestampPreset
                              });
                            }}
                            value={item.format ?? DEFAULT_TIMESTAMP_PRESET}
                          >
                            {TIMESTAMP_PRESET_OPTIONS.map((preset) => (
                              <option key={preset.value} value={preset.value}>
                                {preset.label}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        <button
                          className="btn-refresh"
                          disabled={index === 0}
                          onClick={() => {
                            moveBuilderItem(index, -1);
                          }}
                          type="button"
                        >
                          {props.text.inline("上移", "Up")}
                        </button>
                        <button
                          className="btn-refresh"
                          disabled={index === props.draft.namingBuilder.length - 1}
                          onClick={() => {
                            moveBuilderItem(index, 1);
                          }}
                          type="button"
                        >
                          {props.text.inline("下移", "Down")}
                        </button>
                        <button
                          className="btn-refresh"
                          onClick={() => {
                            removeBuilderItem(index);
                          }}
                          type="button"
                        >
                          {props.text.inline("移除", "Remove")}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>

            <aside className="settings-preview-card">
              <span className="settings-preview-kicker">{props.text.inline("预览", "Preview")}</span>
              <strong>{renderNamingStructurePreview(props.draft, props.text.uiLanguage)}</strong>
              <p>
                {props.text.inline(
                  "这是结构化模式下的示意标题。真正运行时，Tag 由 AI 决定是否命中以及命中哪一个 preset。",
                  "This is a structural preview. At runtime, AI decides whether a tag preset applies and which preset id to return."
                )}
              </p>
            </aside>
          </div>
        </article>

        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("AI tag presets", "AI tag presets")}</p>
              <h4>{props.text.inline("像 SubLinkPro 一样把规则做成可编辑预设", "Make rules editable presets, like SubLinkPro")}</h4>
              <p className="settings-copy">
                {props.text.inline(
                  "Tag 现在不是 heuristic 分类，而是 AI 命名时可选的预设规则。你可以给 AI 明确的选择条件和输出含义，而不需要自己手写整段 prompt。",
                  "Tags are no longer heuristic classifications. They are AI-selectable presets with explicit selection criteria and output meaning, so you do not have to hand-write a full prompt."
                )}
              </p>
            </div>
            <button
              className="btn-sm"
              onClick={() => {
                setDialogState({
                  mode: "create",
                  tag: blankTagDraft()
                });
              }}
              type="button"
            >
              {props.text.inline("添加预设", "Add preset")}
            </button>
          </div>

          <div className="settings-tag-gallery">
            {props.draft.namingTags.map((tag, index) => (
              <button
                className={`settings-tag-card-button ${tagToneClass(index)}`}
                key={`${tag.id}-${index}`}
                onClick={() => {
                  setDialogState({
                    mode: "edit",
                    index,
                    tag
                  });
                }}
                type="button"
              >
                <div className="settings-tag-card-header">
                  <span className={`settings-tag-pill ${tagToneClass(index)}`}>#{renderTagLabel(tag, props.text.uiLanguage)}</span>
                  <code>{tag.id}</code>
                </div>
                <p>{tag.description || props.text.inline("还没有说明。", "No description yet.")}</p>
                <small>
                  {tag.promptHint || props.text.inline("还没有 AI 规则提示。", "No AI rule hint yet.")}
                </small>
              </button>
            ))}

            {props.draft.namingTags.length === 0 ? (
              <div className="settings-empty-state">
                {props.text.inline(
                  "还没有自定义 tag 预设。可以直接添加，也可以先用默认目录。",
                  "No custom tag presets yet. Add one now or keep the default catalog."
                )}
              </div>
            ) : null}
          </div>
        </article>

        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Override", "Override")}</p>
              <h4>{props.text.inline("给高级用户的 prompt 覆写", "Prompt override for advanced users")}</h4>
            </div>
          </div>
          <label className="settings-field">
            <span>{props.text.inline("自定义 Prompt 覆写", "Custom prompt override")}</span>
            <textarea
              onChange={(event) => {
                props.updateDraftField("namingCustomPrompt", event.target.value);
              }}
              placeholder={props.text.inline(
                "例如：始终先输出一个中文 tag，然后再写一个包含子系统和动作的标题。",
                "For example: always output a Chinese tag first, then a title with subsystem and action."
              )}
              rows={4}
              value={props.draft.namingCustomPrompt}
            />
          </label>
        </article>

        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Replay queue", "Replay queue")}</p>
              <h4>{props.text.inline("按时间把旧会话重新放回命名队列", "Requeue older sessions by time")}</h4>
              <p className="settings-copy">
                {props.text.inline(
                  "当你调整命名逻辑后，可以把某个时间点之后的会话重新标记为待命名。这个动作不会改配置，只会清空对应候选并重新入队。",
                  "After changing naming logic, you can mark sessions after a chosen time for rename replay. This does not change config; it only clears stale candidates and requeues them."
                )}
              </p>
            </div>
            <button
              className="btn-sm"
              disabled={!replaySince || replaying}
              onClick={async () => {
                if (!replaySince) {
                  return;
                }
                setReplaying(true);
                try {
                  await props.onReplayRenames({
                    since: new Date(replaySince).toISOString(),
                    basis: replayBasis
                  });
                } finally {
                  setReplaying(false);
                }
              }}
              type="button"
            >
              {replaying ? props.text.inline("重新入队中...", "Requeueing...") : props.text.inline("重新入队", "Requeue")}
            </button>
          </div>
          <div className="settings-two-up">
            <label className="settings-field">
              <span>{props.text.inline("时间起点", "Since")}</span>
              <input
                onChange={(event) => {
                  setReplaySince(event.target.value);
                }}
                type="datetime-local"
                value={replaySince}
              />
            </label>
            <SelectField
              label={props.text.inline("比较基准", "Compare against")}
              onChange={(value) => {
                setReplayBasis(value);
              }}
              options={[
                {
                  value: "session-updated-at",
                  label: props.text.inline("会话更新时间", "Session updated time")
                },
                {
                  value: "last-applied-at",
                  label: props.text.inline("上次正式命名时间", "Last applied rename time")
                }
              ]}
              value={replayBasis}
            />
          </div>
        </article>

        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.tt("promptPreview")}</p>
              <h4>{props.text.inline("命名策略实际发送给 AI 的 Prompt", "The prompt actually sent to AI for naming")}</h4>
              <p className="settings-copy">
                {props.text.inline(
                  "这里直接展示当前命名策略真实生成的 prompt。界面语言切换后，Prompt 指令语言也会跟着切换；而最终标题语言仍由上面的 `language` 控制。",
                  "This shows the prompt currently generated from the naming policy. When UI language changes, the prompt instruction language changes too; the final title language is still controlled by `language` above."
                )}
              </p>
            </div>
            <button
              className="btn-sm"
              onClick={() => void props.onRefreshPromptPreview(props.draftConfig, { urgent: true })}
              type="button"
            >
              {props.promptPreviewRefreshing ? props.text.tt("refreshing") : props.text.tt("refresh")}
            </button>
          </div>
          <dl className="settings-runtime-grid compact">
            <div>
              <dt>{props.text.inline("来源", "Source")}</dt>
              <dd>
                {props.promptPreview
                  ? props.promptPreview.synthetic
                    ? props.text.tt("promptSynthetic")
                    : props.text.tt("promptForSelected")
                  : props.text.tt("nA")}
              </dd>
            </div>
            <div>
              <dt>{props.text.inline("线程", "Thread")}</dt>
              <dd>{props.promptPreview?.threadId ?? props.text.tt("nA")}</dd>
            </div>
            <div>
              <dt>{props.text.inline("请求策略", "Requested strategy")}</dt>
              <dd>{props.promptPreview?.renameContext.requestedStrategy ?? props.text.tt("nA")}</dd>
            </div>
            <div>
              <dt>{props.text.inline("实际策略", "Resolved strategy")}</dt>
              <dd>{props.promptPreview?.renameContext.strategy ?? props.text.tt("nA")}</dd>
            </div>
            <div>
              <dt>{props.text.inline("回退原因", "Fallback reason")}</dt>
              <dd>{props.promptPreview?.renameContext.fallbackReason ?? props.text.tt("nA")}</dd>
            </div>
          </dl>
          <pre className="settings-json settings-json-large">
            {props.promptPreview?.prompt ??
              (props.promptPreviewRefreshing ? props.text.tt("loadingPrompt") : props.text.tt("noPreviewLoaded"))}
          </pre>
        </article>
      </div>

      <TagPresetDialog
        mode={dialogState?.mode ?? "create"}
        onClose={() => {
          setDialogState(null);
        }}
        onDelete={
          dialogState?.mode === "edit"
            ? () => {
                props.updateDraftState((current) => ({
                  ...current,
                  namingTags: current.namingTags.filter((_, tagIndex) => tagIndex !== dialogState.index)
                }));
                setDialogState(null);
              }
            : undefined
        }
        onSave={(tag) => {
          props.updateDraftState((current) => {
            if (dialogState?.mode === "edit") {
              return {
                ...current,
                namingTags: current.namingTags.map((item, tagIndex) =>
                  tagIndex === dialogState.index ? tag : item
                )
              };
            }
            return {
              ...current,
              namingTags: [...current.namingTags, tag]
            };
          });
          setDialogState(null);
        }}
        open={Boolean(dialogState)}
        tag={dialogState?.tag ?? blankTagDraft()}
        text={props.text}
      />
    </SettingsSectionFrame>
  );
}

function AiProviderSection(props: {
  draft: SettingsDraft;
  providers: ProviderResponse | null;
  configView: ConfigView;
  text: TextTools;
  updateDraftState: DraftStateUpdater;
  updateDraftField: DraftFieldUpdater;
}) {
  const effective = asRecord(props.configView.effectiveConfig);
  const inheritedCodex = asRecord(effective.inheritedCodex);
  const resolvedProvider = asRecord(props.providers?.resolvedProvider);
  const selectedProfile = useMemo(
    () => props.draft.providerProfiles.find((profile) => profile.profileId === props.draft.selectedProfileId),
    [props.draft]
  );
  const usingExplicitProfile = props.draft.aiProviderSource === "explicit";
  const selectedProfileLabel = usingExplicitProfile
    ? firstNonEmptyString(selectedProfile?.profileId, props.draft.aiProfile) ?? props.text.tt("nA")
    : props.text.inline("继承 Codex", "Inherited Codex");
  const selectedBaseUrl =
    firstNonEmptyString(
      ...(usingExplicitProfile
        ? [selectedProfile?.baseUrl, props.providers?.resolvedProvider?.baseUrl, inheritedCodex.baseUrl]
        : [props.providers?.resolvedProvider?.baseUrl, inheritedCodex.baseUrl, selectedProfile?.baseUrl])
    ) ?? props.text.tt("nA");
  const selectedModel =
    firstNonEmptyString(
      ...(usingExplicitProfile
        ? [selectedProfile?.model, props.providers?.resolvedProvider?.model, inheritedCodex.model]
        : [props.providers?.resolvedProvider?.model, inheritedCodex.model, selectedProfile?.model])
    ) ?? props.text.tt("nA");
  const selectedWireApi =
    firstNonEmptyString(
      ...(usingExplicitProfile
        ? [selectedProfile?.wireApi, props.providers?.resolvedProvider?.transport, inheritedCodex.wireApi]
        : [props.providers?.resolvedProvider?.transport, inheritedCodex.wireApi, selectedProfile?.wireApi])
    ) ?? props.text.tt("nA");
  const resolvedRequestedBackend = firstNonEmptyString(resolvedProvider.requestedBackend, props.draft.aiBackend) ?? props.text.tt("nA");
  const resolvedConfiguredBackend = firstNonEmptyString(resolvedProvider.configuredBackend, props.draft.aiBackend) ?? props.text.tt("nA");
  const resolvedTransport = firstNonEmptyString(resolvedProvider.preferredTransport, resolvedProvider.transport) ?? props.text.tt("nA");
  const resolvedCredential = Boolean(resolvedProvider.hasCredential)
    ? firstNonEmptyString(resolvedProvider.credentialSource, resolvedProvider.credentialKind) ?? props.text.inline("已配置", "Configured")
    : props.text.inline("未配置", "Missing");
  const directHttpLabel = Boolean(resolvedProvider.canDirectHttp)
    ? props.text.inline("可直接 HTTP", "Direct HTTP ready")
    : props.text.inline("需要回退", "Needs fallback");
  const fallbackLabel = Boolean(resolvedProvider.codexFallbackEnabled)
    ? props.text.inline("允许 codex exec 回退", "codex exec fallback enabled")
    : props.text.inline("不启用回退", "No codex fallback");
  const requestPath = [props.draft.aiBackend, props.draft.aiProviderSource, selectedProfileLabel, resolvedTransport].filter(Boolean);
  const timeoutOptions = Array.from(new Set([props.draft.aiTimeoutSeconds, "15", "30", "45", "60", "90"])).filter(Boolean);
  const temperatureOptions = Array.from(new Set([props.draft.aiTemperature, "0", "0.2", "0.4", "0.7", "1"])).filter(Boolean);

  return (
    <SettingsSectionFrame
      kicker={props.text.tt("provider")}
      title={props.text.inline("把命名请求走向讲清楚", "Make the naming request path easy to inspect")}
      copy={props.text.inline(
        "先决定默认路由，再看当前实际命中的 provider、凭证和回退路径。只有需要精调时，才编辑显式 profile。",
        "Set the default route first, then inspect the provider, credentials, and fallback path actually in effect. Edit explicit profiles only when you need fine-grained control."
      )}
    >
      <div className="settings-stage-grid settings-stage-grid-wide">
        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.tt("ai")}</p>
              <h4>{props.text.inline("默认路由与执行参数", "Default route and execution parameters")}</h4>
            </div>
          </div>
          <div className="settings-two-up">
            <SelectField
              label={props.text.tt("backend")}
              onChange={(value) => {
                props.updateDraftField("aiBackend", value);
              }}
              options={[
                { value: "codex", label: "codex" },
                { value: "openai-compatible", label: "openai-compatible" },
                { value: "none", label: "none" }
              ]}
              value={props.draft.aiBackend as AiBackend}
            />
            <SelectField
              label={props.text.tt("providerSource")}
              onChange={(value) => {
                props.updateDraftField("aiProviderSource", value);
              }}
              options={[
                { value: "inherit-codex", label: "inherit-codex" },
                { value: "explicit", label: "explicit" }
              ]}
              value={props.draft.aiProviderSource as ProviderSource}
            />
            <SelectField
              label={props.text.inline("并发数", "Max concurrency")}
              onChange={(value) => {
                props.updateDraftField("aiMaxConcurrency", value);
              }}
              options={[
                { value: "1", label: "1" },
                { value: "2", label: "2" },
                { value: "4", label: "4" },
                { value: "6", label: "6" },
                { value: "8", label: "8" }
              ]}
              value={props.draft.aiMaxConcurrency}
            />
            <label className="settings-field">
              <span>{props.text.tt("activeProfile")}</span>
              <select
                onChange={(event) => {
                  const nextProfileId = event.target.value;
                  props.updateDraftState((current) => ({
                    ...current,
                    aiProfile: nextProfileId,
                    selectedProfileId: nextProfileId
                  }));
                }}
                value={props.draft.aiProfile}
              >
                {props.draft.providerProfiles.map((profile) => (
                  <option key={profile.profileId} value={profile.profileId}>
                    {profile.profileId}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>{props.text.tt("editProfile")}</span>
              <select
                onChange={(event) => {
                  props.updateDraftField("selectedProfileId", event.target.value, {
                    dirty: false
                  });
                }}
                value={props.draft.selectedProfileId}
              >
                {props.draft.providerProfiles.map((profile) => (
                  <option key={profile.profileId} value={profile.profileId}>
                    {profile.profileId}
                  </option>
                ))}
              </select>
            </label>
            <SelectField
              label={props.text.tt("timeoutSeconds")}
              onChange={(value) => {
                props.updateDraftField("aiTimeoutSeconds", value);
              }}
              options={timeoutOptions.map((value) => ({ value, label: value }))}
              value={props.draft.aiTimeoutSeconds}
            />
            <SelectField
              label={props.text.tt("temperature")}
              onChange={(value) => {
                props.updateDraftField("aiTemperature", value);
              }}
              options={temperatureOptions.map((value) => ({ value, label: value }))}
              value={props.draft.aiTemperature}
            />
          </div>
          <div className="settings-provider-flow">
            {requestPath.map((step, index) => (
              <div className="settings-provider-step" key={`${index}-${step}`}>
                <span>{index + 1}</span>
                <strong>{step}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="settings-surface-card">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Resolved route", "Resolved route")}</p>
              <h4>{props.text.inline("当前请求会怎么走", "How requests will actually flow")}</h4>
            </div>
          </div>
          <dl className="settings-runtime-grid compact">
            <div>
              <dt>{props.text.inline("请求 backend", "Requested backend")}</dt>
              <dd>{resolvedRequestedBackend}</dd>
            </div>
            <div>
              <dt>{props.text.inline("配置 backend", "Configured backend")}</dt>
              <dd>{resolvedConfiguredBackend}</dd>
            </div>
            <div>
              <dt>{props.text.inline("传输方式", "Transport")}</dt>
              <dd>{resolvedTransport}</dd>
            </div>
            <div>
              <dt>{props.text.inline("凭证", "Credential")}</dt>
              <dd>{resolvedCredential}</dd>
            </div>
            <div>
              <dt>{props.text.inline("HTTP 直连", "Direct HTTP")}</dt>
              <dd>{directHttpLabel}</dd>
            </div>
            <div>
              <dt>{props.text.inline("回退", "Fallback")}</dt>
              <dd>{fallbackLabel}</dd>
            </div>
          </dl>
        </article>

        <article className="settings-surface-card">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Resolved target", "Resolved target")}</p>
              <h4>{props.text.inline("当前会打到哪个 provider", "Which provider is in effect right now")}</h4>
            </div>
          </div>
          <dl className="settings-runtime-grid compact">
            <div>
              <dt>{props.text.tt("selectedProfile")}</dt>
              <dd>{selectedProfileLabel}</dd>
            </div>
            <div>
              <dt>{props.text.tt("baseUrl")}</dt>
              <dd>{selectedBaseUrl}</dd>
            </div>
            <div>
              <dt>{props.text.tt("model")}</dt>
              <dd>{selectedModel}</dd>
            </div>
            <div>
              <dt>{props.text.tt("wireApi")}</dt>
              <dd>{selectedWireApi}</dd>
            </div>
            <div>
              <dt>{props.text.tt("providerRef")}</dt>
              <dd>{String(resolvedProvider.providerRef ?? selectedProfile?.providerRef ?? props.text.tt("nA"))}</dd>
            </div>
            <div>
              <dt>{props.text.inline("requires auth", "Requires auth")}</dt>
              <dd>{Boolean(resolvedProvider.requiresOpenaiAuth) ? props.text.inline("是", "Yes") : props.text.inline("否", "No")}</dd>
            </div>
          </dl>
          <details className="settings-disclosure">
            <summary>{props.text.tt("inspectResolvedProvider")}</summary>
            <pre className="settings-json">{JSON.stringify(props.providers?.resolvedProvider ?? {}, null, 2)}</pre>
          </details>
        </article>

        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Profile editor", "Profile editor")}</p>
              <h4>{props.text.inline("显式 profile 编辑器", "Explicit profile editor")}</h4>
              <p className="settings-copy">
                {props.text.inline(
                  "这里只编辑显式 profile。本区不决定当前是否启用它，真正启用入口在上面的 `provider source`。",
                  "This section edits explicit profiles only. Whether they are active is controlled above by `provider source`."
                )}
              </p>
            </div>
          </div>

          {selectedProfile ? (
            <>
              <div className="settings-provider-groups">
                <section className="settings-provider-group">
                  <div className="settings-card-header">
                    <div>
                      <p className="panel-kicker">{props.text.inline("Identity", "Identity")}</p>
                      <h4>{props.text.inline("身份与来源", "Identity and source")}</h4>
                    </div>
                  </div>
                  <div className="settings-two-up">
                    <label className="settings-field">
                      <span>{props.text.tt("displayName")}</span>
                      <input
                        onChange={(event) => {
                          props.updateDraftState((current) => ({
                            ...current,
                            providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                              displayName: event.target.value
                            })
                          }));
                        }}
                        value={selectedProfile.displayName ?? ""}
                      />
                    </label>
                    <SelectField<NonNullable<ProviderProfile["backendKind"]>>
                      label={props.text.tt("backendKind")}
                      onChange={(value) => {
                        props.updateDraftState((current) => ({
                          ...current,
                          providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                            backendKind: value
                          })
                        }));
                      }}
                      options={[
                        { value: "openai-compatible", label: "openai-compatible" },
                        { value: "codex", label: "codex" },
                        { value: "none", label: "none" }
                      ]}
                      value={selectedProfile.backendKind ?? "openai-compatible"}
                    />
                    <SelectField<NonNullable<ProviderProfile["providerSource"]>>
                      label={props.text.tt("profileSource")}
                      onChange={(value) => {
                        props.updateDraftState((current) => ({
                          ...current,
                          providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                            providerSource: value
                          })
                        }));
                      }}
                      options={[
                        { value: "explicit", label: "explicit" },
                        { value: "inherit-codex", label: "inherit-codex" }
                      ]}
                      value={selectedProfile.providerSource ?? "explicit"}
                    />
                    <label className="settings-field">
                      <span>{props.text.tt("providerRef")}</span>
                      <input
                        onChange={(event) => {
                          props.updateDraftState((current) => ({
                            ...current,
                            providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                              providerRef: event.target.value
                            })
                          }));
                        }}
                        value={selectedProfile.providerRef ?? ""}
                      />
                    </label>
                  </div>
                </section>

                <section className="settings-provider-group">
                  <div className="settings-card-header">
                    <div>
                      <p className="panel-kicker">{props.text.inline("Endpoint", "Endpoint")}</p>
                      <h4>{props.text.inline("接口与模型", "Endpoint and model")}</h4>
                    </div>
                  </div>
                  <div className="settings-two-up">
                    <label className="settings-field">
                      <span>{props.text.tt("baseUrl")}</span>
                      <input
                        onChange={(event) => {
                          props.updateDraftState((current) => ({
                            ...current,
                            providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                              baseUrl: event.target.value
                            })
                          }));
                        }}
                        value={selectedProfile.baseUrl ?? ""}
                      />
                    </label>
                    <label className="settings-field">
                      <span>{props.text.tt("model")}</span>
                      <input
                        onChange={(event) => {
                          props.updateDraftState((current) => ({
                            ...current,
                            providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                              model: event.target.value
                            })
                          }));
                        }}
                        value={selectedProfile.model ?? ""}
                      />
                    </label>
                    <SelectField<NonNullable<ProviderProfile["wireApi"]>>
                      label={props.text.tt("wireApi")}
                      onChange={(value) => {
                        props.updateDraftState((current) => ({
                          ...current,
                          providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                            wireApi: value
                          })
                        }));
                      }}
                      options={[
                        { value: "auto", label: "auto" },
                        { value: "responses", label: "responses" },
                        { value: "chat_completions", label: "chat_completions" }
                      ]}
                      value={selectedProfile.wireApi ?? "auto"}
                    />
                  </div>
                </section>

                <section className="settings-provider-group">
                  <div className="settings-card-header">
                    <div>
                      <p className="panel-kicker">{props.text.inline("Credentials", "Credentials")}</p>
                      <h4>{props.text.inline("鉴权与启停", "Authentication and toggles")}</h4>
                    </div>
                  </div>
                  <div className="settings-two-up">
                    <label className="settings-field">
                      <span>{props.text.tt("apiKey")}</span>
                      <input
                        onChange={(event) => {
                          props.updateDraftState((current) => ({
                            ...current,
                            providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                              apiKey: event.target.value
                            })
                          }));
                        }}
                        value={selectedProfile.apiKey ?? ""}
                      />
                    </label>
                    <label className="settings-field">
                      <span>{props.text.tt("apiKeyRef")}</span>
                      <input
                        onChange={(event) => {
                          props.updateDraftState((current) => ({
                            ...current,
                            providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                              apiKeyRef: event.target.value
                            })
                          }));
                        }}
                        value={selectedProfile.apiKeyRef ?? ""}
                      />
                    </label>
                  </div>
                  <div className="settings-checks">
                    <label className="toggle">
                      <input
                        checked={selectedProfile.enabled ?? true}
                        onChange={(event) => {
                          props.updateDraftState((current) => ({
                            ...current,
                            providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                              enabled: event.target.checked
                            })
                          }));
                        }}
                        type="checkbox"
                      />
                      {props.text.tt("enabled")}
                    </label>
                    <label className="toggle">
                      <input
                        checked={selectedProfile.isDefault ?? false}
                        onChange={(event) => {
                          props.updateDraftState((current) => ({
                            ...current,
                            providerProfiles: current.providerProfiles.map((profile) => ({
                              ...profile,
                              isDefault: profile.profileId === current.selectedProfileId ? event.target.checked : false
                            }))
                          }));
                        }}
                        type="checkbox"
                      />
                      {props.text.tt("defaultProfile")}
                    </label>
                  </div>
                </section>
              </div>
            </>
          ) : (
            <div className="settings-empty-state">
              {props.text.inline(
                "当前没有显式 provider profile，命名会直接使用继承的 Codex provider。",
                "No explicit provider profile is configured. Naming falls back to the inherited Codex provider."
              )}
            </div>
          )}
        </article>
      </div>
    </SettingsSectionFrame>
  );
}

function SchedulerSection(props: {
  draft: SettingsDraft;
  text: TextTools;
  updateDraftField: DraftFieldUpdater;
}) {
  return (
    <SettingsSectionFrame
      kicker={props.text.tt("scheduler")}
      title={props.text.inline("控制什么时候建议、什么时候自动应用", "Control when to suggest and when to auto-apply")}
      copy={props.text.inline(
        "这里是自动 rename 的时间阈值和保护阈值。配置层允许自动应用，但真正是否执行，还要结合运行态里的 daemon 状态一起看。",
        "These are the timing and protection thresholds for auto rename. Config can allow auto apply, but actual execution still depends on daemon runtime state."
      )}
    >
      <div className="settings-stage-grid">
        <article className="settings-surface-card">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Apply policy", "Apply policy")}</p>
              <h4>{props.text.inline("自动应用开关", "Auto-apply policy")}</h4>
            </div>
          </div>
          <SelectField
            label={props.text.tt("autoApply")}
            onChange={(value) => {
              props.updateDraftField("renameAutoApply", value);
            }}
            options={[
              { value: "disabled", label: "disabled" },
              { value: "idle-finalize", label: "idle-finalize" }
            ]}
            value={props.draft.renameAutoApply as RenameAutoApply}
          />
          <div className="settings-checks">
            <label className="toggle">
              <input
                checked={props.draft.manualOverrideWins}
                onChange={(event) => {
                  props.updateDraftField("manualOverrideWins", event.target.checked);
                }}
                type="checkbox"
              />
              {props.text.tt("manualOverrideWins")}
            </label>
            <label className="toggle">
              <input
                checked={props.draft.freezeManualName}
                onChange={(event) => {
                  props.updateDraftField("freezeManualName", event.target.checked);
                }}
                type="checkbox"
              />
              {props.text.tt("freezeManualName")}
            </label>
          </div>
        </article>

        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.tt("autoRenameWatch")}</p>
              <h4>{props.text.inline("Scan / idle 阈值", "Scan / idle thresholds")}</h4>
            </div>
          </div>
          <div className="settings-two-up">
            <label className="settings-field">
              <span>{props.text.tt("scanInterval")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("scanIntervalSeconds", event.target.value);
                }}
                value={props.draft.scanIntervalSeconds}
              />
            </label>
            <label className="settings-field">
              <span>{props.text.tt("candidateIdle")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("candidateIdleSeconds", event.target.value);
                }}
                value={props.draft.candidateIdleSeconds}
              />
            </label>
            <label className="settings-field">
              <span>{props.text.tt("finalizeIdle")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("finalizeIdleSeconds", event.target.value);
                }}
                value={props.draft.finalizeIdleSeconds}
              />
            </label>
            <label className="settings-field">
              <span>{props.text.tt("renameCooldown")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("renameCooldownSeconds", event.target.value);
                }}
                value={props.draft.renameCooldownSeconds}
              />
            </label>
            <label className="settings-field">
              <span>{props.text.tt("minRolloutGrowth")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("minRolloutGrowthBytes", event.target.value);
                }}
                value={props.draft.minRolloutGrowthBytes}
              />
            </label>
            <label className="settings-field">
              <span>{props.text.tt("minTaskDelta")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("minTaskCompleteDelta", event.target.value);
                }}
                value={props.draft.minTaskCompleteDelta}
              />
            </label>
            <label className="settings-field">
              <span>{props.text.tt("maxAutoRenames")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("maxAutoRenamesPerSession", event.target.value);
                }}
                value={props.draft.maxAutoRenamesPerSession}
              />
            </label>
          </div>
        </article>

        <article className="settings-surface-card">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.tt("housekeeping")}</p>
              <h4>{props.text.inline("压缩建议阈值", "Compaction guidance")}</h4>
            </div>
          </div>
          <div className="settings-two-up">
            <label className="settings-field">
              <span>{props.text.tt("suggestCompactMb")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("maintenanceCompactMb", event.target.value);
                }}
                value={props.draft.maintenanceCompactMb}
              />
            </label>
            <label className="settings-field">
              <span>{props.text.tt("suggestCompactLines")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("maintenanceCompactLines", event.target.value);
                }}
                value={props.draft.maintenanceCompactLines}
              />
            </label>
          </div>
          <div className="settings-checks">
            <label className="toggle">
              <input
                checked={props.draft.maintenanceBackupBeforeCompact}
                onChange={(event) => {
                  props.updateDraftField("maintenanceBackupBeforeCompact", event.target.checked);
                }}
                type="checkbox"
              />
              {props.text.tt("backupBeforeCompact")}
            </label>
          </div>
        </article>
      </div>
    </SettingsSectionFrame>
  );
}

function RuntimeSection(props: {
  configView: ConfigView;
  providers: ProviderResponse | null;
  text: TextTools;
}) {
  const effective = asRecord(props.configView.effectiveConfig);
  const inheritedCodex = asRecord(effective.inheritedCodex);

  return (
    <SettingsSectionFrame
      kicker={props.text.tt("runtime")}
      title={props.text.inline("运行时解析结果与 provider 路径", "Resolved runtime state and provider path")}
      copy={props.text.inline(
        "Prompt 已经移到命名策略区，这里只保留运行时路径、provider 解析和配置落点，方便排查真正会命中的后端。",
        "Prompt has moved into the Naming policy section. This view keeps runtime paths, provider resolution, and config locations so you can inspect the backend that is actually in effect."
      )}
    >
      <div className="settings-stage-grid settings-stage-grid-wide">
        <article className="settings-surface-card">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.tt("resolvedEnvironment")}</p>
              <h4>{props.text.inline("路径与 provider 解析", "Paths and provider resolution")}</h4>
            </div>
          </div>
          <dl className="settings-runtime-grid">
            <div>
              <dt>{props.text.tt("userConfig")}</dt>
              <dd>{props.configView.paths.userConfigPath || props.text.tt("nA")}</dd>
            </div>
            <div>
              <dt>{props.text.tt("projectOverride")}</dt>
              <dd>{props.configView.paths.projectConfigPath || props.text.tt("nA")}</dd>
            </div>
            <div>
              <dt>{props.text.tt("resolvedBackend")}</dt>
              <dd>{String(props.providers?.resolvedProvider?.resolvedBackend ?? props.text.tt("nA"))}</dd>
            </div>
            <div>
              <dt>{props.text.tt("resolvedTransport")}</dt>
              <dd>{String(props.providers?.resolvedProvider?.transport ?? props.text.tt("nA"))}</dd>
            </div>
            <div>
              <dt>{props.text.tt("inheritedModelProvider")}</dt>
              <dd>{String(inheritedCodex.modelProvider ?? props.text.tt("nA"))}</dd>
            </div>
            <div>
              <dt>{props.text.tt("inheritedModel")}</dt>
              <dd>{String(inheritedCodex.model ?? props.text.tt("nA"))}</dd>
            </div>
          </dl>
          <details className="settings-disclosure">
            <summary>{props.text.tt("inspectResolvedProvider")}</summary>
            <pre className="settings-json">{JSON.stringify(props.providers?.resolvedProvider ?? {}, null, 2)}</pre>
          </details>
        </article>
      </div>
    </SettingsSectionFrame>
  );
}

function OverviewSection(props: {
  overview: OverviewResponse | null;
  previewApplyCount: number;
  previewSuggestCount: number;
  text: TextTools;
}) {
  return (
    <SettingsSectionFrame
      kicker={props.text.tt("controlState")}
      title={props.text.inline("当前命名系统总览", "Rename system overview")}
      copy={props.text.inline(
        "这里把命名系统最关键的几个指标放在一起，方便你判断现在是策略问题、provider 问题，还是 simply 队列积压。",
        "This section puts the key rename metrics together so you can tell whether the problem is policy, provider configuration, or simply queue backlog."
      )}
    >
      <div className="settings-stage-grid settings-stage-grid-wide">
        <article className="settings-surface-card">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Queue", "Queue")}</p>
              <h4>{props.text.inline("队列健康度", "Queue health")}</h4>
            </div>
          </div>
          <dl className="settings-runtime-grid compact">
            <div>
              <dt>{props.text.tt("indexedSessions")}</dt>
              <dd>{formatUiNumber(props.overview?.sessions.total, props.text.uiLanguage)}</dd>
            </div>
            <div>
              <dt>{props.text.tt("dirtyQueue")}</dt>
              <dd>{formatUiNumber(props.overview?.sessions.dirty, props.text.uiLanguage)}</dd>
            </div>
            <div>
              <dt>{props.text.tt("candidateReady")}</dt>
              <dd>{formatUiNumber(props.previewSuggestCount, props.text.uiLanguage)}</dd>
            </div>
            <div>
              <dt>{props.text.tt("finalizeReady")}</dt>
              <dd>{formatUiNumber(props.previewApplyCount, props.text.uiLanguage)}</dd>
            </div>
          </dl>
        </article>

        <article className="settings-surface-card">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Naming", "Naming")}</p>
              <h4>{props.text.inline("正式命名与平均标题字数", "Official names and average title length")}</h4>
            </div>
          </div>
          <dl className="settings-runtime-grid compact">
            <div>
              <dt>{props.text.inline("AI 已应用", "AI applied")}</dt>
              <dd>{formatUiNumber(props.overview?.renameHistory.aiApplied, props.text.uiLanguage)}</dd>
            </div>
            <div>
              <dt>{props.text.inline("手动应用", "Manual applied")}</dt>
              <dd>{formatUiNumber(props.overview?.renameHistory.manualApplied, props.text.uiLanguage)}</dd>
            </div>
            <div>
              <dt>{props.text.inline("自动应用", "Auto applied")}</dt>
              <dd>{formatUiNumber(props.overview?.renameHistory.autoApplied, props.text.uiLanguage)}</dd>
            </div>
            <div>
              <dt>{props.text.inline("平均标题字数", "Average title length")}</dt>
              <dd>{formatUiNumber(props.overview?.workload.averageTitleLength, props.text.uiLanguage)}</dd>
            </div>
          </dl>
        </article>

        <article className="settings-surface-card">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Runtime", "Runtime")}</p>
              <h4>{props.text.inline("当前执行态", "Current execution state")}</h4>
            </div>
          </div>
          <dl className="settings-runtime-grid compact">
            <div>
              <dt>{props.text.inline("配置", "Configured")}</dt>
              <dd>{props.overview?.runtime.configuredAutoApply ?? props.text.tt("nA")}</dd>
            </div>
            <div>
              <dt>{props.text.inline("实际执行", "Actual execution")}</dt>
              <dd>{props.overview?.runtime.actualExecution ?? props.text.tt("nA")}</dd>
            </div>
            <div>
              <dt>{props.text.inline("Daemon", "Daemon")}</dt>
              <dd>{props.overview?.runtime.daemonStatus ?? props.text.tt("nA")}</dd>
            </div>
            <div>
              <dt>{props.text.inline("最近 sweep", "Last sweep")}</dt>
              <dd>{props.overview?.runtime.lastSweepAt ?? props.text.tt("nA")}</dd>
            </div>
          </dl>
        </article>
      </div>
    </SettingsSectionFrame>
  );
}

export function SettingsPanel(props: {
  configView: ConfigView | null;
  overview: OverviewResponse | null;
  previewApplyCount: number;
  previewSuggestCount: number;
  providers: ProviderResponse | null;
  promptPreview: PromptPreviewResponse | null;
  promptPreviewRefreshing: boolean;
  selectedThreadId?: string;
  saving: boolean;
  onReload: () => void | Promise<void>;
  onRefreshPromptPreview: (
    userConfig?: ConfigDocument,
    options?: { urgent?: boolean }
  ) => void | Promise<void>;
  onReplayRenames: (params: {
    since: string;
    basis: "session-updated-at" | "last-applied-at";
  }) => Promise<unknown>;
  onSave: (patch: ConfigDocument) => void | Promise<void>;
}) {
  const { draft, dirty, setDirty, draftRef, updateDraftState, updateDraftField } = useSettingsDraft(props.configView);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("naming");
  const uiLanguage = draft?.uiLanguage ?? normalizeUiLanguage(props.configView);
  const tt: Translate = (key) => t(uiLanguage, key);
  const inline: InlineText = (zh, en) => (uiLanguage === "zh-CN" ? zh : en);
  const previewDraft = useMemo(() => (draft ? encodeDraft(draft) : null), [draft]);
  const previewDraftKey = useMemo(() => (previewDraft ? encodedConfigKey(previewDraft) : ""), [previewDraft]);
  const refreshPromptPreviewRef = useRef(props.onRefreshPromptPreview);
  const text = {
    tt,
    inline,
    uiLanguage
  } satisfies TextTools;

  useEffect(() => {
    refreshPromptPreviewRef.current = props.onRefreshPromptPreview;
  }, [props.onRefreshPromptPreview]);

  useEffect(() => {
    if (!previewDraft) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void refreshPromptPreviewRef.current(previewDraft, {
        urgent: false
      });
    }, 180);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [previewDraft, previewDraftKey, props.selectedThreadId]);

  if (!props.configView || !draft) {
    return (
      <section className="settings-layout">
        <div className="history-empty">{inline("正在加载设置...", "Loading settings...")}</div>
      </section>
    );
  }

  const configView = props.configView;
  const loadedDraft = draft;

  const handleSave = async () => {
    const currentDraft = draftRef.current;
    if (!currentDraft) {
      return;
    }
    await props.onSave(encodeDraft(currentDraft));
  };

  const renderActiveSection = () => {
    switch (activeSection) {
      case "naming":
        return (
          <NamingSection
            draft={loadedDraft}
            draftConfig={previewDraft ?? encodeDraft(loadedDraft)}
            onRefreshPromptPreview={props.onRefreshPromptPreview}
            onReplayRenames={props.onReplayRenames}
            promptPreview={props.promptPreview}
            promptPreviewRefreshing={props.promptPreviewRefreshing}
            text={text}
            updateDraftField={updateDraftField}
            updateDraftState={updateDraftState}
          />
        );
      case "ai":
        return (
          <AiProviderSection
            configView={configView}
            draft={loadedDraft}
            providers={props.providers}
            text={text}
            updateDraftField={updateDraftField}
            updateDraftState={updateDraftState}
          />
        );
      case "scheduler":
        return <SchedulerSection draft={loadedDraft} text={text} updateDraftField={updateDraftField} />;
      case "runtime":
        return (
          <RuntimeSection
            configView={configView}
            providers={props.providers}
            text={text}
          />
        );
      case "overview":
        return (
          <OverviewSection
            overview={props.overview}
            previewApplyCount={props.previewApplyCount}
            previewSuggestCount={props.previewSuggestCount}
            text={text}
          />
        );
      default:
        return null;
    }
  };

  return (
    <section className="settings-layout">
      <header className="settings-hero">
        <div className="settings-hero-copy">
          <p className="panel-kicker">{inline("Control Surface", "Control surface")}</p>
          <h2>{inline("把命名策略做成可调的控制面板", "Make naming policy a controllable panel")}</h2>
          <p>
            {inline(
              "在这里调整 context、标题组件、tag 规则和 provider，并直接查看预览和实际 prompt。",
              "Adjust context, title components, tag rules, and providers here, then inspect the preview and the real prompt."
            )}
          </p>
        </div>

        <div className="settings-hero-actions">
          <button
            className="btn-refresh"
            onClick={() => {
              setDirty(false);
              void props.onReload();
            }}
            type="button"
          >
            {tt("reload")}
          </button>
          <button className="btn-sm primary" disabled={!dirty || props.saving} onClick={() => void handleSave()} type="button">
            {props.saving ? tt("savingSettings") : tt("saveSettings")}
          </button>
        </div>

        <div className="settings-hero-grid">
          <SettingsHeroMetric
            detail={inline(
              `${formatUiNumber(props.previewSuggestCount, uiLanguage)} 个 suggest / ${formatUiNumber(props.previewApplyCount, uiLanguage)} 个 apply`,
              `${formatUiNumber(props.previewSuggestCount, uiLanguage)} suggest / ${formatUiNumber(props.previewApplyCount, uiLanguage)} apply`
            )}
            label={tt("dirtyQueue")}
            value={formatUiNumber(props.overview?.sessions.dirty, uiLanguage)}
          />
          <SettingsHeroMetric
            detail={inline(
              `${formatUiNumber(props.overview?.renameHistory.autoApplied, uiLanguage)} 个自动应用`,
              `${formatUiNumber(props.overview?.renameHistory.autoApplied, uiLanguage)} auto applied`
            )}
            label={tt("aiApplied")}
            value={formatUiNumber(props.overview?.renameHistory.aiApplied, uiLanguage)}
          />
          <SettingsHeroMetric
            detail={inline(
              `${formatUiNumber(props.overview?.sessions.named, uiLanguage)} 个正式标题参与统计`,
              `${formatUiNumber(props.overview?.sessions.named, uiLanguage)} official titles in sample`
            )}
            label={inline("平均标题字数", "Average title length")}
            value={formatUiNumber(props.overview?.workload.averageTitleLength, uiLanguage)}
          />
          <SettingsHeroMetric
            detail={props.overview?.runtime.explain ?? tt("nA")}
            label={inline("当前执行态", "Execution")}
            value={props.overview?.runtime.actualExecution ?? tt("nA")}
          />
        </div>
      </header>

      <div className="settings-shell">
        <SettingsNav activeSection={activeSection} onChange={setActiveSection} text={text} />
        <div className="settings-stage">
          <AppViewTransition default="none" enter="fade-in" exit="fade-out" key={activeSection}>
            {renderActiveSection()}
          </AppViewTransition>
        </div>
      </div>
    </section>
  );
}
