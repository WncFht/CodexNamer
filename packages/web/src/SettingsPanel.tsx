import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";

import { autoRenameStatusLabel, formatUiNumber, normalizeUiLanguage, t } from "./i18n.js";
import type {
  ConfigDocument,
  ConfigView,
  OverviewResponse,
  PromptPreviewResponse,
  ProviderProfile,
  ProviderResponse
} from "./types.js";

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
  namingComponents: Array<"tag" | "kind" | "scope" | "summary" | "project">;
  namingComponentSeparator: string;
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
type NamingComponent = "tag" | "kind" | "scope" | "summary" | "project";
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
  const allowed: NamingComponent[] = ["tag", "kind", "scope", "summary", "project"];
  const selected = raw.filter((value): value is NamingComponent => allowed.includes(value as NamingComponent));
  return selected.length > 0 ? selected : DEFAULT_NAMING_COMPONENTS;
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
    namingComponents: normalizeNamingComponents(naming.components),
    namingComponentSeparator: asString(naming.componentSeparator || naming.component_separator, " · "),
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

function encodeDraft(draft: SettingsDraft): ConfigDocument {
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
      contextStrategy: stripEmptyString(draft.namingContextStrategy) as
        | "summary-signals"
        | "user-assistant-transcript"
        | undefined,
      contextMaxChars: parseNumber(draft.namingContextMaxChars),
      compositionMode: draft.namingCompositionMode,
      components: draft.namingComponents,
      componentSeparator: draft.namingComponentSeparator,
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
      temperature: parseNumber(draft.aiTemperature)
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

function renderNamingStructurePreview(draft: SettingsDraft, uiLanguage: "en-US" | "zh-CN"): string {
  const previewTag = draft.namingTags[0] ? `#${renderTagLabel(draft.namingTags[0], uiLanguage)}` : uiLanguage === "zh-CN" ? "#标签" : "#tag";
  const componentMap: Record<NamingComponent, string> = {
    tag: previewTag,
    kind: "fix",
    scope: uiLanguage === "zh-CN" ? "settings" : "settings",
    summary: uiLanguage === "zh-CN" ? "修复设置保存与语言切换" : "fix settings save and language switching",
    project: "codex-session-manager"
  };
  return draft.namingComponents.map((component) => componentMap[component]).join(draft.namingComponentSeparator || " · ");
}

function useSettingsDraft(configView: ConfigView | null) {
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const draftRef = useRef<SettingsDraft | null>(null);

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
    const currentDraft = draftRef.current;
    if (!dirty || !currentDraft) {
      setDraft(nextDraft);
      return;
    }

    if (JSON.stringify(encodeDraft(currentDraft)) === JSON.stringify(encodeDraft(nextDraft))) {
      setDraft(nextDraft);
      setDirty(false);
    }
  }, [configView, dirty]);

  const updateDraftState: DraftStateUpdater = (updater, options) => {
    if (options?.dirty ?? true) {
      setDirty(true);
    }
    setDraft((current) => (current ? updater(current) : current));
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

function ChoiceGroup<T extends string>(props: {
  label: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
}) {
  const groupName = useId();

  return (
    <fieldset className="settings-field settings-choice-field">
      <legend>{props.label}</legend>
      <div className="settings-choice-group">
        {props.options.map((option) => (
          <label
            className={option.value === props.value ? "settings-choice active" : "settings-choice"}
            key={option.value}
          >
            <input
              checked={option.value === props.value}
              className="settings-choice-input"
              name={groupName}
              onChange={() => props.onChange(option.value)}
              type="radio"
              value={option.value}
            />
            <span>{option.label}</span>
            {option.description ? <small>{option.description}</small> : null}
          </label>
        ))}
      </div>
    </fieldset>
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
      copy: props.text.inline("解析后的环境、prompt preview、provider 结果。", "Resolved environment, prompt preview, and provider state.")
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
          onClick={() => props.onChange(section)}
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

  const namingComponentOptions: Array<{ value: NamingComponent; label: string; copy: string }> = [
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
    },
    {
      value: "project",
      label: props.text.inline("Project", "Project"),
      copy: props.text.inline("项目或工作区名。", "Project or workspace name.")
    }
  ];

  const selectedNamingComponents = props.draft.namingComponents;
  const availableNamingComponents = namingComponentOptions.filter(
    (option) => !selectedNamingComponents.includes(option.value)
  );

  const updateNamingComponents = (nextComponents: NamingComponent[]) => {
    props.updateDraftField("namingComponents", nextComponents);
  };

  return (
    <SettingsSectionFrame
      kicker={props.text.inline("Naming policy", "Naming policy")}
      title={props.text.inline("像工具面板一样配置命名，而不是写整段 prompt", "Configure naming like a control surface, not a freeform prompt")}
      copy={props.text.inline(
        "这部分参考了 SubLinkPro 的构建器思路：结构拆开、规则显式、Tag 用 dialog 编辑、右侧直接给预览。Tag 现在是 AI 命名规则预设，不再是 heuristic 分类。",
        "This section takes cues from SubLinkPro: split the structure, make rules explicit, edit tags in dialogs, and keep preview visible. Tags are now AI naming presets instead of heuristic categories."
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
            <ChoiceGroup
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
            <ChoiceGroup
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
              <input
                onChange={(event) => {
                  props.updateDraftField("namingLanguage", event.target.value);
                }}
                value={props.draft.namingLanguage}
              />
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
            <ChoiceGroup
              label={props.text.tt("contextStrategy")}
              onChange={(value) => {
                props.updateDraftField("namingContextStrategy", value);
              }}
              options={[
                {
                  value: "summary-signals",
                  label: "summary-signals",
                  description: props.text.inline("只读首条用户、末条用户、末条助手。", "Use first user, last user, and last assistant only.")
                },
                {
                  value: "user-assistant-transcript",
                  label: "user-assistant-transcript",
                  description: props.text.inline("读可见 user / assistant transcript。", "Read visible user / assistant transcript.")
                }
              ]}
              value={props.draft.namingContextStrategy as "summary-signals" | "user-assistant-transcript"}
            />
            <label className="settings-field">
              <span>{props.text.tt("contextMaxChars")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("namingContextMaxChars", event.target.value);
                }}
                value={props.draft.namingContextMaxChars}
              />
            </label>
          </div>
          <div className="settings-inline-note">
            <strong>{props.text.inline("区别", "Difference")}</strong>
            <p>
              {props.text.inline(
                "`summary-signals` 更稳、更便宜；`user-assistant-transcript` 更具体，但更依赖上下文质量。",
                "`summary-signals` is steadier and cheaper; `user-assistant-transcript` is more specific but depends more on transcript quality."
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
                  "默认推荐 `structured`。AI 返回 kind / summary / scope / tagId，后端再根据这里的组件顺序拼出最终标题。只有在需要强制个人规则时，再切到 `prompt-override`。",
                  "Prefer `structured` by default. AI returns kind / summary / scope / tagId and the backend assembles the final title using this component order. Switch to `prompt-override` only for strong personal overrides."
                )}
              </p>
            </div>
          </div>

          <div className="settings-two-up">
            <ChoiceGroup
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
            <label className="settings-field">
              <span>{props.text.inline("组件分隔符", "Component separator")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("namingComponentSeparator", event.target.value);
                }}
                value={props.draft.namingComponentSeparator}
              />
            </label>
          </div>

          <div className="settings-builder-grid">
            <div className="settings-builder-column">
              <div className="settings-builder-strip">
                <span className="settings-builder-label">{props.text.inline("可用组件", "Available components")}</span>
                <div className="settings-chip-row">
                  {availableNamingComponents.map((option) => (
                    <button
                      className="settings-builder-chip"
                      key={option.value}
                      onClick={() => {
                        updateNamingComponents([...selectedNamingComponents, option.value]);
                      }}
                      type="button"
                    >
                      + {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-builder-lane">
                {selectedNamingComponents.map((component, index) => {
                  const option = namingComponentOptions.find((item) => item.value === component);
                  if (!option) {
                    return null;
                  }
                  return (
                    <article className="settings-builder-card" key={`${component}-${index}`}>
                      <div>
                        <strong>{option.label}</strong>
                        <p>{option.copy}</p>
                      </div>
                      <div className="settings-builder-actions">
                        <button
                          className="btn-refresh"
                          disabled={index === 0}
                          onClick={() => {
                            updateNamingComponents(moveItem(selectedNamingComponents, index, index - 1));
                          }}
                          type="button"
                        >
                          {props.text.inline("上移", "Up")}
                        </button>
                        <button
                          className="btn-refresh"
                          disabled={index === selectedNamingComponents.length - 1}
                          onClick={() => {
                            updateNamingComponents(moveItem(selectedNamingComponents, index, index + 1));
                          }}
                          type="button"
                        >
                          {props.text.inline("下移", "Down")}
                        </button>
                        <button
                          className="btn-refresh"
                          disabled={selectedNamingComponents.length === 1}
                          onClick={() => {
                            updateNamingComponents(
                              selectedNamingComponents.filter((_, componentIndex) => componentIndex !== index)
                            );
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
          <details className="settings-disclosure">
            <summary>{props.text.inline("查看兼容层 template", "View legacy template")}</summary>
            <label className="settings-field settings-field-wide">
              <span>{props.text.tt("template")}</span>
              <textarea
                onChange={(event) => {
                  props.updateDraftField("namingTemplate", event.target.value);
                }}
                rows={3}
                value={props.draft.namingTemplate}
              />
            </label>
          </details>
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

  return (
    <SettingsSectionFrame
      kicker={props.text.tt("provider")}
      title={props.text.inline("选择谁来完成 AI 命名", "Choose who powers AI naming")}
      copy={props.text.inline(
        "这一层决定 rename 是走 Codex 继承链还是显式 provider profile。推荐先把 provider 解析结果看清，再改 profile。",
        "This layer decides whether rename uses the Codex inheritance chain or an explicit provider profile. Check the resolved provider first, then tune the profile."
      )}
    >
      <div className="settings-stage-grid">
        <article className="settings-surface-card">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.tt("ai")}</p>
              <h4>{props.text.inline("Backend 与来源", "Backend and source")}</h4>
            </div>
          </div>
          <div className="settings-two-up">
            <ChoiceGroup
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
            <ChoiceGroup
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
            <label className="settings-field">
              <span>{props.text.tt("timeoutSeconds")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("aiTimeoutSeconds", event.target.value);
                }}
                value={props.draft.aiTimeoutSeconds}
              />
            </label>
            <label className="settings-field">
              <span>{props.text.tt("temperature")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("aiTemperature", event.target.value);
                }}
                value={props.draft.aiTemperature}
              />
            </label>
          </div>
        </article>

        <article className="settings-surface-card">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Resolved", "Resolved")}</p>
              <h4>{props.text.inline("当前真正会命中的 provider", "The provider actually in effect")}</h4>
            </div>
          </div>
          <dl className="settings-runtime-grid">
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
          </dl>
        </article>

        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Profile editor", "Profile editor")}</p>
              <h4>{props.text.inline("显式 profile 细节", "Explicit profile details")}</h4>
            </div>
          </div>

          {selectedProfile ? (
            <>
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
                <ChoiceGroup<NonNullable<ProviderProfile["backendKind"]>>
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
                <ChoiceGroup<NonNullable<ProviderProfile["providerSource"]>>
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
                <ChoiceGroup<NonNullable<ProviderProfile["wireApi"]>>
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
          <ChoiceGroup
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
  promptPreview: PromptPreviewResponse | null;
  promptPreviewRefreshing: boolean;
  previewApplyCount: number;
  previewSuggestCount: number;
  text: TextTools;
  onRefreshPromptPreview: () => void | Promise<void>;
}) {
  const effective = asRecord(props.configView.effectiveConfig);
  const inheritedCodex = asRecord(effective.inheritedCodex);
  const promptPreviewStatus =
    props.previewApplyCount > 0 ? "apply" : props.previewSuggestCount > 0 ? "suggest" : "skip";

  return (
    <SettingsSectionFrame
      kicker={props.text.tt("runtime")}
      title={props.text.inline("运行时解析结果与真实 Prompt", "Resolved runtime state and exact prompt")}
      copy={props.text.inline(
        "这部分回答两个问题：最终到底会走哪个 provider，以及当前真正发送给 AI 的 prompt 长什么样。",
        "This section answers two questions: which provider is actually used, and what exact prompt is currently sent to the AI."
      )}
    >
      <div className="settings-stage-grid">
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

        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.tt("promptPreview")}</p>
              <h4>{props.text.inline("现在输入给 AI 的完整 prompt", "The exact prompt currently sent to AI")}</h4>
            </div>
            <button className="btn-sm" onClick={() => void props.onRefreshPromptPreview()} type="button">
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
              <dt>{props.text.inline("上下文策略", "Context strategy")}</dt>
              <dd>{props.promptPreview?.renameContext.strategy ?? props.text.tt("nA")}</dd>
            </div>
            <div>
              <dt>{props.text.inline("预览状态", "Preview status")}</dt>
              <dd>{autoRenameStatusLabel(promptPreviewStatus, props.text.uiLanguage)}</dd>
            </div>
          </dl>
          <pre className="settings-json settings-json-large">
            {props.promptPreview?.prompt ??
              (props.promptPreviewRefreshing ? props.text.tt("loadingPrompt") : props.text.tt("noPreviewLoaded"))}
          </pre>
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
  saving: boolean;
  onReload: () => void | Promise<void>;
  onRefreshPromptPreview: () => void | Promise<void>;
  onSave: (patch: ConfigDocument) => void | Promise<void>;
}) {
  const { draft, dirty, setDirty, draftRef, updateDraftState, updateDraftField } = useSettingsDraft(props.configView);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("naming");
  const uiLanguage = draft?.uiLanguage ?? normalizeUiLanguage(props.configView);
  const tt: Translate = (key) => t(uiLanguage, key);
  const inline: InlineText = (zh, en) => (uiLanguage === "zh-CN" ? zh : en);
  const text = {
    tt,
    inline,
    uiLanguage
  } satisfies TextTools;

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
            onRefreshPromptPreview={props.onRefreshPromptPreview}
            previewApplyCount={props.previewApplyCount}
            previewSuggestCount={props.previewSuggestCount}
            promptPreview={props.promptPreview}
            promptPreviewRefreshing={props.promptPreviewRefreshing}
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
          <h2>{inline("把命名策略做成可观察、可编辑、可回放的面板", "Turn naming policy into an observable, editable, replayable control panel")}</h2>
          <p>
            {inline(
              "这版设置页参考了 SubLinkPro 的做法：把复杂规则拆成卡片、builder 和 dialog，不让用户在大表单里硬写 prompt。Tag 现在是 AI 命名规则预设，保存设置时也会清空旧 candidate，避免继续复用过期标题。",
              "This settings page borrows from SubLinkPro: complex rules are broken into cards, builders, and dialogs instead of a giant prompt form. Tags are now AI naming presets, and saving config clears stale candidates so old titles are not reused."
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
        <div className="settings-stage">{renderActiveSection()}</div>
      </div>
    </section>
  );
}
