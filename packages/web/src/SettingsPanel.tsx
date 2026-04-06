import { useEffect, useId, useMemo, useRef, useState } from "react";

import { autoRenameStatusLabel, formatUiNumber, normalizeUiLanguage, t } from "./i18n.js";
import type { ConfigDocument, ConfigView, OverviewResponse, ProviderProfile, ProviderResponse } from "./types.js";
import type { PromptPreviewResponse } from "./types.js";

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
type ChoiceOption<T extends string> = {
  value: T;
  label: string;
};

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
    return ["tag", "kind", "summary"];
  }
  const allowed: NamingComponent[] = ["tag", "kind", "scope", "summary", "project"];
  const selected = raw.filter((value): value is NamingComponent => allowed.includes(value as NamingComponent));
  return selected.length > 0 ? selected : ["tag", "kind", "summary"];
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
    backendKind: (asString(record.backendKind || record.backend_kind, "openai-compatible") as ProviderProfile["backendKind"]) ?? "openai-compatible",
    displayName: asString(record.displayName || record.display_name),
    providerSource: (asString(record.providerSource || record.provider_source, "explicit") as ProviderProfile["providerSource"]) ?? "explicit",
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
  const selectedProfileId = asString(ai.profile, providerProfiles.find((item) => item.isDefault)?.profileId ?? providerProfiles[0]?.profileId ?? "default");

  return {
    uiLanguage: asString(asRecord(effective.general).uiLanguage, "en-US") as "en-US" | "zh-CN",
    namingPreset: asString(naming.preset, "conventional"),
    namingTemplate: asString(naming.template, "{{time:%m%d-%H%M}} {{kind}}{{scope_paren}}: {{summary}}"),
    namingLanguage: asString(naming.language, "zh-CN"),
    namingDefaultStyle: (asString(naming.defaultStyle || naming.default_style, "detailed") as "brief" | "detailed"),
    namingMaxLength: asNumberString(naming.maxLength || naming.max_length, "72"),
    namingContextStrategy: asString(
      naming.contextStrategy || naming.context_strategy,
      "summary-signals"
    ),
    namingContextMaxChars: asNumberString(
      naming.contextMaxChars || naming.context_max_chars,
      "8000"
    ),
    namingCompositionMode: asString(
      naming.compositionMode || naming.composition_mode,
      "structured"
    ) as NamingCompositionMode,
    namingComponents: normalizeNamingComponents(naming.components),
    namingComponentSeparator: asString(
      naming.componentSeparator || naming.component_separator,
      " · "
    ),
    namingTags: normalizeNamingTags(naming.tags),
    namingCustomPrompt: asString(naming.customPrompt || naming.custom_prompt),
    renameAutoApply: asString(rename.autoApply || rename.auto_apply, "idle-finalize"),
    manualOverrideWins: asBoolean(rename.manualOverrideWins || rename.manual_override_wins, true),
    freezeManualName: asBoolean(rename.freezeManualName || rename.freeze_manual_name, true),
    scanIntervalSeconds: asNumberString(watch.scanIntervalSeconds || watch.scan_interval_seconds, "300"),
    candidateIdleSeconds: asNumberString(watch.candidateIdleSeconds || watch.candidate_idle_seconds, "120"),
    finalizeIdleSeconds: asNumberString(watch.finalizeIdleSeconds || watch.finalize_idle_seconds, "600"),
    renameCooldownSeconds: asNumberString(watch.renameCooldownSeconds || watch.rename_cooldown_seconds, "900"),
    minRolloutGrowthBytes: asNumberString(watch.minRolloutGrowthBytes || watch.min_rollout_growth_bytes, "4096"),
    minTaskCompleteDelta: asNumberString(watch.minTaskCompleteDelta || watch.min_task_complete_delta, "1"),
    maxAutoRenamesPerSession: asNumberString(watch.maxAutoRenamesPerSession || watch.max_auto_renames_per_session, "2"),
    aiBackend: asString(ai.backend, "codex"),
    aiProviderSource: asString(ai.providerSource || ai.provider_source, "inherit-codex"),
    aiProfile: asString(ai.profile, selectedProfileId),
    aiTimeoutSeconds: asNumberString(ai.timeoutSeconds || ai.timeout_seconds, "45"),
    aiTemperature: asNumberString(ai.temperature, "0.2"),
    maintenanceCompactMb: asNumberString(maintenance.suggestCompactIndexAboveMb || maintenance.suggest_compact_index_above_mb, "5"),
    maintenanceCompactLines: asNumberString(maintenance.suggestCompactIndexAboveLines || maintenance.suggest_compact_index_above_lines, "20000"),
    maintenanceBackupBeforeCompact: asBoolean(maintenance.backupBeforeCompact || maintenance.backup_before_compact, true),
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
      compositionMode: draft.namingCompositionMode as NamingCompositionMode,
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
          </label>
        ))}
      </div>
    </fieldset>
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
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const draftRef = useRef<SettingsDraft | null>(null);
  const effective = asRecord(props.configView?.effectiveConfig);
  const inheritedCodex = asRecord(effective.inheritedCodex);
  const uiLanguage = draft?.uiLanguage ?? normalizeUiLanguage(props.configView);
  const tt = (key: Parameters<typeof t>[1]) => t(uiLanguage, key);
  const inline = (zh: string, en: string) => (uiLanguage === "zh-CN" ? zh : en);
  const updateDraftState = (
    updater: (current: SettingsDraft) => SettingsDraft,
    options?: {
      dirty?: boolean;
    }
  ) => {
    if (options?.dirty ?? true) {
      setDirty(true);
    }
    setDraft((current) => (current ? updater(current) : current));
  };
  const updateDraftField = <K extends keyof SettingsDraft>(
    field: K,
    value: SettingsDraft[K],
    options?: {
      dirty?: boolean;
    }
  ) => {
    updateDraftState(
      (current) => ({
        ...current,
        [field]: value
      }),
      options
    );
  };

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
    if (!props.configView) {
      return;
    }

    const nextDraft = buildDraft(props.configView);
    const currentDraft = draftRef.current;
    if (!dirty || !currentDraft) {
      setDraft(nextDraft);
      return;
    }

    if (JSON.stringify(encodeDraft(currentDraft)) === JSON.stringify(encodeDraft(nextDraft))) {
      setDraft(nextDraft);
      setDirty(false);
    }
  }, [dirty, props.configView]);

  const selectedProfile = useMemo(
    () => draft?.providerProfiles.find((profile) => profile.profileId === draft.selectedProfileId),
    [draft]
  );
  const usingExplicitProfile = draft?.aiProviderSource === "explicit";
  const selectedProfileLabel = usingExplicitProfile
    ? firstNonEmptyString(selectedProfile?.profileId, draft?.aiProfile) ?? tt("nA")
    : inline("继承 Codex", "Inherited Codex");
  const selectedBaseUrl =
    firstNonEmptyString(
      ...(usingExplicitProfile
        ? [selectedProfile?.baseUrl, props.providers?.resolvedProvider?.baseUrl, inheritedCodex.baseUrl]
        : [props.providers?.resolvedProvider?.baseUrl, inheritedCodex.baseUrl, selectedProfile?.baseUrl])
    ) ?? tt("nA");
  const selectedModel =
    firstNonEmptyString(
      ...(usingExplicitProfile
        ? [selectedProfile?.model, props.providers?.resolvedProvider?.model, inheritedCodex.model]
        : [props.providers?.resolvedProvider?.model, inheritedCodex.model, selectedProfile?.model])
    ) ?? tt("nA");
  const selectedWireApi =
    firstNonEmptyString(
      ...(usingExplicitProfile
        ? [selectedProfile?.wireApi, props.providers?.resolvedProvider?.transport, inheritedCodex.wireApi]
        : [props.providers?.resolvedProvider?.transport, inheritedCodex.wireApi, selectedProfile?.wireApi])
    ) ?? tt("nA");
  const promptPreviewStatus =
    props.previewApplyCount > 0 ? "apply" : props.previewSuggestCount > 0 ? "suggest" : "skip";
  const namingComponentOptions: Array<{ value: NamingComponent; label: string; copy: string }> = [
    {
      value: "tag",
      label: inline("Tag", "Tag"),
      copy: inline("分类标签，例如 #设置 / #Prompt", "Classification tag such as #settings / #prompt")
    },
    {
      value: "kind",
      label: inline("Kind", "Kind"),
      copy: inline("任务类型，如 fix / design / review", "Task kind such as fix / design / review")
    },
    {
      value: "scope",
      label: inline("Scope", "Scope"),
      copy: inline("主话题或子系统范围", "Primary topic or subsystem scope")
    },
    {
      value: "summary",
      label: inline("Summary", "Summary"),
      copy: inline("核心标题正文", "Core title summary")
    },
    {
      value: "project",
      label: inline("Project", "Project"),
      copy: inline("项目或 cwd 名称", "Project or cwd name")
    }
  ];
  if (!props.configView || !draft) {
    return (
      <section className="settings-layout">
        <div className="history-empty">{inline("正在加载设置...", "Loading settings...")}</div>
      </section>
    );
  }

  const selectedNamingComponents = draft.namingComponents;
  const availableNamingComponents = namingComponentOptions.filter(
    (option) => !selectedNamingComponents.includes(option.value)
  );
  const updateNamingComponents = (nextComponents: NamingComponent[]) => {
    updateDraftField("namingComponents", nextComponents);
  };

  return (
    <section className="settings-layout">
      <header className="settings-header">
        <div>
          <h2>{tt("settings")}</h2>
          <p>{inline("在这里配置命名规则、自动重命名节奏，以及建议命名所使用的 AI 与提供方配置。", "Configure naming rules, auto-rename cadence, and the AI/provider profile used for suggestions.")}</p>
        </div>
        <div className="header-actions">
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
          <button
            className="btn-sm primary"
            disabled={!dirty || props.saving}
            onClick={() => {
              void (async () => {
                const currentDraft = draftRef.current;
                if (!currentDraft) {
                  return;
                }
                await props.onSave(encodeDraft(currentDraft));
              })();
            }}
            type="button"
          >
            {props.saving ? tt("savingSettings") : tt("saveSettings")}
          </button>
        </div>
      </header>

      <div className="settings-grid">
        <section className="detail-panel settings-panel settings-overview-panel settings-span-wide">
          <div className="settings-overview-header">
            <div>
              <p className="panel-kicker">{tt("controlState")}</p>
              <h3>{tt("renameActivity")}</h3>
              <p className="settings-copy">
                {inline("这里追踪当前 dirty 会话数量、已经应用的名字数量，以及 AI 真正参与落盘命名的频率。", "This panel tracks how many sessions are currently dirty, how many names have already been applied, and how often AI is actually being used to land final names.")}
              </p>
            </div>
          </div>

          <div className="settings-metrics-grid">
            <article className="metric-card">
              <span className="metric-label">{tt("indexedSessions")}</span>
              <strong>{formatUiNumber(props.overview?.sessions.total, uiLanguage)}</strong>
              <p>
                {formatUiNumber(props.overview?.sessions.workspaces, uiLanguage)} {tt("workspaces")}, {formatUiNumber(props.overview?.sessions.named, uiLanguage)} {inline("已命名", "named")}
              </p>
            </article>
            <article className="metric-card">
              <span className="metric-label">{tt("dirtyQueue")}</span>
              <strong>{formatUiNumber(props.overview?.sessions.dirty, uiLanguage)}</strong>
              <p>
                {formatUiNumber(props.previewSuggestCount, uiLanguage)} {tt("candidateReady")}, {formatUiNumber(props.previewApplyCount, uiLanguage)} {tt("finalizeReady")}
              </p>
            </article>
            <article className="metric-card">
              <span className="metric-label">{tt("aiApplied")}</span>
              <strong>{formatUiNumber(props.overview?.renameHistory.aiApplied, uiLanguage)}</strong>
              <p>
                {formatUiNumber(props.overview?.renameHistory.autoApplied, uiLanguage)} {inline("自动应用", "auto-applied")}, {formatUiNumber(props.overview?.renameHistory.applied, uiLanguage)} {inline("总应用", "total applied")}
              </p>
            </article>
            <article className="metric-card">
              <span className="metric-label">{inline("平均标题字数", "Average title length")}</span>
              <strong>{formatUiNumber(props.overview?.workload.averageTitleLength, uiLanguage)}</strong>
              <p>
                {formatUiNumber(props.overview?.sessions.named, uiLanguage)} {inline("个正式标题参与统计", "official titles in sample")}
              </p>
            </article>
            <article className="metric-card">
              <span className="metric-label">{tt("manualControls")}</span>
              <strong>{formatUiNumber(props.overview?.sessions.manualOverride, uiLanguage)}</strong>
              <p>
                {formatUiNumber(props.overview?.sessions.frozen, uiLanguage)} {tt("frozen")}, {formatUiNumber(props.overview?.renameHistory.manualApplied, uiLanguage)} {inline("手动应用", "manual applies")}
              </p>
            </article>
          </div>

          <div className="settings-overview-detail">
            <article className="settings-mini-panel">
              <p className="panel-kicker">{tt("pipeline")}</p>
              <dl className="settings-inline-stats">
                <div><dt>{inline("活跃", "Active")}</dt><dd>{formatUiNumber(props.overview?.pipeline.active, uiLanguage)}</dd></div>
                <div><dt>{tt("candidateReady")}</dt><dd>{formatUiNumber(props.overview?.pipeline.candidateReady, uiLanguage)}</dd></div>
                <div><dt>{tt("finalizeReady")}</dt><dd>{formatUiNumber(props.overview?.pipeline.finalizeReady, uiLanguage)}</dd></div>
                <div><dt>{inline("已应用", "Applied")}</dt><dd>{formatUiNumber(props.overview?.pipeline.applied, uiLanguage)}</dd></div>
              </dl>
            </article>
            <article className="settings-mini-panel">
              <p className="panel-kicker">{tt("renameSources")}</p>
              <dl className="settings-inline-stats">
                <div><dt>AI</dt><dd>{formatUiNumber(props.overview?.renameHistory.aiApplied, uiLanguage)}</dd></div>
                <div><dt>{inline("手动", "Manual")}</dt><dd>{formatUiNumber(props.overview?.renameHistory.manualApplied, uiLanguage)}</dd></div>
                <div><dt>{inline("自动应用", "Auto apply")}</dt><dd>{formatUiNumber(props.overview?.renameHistory.autoApplied, uiLanguage)}</dd></div>
                <div><dt>{inline("仅预览", "Preview only")}</dt><dd>{formatUiNumber(props.overview?.renameHistory.previewOnly, uiLanguage)}</dd></div>
              </dl>
            </article>
          </div>
        </section>

        <section className="detail-panel settings-panel">
          <p className="panel-kicker">{tt("style")}</p>
          <h3>{tt("naming")}</h3>
          <p className="settings-copy">
            {inline(
              "控制会话标题格式与上下文提取策略。启发式结果现在只算临时候选名，正式命名只统计 AI 和手动命名，因此设置页不再暴露旧的 rename.mode。",
              "Control the visible session title format and context extraction strategy. Heuristic results are treated as temporary candidates now, and only AI/manual names count as official, so the legacy rename.mode switch is no longer exposed here."
            )}
          </p>
          <label className="settings-field">
            <span>{tt("preset")}</span>
            <input
              value={draft.namingPreset}
              onChange={(event) => {
                updateDraftField("namingPreset", event.target.value);
              }}
            />
          </label>
          <div className="settings-two-up">
            <ChoiceGroup
              label={tt("uiLanguage")}
              onChange={(value) => {
                updateDraftState((current) => ({
                  ...current,
                  uiLanguage: value
                }));
              }}
              options={[
                { value: "en-US", label: "English" },
                { value: "zh-CN", label: "中文" }
              ]}
              value={draft.uiLanguage}
            />
            <ChoiceGroup
              label={tt("defaultNamingStyle")}
              onChange={(value) => {
                updateDraftState((current) => ({
                  ...current,
                  namingDefaultStyle: value
                }));
              }}
              options={[
                { value: "detailed", label: tt("detailed") },
                { value: "brief", label: tt("brief") }
              ]}
              value={draft.namingDefaultStyle}
            />
            <label className="settings-field">
              <span>{tt("language")}</span>
              <input
                value={draft.namingLanguage}
                onChange={(event) => {
                  updateDraftField("namingLanguage", event.target.value);
                }}
              />
            </label>
            <label className="settings-field">
              <span>{tt("maxLength")}</span>
              <input
                value={draft.namingMaxLength}
                onChange={(event) => {
                  updateDraftField("namingMaxLength", event.target.value);
                }}
              />
            </label>
          </div>
          <div className="settings-two-up">
            <ChoiceGroup
              label={tt("contextStrategy")}
              onChange={(value) => {
                updateDraftState((current) => ({
                  ...current,
                  namingContextStrategy: value
                }));
              }}
              options={[
                { value: "summary-signals", label: "summary-signals" },
                { value: "user-assistant-transcript", label: "user-assistant-transcript" }
              ]}
              value={draft.namingContextStrategy as "summary-signals" | "user-assistant-transcript"}
            />
            <label className="settings-field">
              <span>{tt("contextMaxChars")}</span>
              <input
                value={draft.namingContextMaxChars}
                onChange={(event) => {
                  updateDraftField("namingContextMaxChars", event.target.value);
                }}
              />
            </label>
          </div>
          <div className="settings-two-up">
            <ChoiceGroup
              label={inline("Naming composition", "Naming composition")}
              onChange={(value) => {
                updateDraftField("namingCompositionMode", value as NamingCompositionMode);
              }}
              options={[
                { value: "structured", label: inline("结构化组合", "Structured") },
                { value: "prompt-override", label: inline("Prompt 覆写", "Prompt override") }
              ]}
              value={draft.namingCompositionMode}
            />
            <label className="settings-field">
              <span>{inline("组件分隔符", "Component separator")}</span>
              <input
                value={draft.namingComponentSeparator}
                onChange={(event) => {
                  updateDraftField("namingComponentSeparator", event.target.value);
                }}
              />
            </label>
          </div>
          <section className="settings-composer-block">
            <div className="settings-composer-header">
              <div>
                <p className="panel-kicker">{inline("命名组件", "Naming components")}</p>
                <h4>{inline("结构化拼装", "Structured composition")}</h4>
                <p className="settings-copy">
                  {inline(
                    "按顺序决定最终标题如何拼接。切换风格只影响“summary”写得更详细还是更紧凑，组件顺序本身由这里控制。",
                    "Control how the final title is assembled. Naming style only changes how detailed the summary is; component order is controlled here."
                  )}
                </p>
              </div>
            </div>
            <div className="settings-component-stack">
              {selectedNamingComponents.map((component, index) => {
                const option = namingComponentOptions.find((item) => item.value === component);
                if (!option) {
                  return null;
                }
                return (
                  <article className="settings-component-card" key={`${component}-${index}`}>
                    <div>
                      <strong>{option.label}</strong>
                      <p>{option.copy}</p>
                    </div>
                    <div className="settings-component-actions">
                      <button
                        className="btn-refresh"
                        disabled={index === 0}
                        onClick={() => {
                          updateNamingComponents(moveItem(selectedNamingComponents, index, index - 1));
                        }}
                        type="button"
                      >
                        {inline("左移", "Left")}
                      </button>
                      <button
                        className="btn-refresh"
                        disabled={index === selectedNamingComponents.length - 1}
                        onClick={() => {
                          updateNamingComponents(moveItem(selectedNamingComponents, index, index + 1));
                        }}
                        type="button"
                      >
                        {inline("右移", "Right")}
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
                        {inline("移除", "Remove")}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="settings-component-adders">
              {availableNamingComponents.map((option) => (
                <button
                  className="settings-tag-chip"
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
          </section>
          <section className="settings-composer-block">
            <div className="settings-composer-header">
              <div>
                <p className="panel-kicker">{inline("分类 tag", "Classification tags")}</p>
                <h4>{inline("Tag 目录", "Tag catalog")}</h4>
                <p className="settings-copy">
                  {inline(
                    "每个 tag 都是一个可命中的分类规则。命中后，只有当组件顺序里包含 Tag 时，最终标题才会带上它。",
                    "Each tag acts as a classification rule. A matched tag only appears in the final title when the Tag component is included in the composition order."
                  )}
                </p>
              </div>
              <button
                className="btn-refresh"
                onClick={() => {
                  updateDraftState((current) => ({
                    ...current,
                    namingTags: [
                      ...current.namingTags,
                      {
                        id: "",
                        label: "",
                        description: "",
                        promptHint: ""
                      }
                    ]
                  }));
                }}
                type="button"
              >
                {inline("添加 Tag", "Add tag")}
              </button>
            </div>
            <div className="settings-tag-list">
              {draft.namingTags.length === 0 ? (
                <p className="settings-copy">
                  {inline("当前没有自定义 tag。你可以保留空目录，也可以补充自己的分类规则。", "No custom tags yet. Leave the catalog empty or add your own classification rules.")}
                </p>
              ) : null}
              {draft.namingTags.map((tag, index) => (
                <article className="settings-tag-card" key={`${tag.id || "tag"}-${index}`}>
                  <div className="settings-tag-card-topline">
                    <strong>{tag.id.trim() || inline("未命名 Tag", "Untitled tag")}</strong>
                    <button
                      className="btn-refresh"
                      onClick={() => {
                        updateDraftState((current) => ({
                          ...current,
                          namingTags: current.namingTags.filter((_, tagIndex) => tagIndex !== index)
                        }));
                      }}
                      type="button"
                    >
                      {inline("删除", "Remove")}
                    </button>
                  </div>
                  <div className="settings-two-up">
                    <label className="settings-field">
                      <span>{inline("Tag ID", "Tag ID")}</span>
                      <input
                        value={tag.id}
                        onChange={(event) => {
                          updateDraftState((current) => ({
                            ...current,
                            namingTags: current.namingTags.map((item, tagIndex) =>
                              tagIndex === index ? { ...item, id: event.target.value } : item
                            )
                          }));
                        }}
                      />
                    </label>
                    <label className="settings-field">
                      <span>{inline("显示标签", "Display label")}</span>
                      <input
                        value={tag.label}
                        onChange={(event) => {
                          updateDraftState((current) => ({
                            ...current,
                            namingTags: current.namingTags.map((item, tagIndex) =>
                              tagIndex === index ? { ...item, label: event.target.value } : item
                            )
                          }));
                        }}
                      />
                    </label>
                  </div>
                  <label className="settings-field">
                    <span>{inline("Tag 描述", "Tag description")}</span>
                    <input
                      value={tag.description}
                      onChange={(event) => {
                        updateDraftState((current) => ({
                          ...current,
                          namingTags: current.namingTags.map((item, tagIndex) =>
                            tagIndex === index ? { ...item, description: event.target.value } : item
                          )
                        }));
                      }}
                    />
                  </label>
                  <label className="settings-field">
                    <span>{inline("命中提示词", "Match hint")}</span>
                    <input
                      value={tag.promptHint}
                      onChange={(event) => {
                        updateDraftState((current) => ({
                          ...current,
                          namingTags: current.namingTags.map((item, tagIndex) =>
                            tagIndex === index ? { ...item, promptHint: event.target.value } : item
                          )
                        }));
                      }}
                    />
                  </label>
                </article>
              ))}
            </div>
          </section>
          <label className="settings-field settings-field-wide">
            <span>{inline("自定义 Prompt 覆写", "Custom prompt override")}</span>
            <textarea
              rows={4}
              value={draft.namingCustomPrompt}
              onChange={(event) => {
                updateDraftField("namingCustomPrompt", event.target.value);
              }}
            />
          </label>
          <details className="settings-disclosure">
            <summary>{inline("查看兼容层模板", "View legacy template")}</summary>
            <label className="settings-field settings-field-wide">
              <span>{tt("template")}</span>
              <textarea
                rows={3}
                value={draft.namingTemplate}
                onChange={(event) => {
                  updateDraftField("namingTemplate", event.target.value);
                }}
              />
            </label>
          </details>
          <div className="settings-two-up">
            <ChoiceGroup
              label={tt("autoApply")}
              onChange={(value) => {
                updateDraftState((current) => ({
                  ...current,
                  renameAutoApply: value
                }));
              }}
              options={[
                { value: "disabled", label: "disabled" },
                { value: "idle-finalize", label: "idle-finalize" }
              ]}
              value={draft.renameAutoApply as RenameAutoApply}
            />
          </div>
          <div className="settings-checks">
            <label className="toggle">
              <input
                checked={draft.manualOverrideWins}
                onChange={(event) => {
                  updateDraftField("manualOverrideWins", event.target.checked);
                }}
                type="checkbox"
              />
              {tt("manualOverrideWins")}
            </label>
            <label className="toggle">
              <input
                checked={draft.freezeManualName}
                onChange={(event) => {
                  updateDraftField("freezeManualName", event.target.checked);
                }}
                type="checkbox"
              />
              {tt("freezeManualName")}
            </label>
          </div>
        </section>

        <section className="detail-panel settings-panel">
          <p className="panel-kicker">{tt("scheduler")}</p>
          <h3>{tt("autoRenameWatch")}</h3>
          <p className="settings-copy">
            {inline("这些阈值决定一个变更中的 session 什么时候进入候选阶段，以及什么时候稳定到可以回写到 Codex。", "These thresholds decide when a changed session becomes a candidate and when it is stable enough to finalize back into Codex.")}
          </p>
          <div className="settings-two-up">
            <label className="settings-field">
              <span>{tt("scanInterval")}</span>
              <input value={draft.scanIntervalSeconds} onChange={(event) => {
                updateDraftField("scanIntervalSeconds", event.target.value);
              }} />
            </label>
            <label className="settings-field">
              <span>{tt("candidateIdle")}</span>
              <input value={draft.candidateIdleSeconds} onChange={(event) => {
                updateDraftField("candidateIdleSeconds", event.target.value);
              }} />
            </label>
            <label className="settings-field">
              <span>{tt("finalizeIdle")}</span>
              <input value={draft.finalizeIdleSeconds} onChange={(event) => {
                updateDraftField("finalizeIdleSeconds", event.target.value);
              }} />
            </label>
            <label className="settings-field">
              <span>{tt("renameCooldown")}</span>
              <input value={draft.renameCooldownSeconds} onChange={(event) => {
                updateDraftField("renameCooldownSeconds", event.target.value);
              }} />
            </label>
            <label className="settings-field">
              <span>{tt("minRolloutGrowth")}</span>
              <input value={draft.minRolloutGrowthBytes} onChange={(event) => {
                updateDraftField("minRolloutGrowthBytes", event.target.value);
              }} />
            </label>
            <label className="settings-field">
              <span>{tt("minTaskDelta")}</span>
              <input value={draft.minTaskCompleteDelta} onChange={(event) => {
                updateDraftField("minTaskCompleteDelta", event.target.value);
              }} />
            </label>
            <label className="settings-field">
              <span>{tt("maxAutoRenames")}</span>
              <input value={draft.maxAutoRenamesPerSession} onChange={(event) => {
                updateDraftField("maxAutoRenamesPerSession", event.target.value);
              }} />
            </label>
          </div>
        </section>

        <section className="detail-panel settings-panel">
          <p className="panel-kicker">{tt("provider")}</p>
          <h3>{tt("ai")}</h3>
          <p className="settings-copy">
            {inline("选择命名是走继承的 Codex 凭据，还是显式的 OpenAI-compatible 提供方配置，并在下面调整当前配置。", "Pick whether naming runs through inherited Codex credentials or an explicit OpenAI-compatible profile, and tune the active profile below.")}
          </p>
          <div className="settings-two-up">
            <ChoiceGroup
              label={tt("backend")}
              onChange={(value) => {
                updateDraftState((current) => ({
                  ...current,
                  aiBackend: value
                }));
              }}
              options={[
                { value: "codex", label: "codex" },
                { value: "openai-compatible", label: "openai-compatible" },
                { value: "none", label: "none" }
              ]}
              value={draft.aiBackend as AiBackend}
            />
            <ChoiceGroup
              label={tt("providerSource")}
              onChange={(value) => {
                updateDraftState((current) => ({
                  ...current,
                  aiProviderSource: value
                }));
              }}
              options={[
                { value: "inherit-codex", label: "inherit-codex" },
                { value: "explicit", label: "explicit" }
              ]}
              value={draft.aiProviderSource as ProviderSource}
            />
            <label className="settings-field">
              <span>{tt("activeProfile")}</span>
              <select value={draft.aiProfile} onChange={(event) => {
                const nextProfileId = event.target.value;
                updateDraftState((current) => ({
                  ...current,
                  aiProfile: nextProfileId,
                  selectedProfileId: nextProfileId
                }));
              }}>
                {draft.providerProfiles.length === 0 ? (
                  <option value="">{selectedProfileLabel}</option>
                ) : null}
                {draft.providerProfiles.map((profile) => (
                  <option key={profile.profileId} value={profile.profileId}>
                    {profile.profileId}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>{tt("editProfile")}</span>
              <select value={draft.selectedProfileId} onChange={(event) => {
                updateDraftState(
                  (current) => ({
                    ...current,
                    selectedProfileId: event.target.value
                  }),
                  {
                    dirty: false
                  }
                );
              }}>
                {draft.providerProfiles.length === 0 ? (
                  <option value="">{selectedProfileLabel}</option>
                ) : null}
                {draft.providerProfiles.map((profile) => (
                  <option key={profile.profileId} value={profile.profileId}>
                    {profile.profileId}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>{tt("timeoutSeconds")}</span>
              <input value={draft.aiTimeoutSeconds} onChange={(event) => {
                updateDraftField("aiTimeoutSeconds", event.target.value);
              }} />
            </label>
            <label className="settings-field">
              <span>{tt("temperature")}</span>
              <input value={draft.aiTemperature} onChange={(event) => {
                updateDraftField("aiTemperature", event.target.value);
              }} />
            </label>
          </div>

          {selectedProfile ? (
            <div className="settings-profile-block">
              <div className="settings-two-up">
                <label className="settings-field">
                  <span>{tt("displayName")}</span>
                  <input value={selectedProfile.displayName ?? ""} onChange={(event) => {
                    updateDraftState((current) => ({
                      ...current,
                      providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                        displayName: event.target.value
                      })
                    }));
                  }} />
                </label>
                <ChoiceGroup<NonNullable<ProviderProfile["backendKind"]>>
                  label={tt("backendKind")}
                  onChange={(value) => {
                    updateDraftState((current) => ({
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
                  label={tt("profileSource")}
                  onChange={(value) => {
                    updateDraftState((current) => ({
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
                  <span>{tt("providerRef")}</span>
                  <input value={selectedProfile.providerRef ?? ""} onChange={(event) => {
                    updateDraftState((current) => ({
                      ...current,
                      providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                        providerRef: event.target.value
                      })
                    }));
                  }} />
                </label>
                <label className="settings-field">
                  <span>{tt("baseUrl")}</span>
                  <input value={selectedProfile.baseUrl ?? ""} onChange={(event) => {
                    updateDraftState((current) => ({
                      ...current,
                      providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                        baseUrl: event.target.value
                      })
                    }));
                  }} />
                </label>
                <label className="settings-field">
                  <span>{tt("model")}</span>
                  <input value={selectedProfile.model ?? ""} onChange={(event) => {
                    updateDraftState((current) => ({
                      ...current,
                      providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                        model: event.target.value
                      })
                    }));
                  }} />
                </label>
                <ChoiceGroup<NonNullable<ProviderProfile["wireApi"]>>
                  label={tt("wireApi")}
                  onChange={(value) => {
                    updateDraftState((current) => ({
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
                  <span>{tt("apiKey")}</span>
                  <input value={selectedProfile.apiKey ?? ""} onChange={(event) => {
                    updateDraftState((current) => ({
                      ...current,
                      providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                        apiKey: event.target.value
                      })
                    }));
                  }} />
                </label>
                <label className="settings-field">
                  <span>{tt("apiKeyRef")}</span>
                  <input value={selectedProfile.apiKeyRef ?? ""} onChange={(event) => {
                    updateDraftState((current) => ({
                      ...current,
                      providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                        apiKeyRef: event.target.value
                      })
                    }));
                  }} />
                </label>
              </div>
              <div className="settings-checks">
                <label className="toggle">
                  <input checked={selectedProfile.enabled ?? true} onChange={(event) => {
                    updateDraftState((current) => ({
                      ...current,
                      providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                        enabled: event.target.checked
                      })
                    }));
                  }} type="checkbox" />
                  {tt("enabled")}
                </label>
                <label className="toggle">
                  <input checked={selectedProfile.isDefault ?? false} onChange={(event) => {
                    updateDraftState((current) => ({
                      ...current,
                      providerProfiles: current.providerProfiles.map((profile) => ({
                        ...profile,
                        isDefault: profile.profileId === current.selectedProfileId ? event.target.checked : false
                      }))
                    }));
                  }} type="checkbox" />
                  {tt("defaultProfile")}
                </label>
              </div>
            </div>
          ) : (
            <div className="history-empty">
              {inline("当前没有显式 provider profile，命名会使用继承的 Codex provider。", "No explicit provider profile is configured. Naming will use the inherited Codex provider.")}
            </div>
          )}
        </section>

        <section className="detail-panel settings-panel">
          <p className="panel-kicker">{tt("housekeeping")}</p>
          <h3>{tt("maintenance")}</h3>
          <p className="settings-copy">
            {inline("压缩阈值只影响建议和维护工作流，不会自动改写 index。", "Compact thresholds only affect suggestions and maintenance workflows. They do not rewrite the index automatically.")}
          </p>
          <div className="settings-two-up">
            <label className="settings-field">
              <span>{tt("suggestCompactMb")}</span>
              <input value={draft.maintenanceCompactMb} onChange={(event) => {
                updateDraftField("maintenanceCompactMb", event.target.value);
              }} />
            </label>
            <label className="settings-field">
              <span>{tt("suggestCompactLines")}</span>
              <input value={draft.maintenanceCompactLines} onChange={(event) => {
                updateDraftField("maintenanceCompactLines", event.target.value);
              }} />
            </label>
          </div>
          <div className="settings-checks">
            <label className="toggle">
              <input checked={draft.maintenanceBackupBeforeCompact} onChange={(event) => {
                updateDraftField("maintenanceBackupBeforeCompact", event.target.checked);
              }} type="checkbox" />
              {tt("backupBeforeCompact")}
            </label>
          </div>
        </section>

        <section className="detail-panel settings-panel">
          <p className="panel-kicker">{tt("runtime")}</p>
          <h3>{tt("resolvedEnvironment")}</h3>
          <dl className="settings-readonly">
            <div>
              <dt>{tt("userConfig")}</dt>
              <dd>{props.configView.paths.userConfigPath || tt("nA")}</dd>
            </div>
            <div>
              <dt>{tt("projectOverride")}</dt>
              <dd>{props.configView.paths.projectConfigPath || tt("nA")}</dd>
            </div>
            <div>
              <dt>{tt("resolvedBackend")}</dt>
              <dd>{String(props.providers?.resolvedProvider?.resolvedBackend ?? tt("nA"))}</dd>
            </div>
            <div>
              <dt>{tt("resolvedTransport")}</dt>
              <dd>{String(props.providers?.resolvedProvider?.transport ?? tt("nA"))}</dd>
            </div>
            <div>
              <dt>{tt("inheritedModelProvider")}</dt>
              <dd>{String(inheritedCodex.modelProvider ?? tt("nA"))}</dd>
            </div>
            <div>
              <dt>{tt("inheritedModel")}</dt>
              <dd>{String(inheritedCodex.model ?? tt("nA"))}</dd>
            </div>
            <div>
              <dt>{tt("selectedProfile")}</dt>
              <dd>{selectedProfileLabel}</dd>
            </div>
            <div>
              <dt>{tt("baseUrl")}</dt>
              <dd>{selectedBaseUrl}</dd>
            </div>
            <div>
              <dt>{tt("model")}</dt>
              <dd>{selectedModel}</dd>
            </div>
            <div>
              <dt>{tt("wireApi")}</dt>
              <dd>{selectedWireApi}</dd>
            </div>
          </dl>
          <details className="settings-disclosure">
            <summary>{tt("inspectResolvedProvider")}</summary>
            <pre className="settings-json">{JSON.stringify(props.providers?.resolvedProvider ?? {}, null, 2)}</pre>
          </details>
        </section>

        <section className="detail-panel settings-panel settings-span-wide">
          <div className="panel-topline">
            <div>
              <p className="panel-kicker">{tt("ai")}</p>
              <h3>{tt("promptPreview")}</h3>
              <p className="settings-copy">{tt("promptPreviewCopy")}</p>
            </div>
            <button className="btn-sm" onClick={() => void props.onRefreshPromptPreview()} type="button">
              {props.promptPreviewRefreshing ? tt("refreshing") : tt("refresh")}
            </button>
          </div>
          <dl className="settings-readonly">
            <div>
              <dt>{inline("来源", "Source")}</dt>
              <dd>
                {props.promptPreview
                  ? props.promptPreview.synthetic
                    ? tt("promptSynthetic")
                    : tt("promptForSelected")
                  : tt("nA")}
              </dd>
            </div>
            <div>
              <dt>{inline("线程", "Thread")}</dt>
              <dd>{props.promptPreview?.threadId ?? tt("nA")}</dd>
            </div>
            <div>
              <dt>{inline("上下文策略", "Context Strategy")}</dt>
              <dd>{props.promptPreview?.renameContext.strategy ?? tt("nA")}</dd>
            </div>
            <div>
              <dt>{inline("预览状态", "Preview Status")}</dt>
              <dd>{autoRenameStatusLabel(promptPreviewStatus, uiLanguage)}</dd>
            </div>
          </dl>
          <pre className="settings-json">
            {props.promptPreview?.prompt ?? (props.promptPreviewRefreshing ? tt("loadingPrompt") : tt("noPreviewLoaded"))}
          </pre>
        </section>
      </div>
    </section>
  );
}
