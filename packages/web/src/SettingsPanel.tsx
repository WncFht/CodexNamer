import { useEffect, useMemo, useState } from "react";

import { autoRenameStatusLabel, formatUiNumber, normalizeUiLanguage, t } from "./i18n.js";
import type { ConfigDocument, ConfigView, OverviewResponse, ProviderProfile, ProviderResponse } from "./types.js";
import type { PromptPreviewResponse } from "./types.js";

type SettingsDraft = {
  uiLanguage: "en-US" | "zh-CN";
  namingPreset: string;
  namingTemplate: string;
  namingLanguage: string;
  namingMaxLength: string;
  renameMode: string;
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

type RenameMode = "heuristic" | "ai" | "hybrid";
type RenameAutoApply = "off" | "idle-finalize" | "suggest-only";
type AiBackend = "none" | "codex" | "openai-compatible";
type ProviderSource = "inherit-codex" | "explicit";

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
    namingMaxLength: asNumberString(naming.maxLength || naming.max_length, "72"),
    renameMode: asString(rename.mode, "hybrid"),
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
      mode: draft.renameMode as RenameMode,
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
      maxLength: parseNumber(draft.namingMaxLength)
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
  const effective = asRecord(props.configView?.effectiveConfig);
  const inheritedCodex = asRecord(effective.inheritedCodex);
  const uiLanguage = draft?.uiLanguage ?? normalizeUiLanguage(props.configView);
  const tt = (key: Parameters<typeof t>[1]) => t(uiLanguage, key);
  const inline = (zh: string, en: string) => (uiLanguage === "zh-CN" ? zh : en);

  useEffect(() => {
    if (!props.configView) {
      return;
    }

    const nextDraft = buildDraft(props.configView);
    if (!dirty) {
      setDraft(nextDraft);
      return;
    }

    if (draft && JSON.stringify(encodeDraft(draft)) === JSON.stringify(encodeDraft(nextDraft))) {
      setDraft(nextDraft);
      setDirty(false);
    }
  }, [dirty, draft, props.configView]);

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

  if (!props.configView || !draft) {
    return (
      <section className="settings-layout">
        <div className="history-empty">{inline("正在加载设置...", "Loading settings...")}</div>
      </section>
    );
  }

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
                await props.onSave(encodeDraft(draft));
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
                <div><dt>{inline("启发式", "Heuristic")}</dt><dd>{formatUiNumber(props.overview?.renameHistory.heuristicApplied, uiLanguage)}</dd></div>
                <div><dt>{inline("混合", "Hybrid")}</dt><dd>{formatUiNumber(props.overview?.renameHistory.hybridApplied, uiLanguage)}</dd></div>
                <div><dt>{inline("批量", "Batch")}</dt><dd>{formatUiNumber(props.overview?.renameHistory.batchApplied, uiLanguage)}</dd></div>
                <div><dt>{inline("仅预览", "Preview only")}</dt><dd>{formatUiNumber(props.overview?.renameHistory.previewOnly, uiLanguage)}</dd></div>
              </dl>
            </article>
          </div>
        </section>

        <section className="detail-panel settings-panel">
          <p className="panel-kicker">{tt("style")}</p>
          <h3>{tt("naming")}</h3>
          <p className="settings-copy">
            {inline("控制会话标题格式、上下文提取策略，以及 rename 引擎是保持 heuristic 还是调用 AI。", "Control the visible session title format, context extraction strategy, and whether the rename engine stays heuristic or asks AI for structure.")}
          </p>
          <label className="settings-field">
            <span>{tt("preset")}</span>
            <input
              value={draft.namingPreset}
              onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, namingPreset: event.target.value });
              }}
            />
          </label>
          <label className="settings-field settings-field-wide">
            <span>{tt("template")}</span>
            <textarea
              rows={3}
              value={draft.namingTemplate}
              onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, namingTemplate: event.target.value });
              }}
            />
          </label>
          <div className="settings-two-up">
            <label className="settings-field">
              <span>{tt("uiLanguage")}</span>
              <select
                value={draft.uiLanguage}
                onChange={(event) => {
                  setDirty(true);
                  setDraft({ ...draft, uiLanguage: event.target.value as "en-US" | "zh-CN" });
                }}
              >
                <option value="en-US">English</option>
                <option value="zh-CN">中文</option>
              </select>
            </label>
            <label className="settings-field">
              <span>{tt("language")}</span>
              <input
                value={draft.namingLanguage}
                onChange={(event) => {
                  setDirty(true);
                  setDraft({ ...draft, namingLanguage: event.target.value });
                }}
              />
            </label>
            <label className="settings-field">
              <span>{tt("maxLength")}</span>
              <input
                value={draft.namingMaxLength}
                onChange={(event) => {
                  setDirty(true);
                  setDraft({ ...draft, namingMaxLength: event.target.value });
                }}
              />
            </label>
          </div>
          <div className="settings-two-up">
            <label className="settings-field">
              <span>{tt("renameMode")}</span>
              <select
                value={draft.renameMode}
                onChange={(event) => {
                  setDirty(true);
                  setDraft({ ...draft, renameMode: event.target.value });
                }}
              >
                <option value="heuristic">heuristic</option>
                <option value="hybrid">hybrid</option>
                <option value="ai">ai</option>
              </select>
            </label>
            <label className="settings-field">
              <span>{tt("autoApply")}</span>
              <select
                value={draft.renameAutoApply}
                onChange={(event) => {
                  setDirty(true);
                  setDraft({ ...draft, renameAutoApply: event.target.value });
                }}
              >
                <option value="off">off</option>
                <option value="suggest-only">suggest-only</option>
                <option value="idle-finalize">idle-finalize</option>
              </select>
            </label>
          </div>
          <div className="settings-checks">
            <label className="toggle">
              <input
                checked={draft.manualOverrideWins}
                onChange={(event) => {
                  setDirty(true);
                  setDraft({ ...draft, manualOverrideWins: event.target.checked });
                }}
                type="checkbox"
              />
              {tt("manualOverrideWins")}
            </label>
            <label className="toggle">
              <input
                checked={draft.freezeManualName}
                onChange={(event) => {
                  setDirty(true);
                  setDraft({ ...draft, freezeManualName: event.target.checked });
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
                setDirty(true);
                setDraft({ ...draft, scanIntervalSeconds: event.target.value });
              }} />
            </label>
            <label className="settings-field">
              <span>{tt("candidateIdle")}</span>
              <input value={draft.candidateIdleSeconds} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, candidateIdleSeconds: event.target.value });
              }} />
            </label>
            <label className="settings-field">
              <span>{tt("finalizeIdle")}</span>
              <input value={draft.finalizeIdleSeconds} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, finalizeIdleSeconds: event.target.value });
              }} />
            </label>
            <label className="settings-field">
              <span>{tt("renameCooldown")}</span>
              <input value={draft.renameCooldownSeconds} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, renameCooldownSeconds: event.target.value });
              }} />
            </label>
            <label className="settings-field">
              <span>{tt("minRolloutGrowth")}</span>
              <input value={draft.minRolloutGrowthBytes} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, minRolloutGrowthBytes: event.target.value });
              }} />
            </label>
            <label className="settings-field">
              <span>{tt("minTaskDelta")}</span>
              <input value={draft.minTaskCompleteDelta} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, minTaskCompleteDelta: event.target.value });
              }} />
            </label>
            <label className="settings-field">
              <span>{tt("maxAutoRenames")}</span>
              <input value={draft.maxAutoRenamesPerSession} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, maxAutoRenamesPerSession: event.target.value });
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
            <label className="settings-field">
              <span>{tt("backend")}</span>
              <select value={draft.aiBackend} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, aiBackend: event.target.value });
              }}>
                <option value="codex">codex</option>
                <option value="openai-compatible">openai-compatible</option>
                <option value="none">none</option>
              </select>
            </label>
            <label className="settings-field">
              <span>{tt("providerSource")}</span>
              <select value={draft.aiProviderSource} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, aiProviderSource: event.target.value });
              }}>
                <option value="inherit-codex">inherit-codex</option>
                <option value="explicit">explicit</option>
              </select>
            </label>
            <label className="settings-field">
              <span>{tt("activeProfile")}</span>
              <select value={draft.aiProfile} onChange={(event) => {
                const nextProfileId = event.target.value;
                setDirty(true);
                setDraft({ ...draft, aiProfile: nextProfileId, selectedProfileId: nextProfileId });
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
                setDraft({ ...draft, selectedProfileId: event.target.value });
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
                setDirty(true);
                setDraft({ ...draft, aiTimeoutSeconds: event.target.value });
              }} />
            </label>
            <label className="settings-field">
              <span>{tt("temperature")}</span>
              <input value={draft.aiTemperature} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, aiTemperature: event.target.value });
              }} />
            </label>
          </div>

          {selectedProfile ? (
            <div className="settings-profile-block">
              <div className="settings-two-up">
                <label className="settings-field">
                  <span>{tt("displayName")}</span>
                  <input value={selectedProfile.displayName ?? ""} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        displayName: event.target.value
                      })
                    });
                  }} />
                </label>
                <label className="settings-field">
                  <span>{tt("backendKind")}</span>
                  <select value={selectedProfile.backendKind ?? "openai-compatible"} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        backendKind: event.target.value as ProviderProfile["backendKind"]
                      })
                    });
                  }}>
                    <option value="openai-compatible">openai-compatible</option>
                    <option value="codex">codex</option>
                    <option value="none">none</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>{tt("profileSource")}</span>
                  <select value={selectedProfile.providerSource ?? "explicit"} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        providerSource: event.target.value as ProviderProfile["providerSource"]
                      })
                    });
                  }}>
                    <option value="explicit">explicit</option>
                    <option value="inherit-codex">inherit-codex</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>{tt("providerRef")}</span>
                  <input value={selectedProfile.providerRef ?? ""} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        providerRef: event.target.value
                      })
                    });
                  }} />
                </label>
                <label className="settings-field">
                  <span>{tt("baseUrl")}</span>
                  <input value={selectedProfile.baseUrl ?? ""} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        baseUrl: event.target.value
                      })
                    });
                  }} />
                </label>
                <label className="settings-field">
                  <span>{tt("model")}</span>
                  <input value={selectedProfile.model ?? ""} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        model: event.target.value
                      })
                    });
                  }} />
                </label>
                <label className="settings-field">
                  <span>{tt("wireApi")}</span>
                  <select value={selectedProfile.wireApi ?? "auto"} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        wireApi: event.target.value as ProviderProfile["wireApi"]
                      })
                    });
                  }}>
                    <option value="auto">auto</option>
                    <option value="responses">responses</option>
                    <option value="chat_completions">chat_completions</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>{tt("apiKey")}</span>
                  <input value={selectedProfile.apiKey ?? ""} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        apiKey: event.target.value
                      })
                    });
                  }} />
                </label>
                <label className="settings-field">
                  <span>{tt("apiKeyRef")}</span>
                  <input value={selectedProfile.apiKeyRef ?? ""} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        apiKeyRef: event.target.value
                      })
                    });
                  }} />
                </label>
              </div>
              <div className="settings-checks">
                <label className="toggle">
                  <input checked={selectedProfile.enabled ?? true} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        enabled: event.target.checked
                      })
                    });
                  }} type="checkbox" />
                  {tt("enabled")}
                </label>
                <label className="toggle">
                  <input checked={selectedProfile.isDefault ?? false} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: draft.providerProfiles.map((profile) => ({
                        ...profile,
                        isDefault: profile.profileId === draft.selectedProfileId ? event.target.checked : false
                      }))
                    });
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
                setDirty(true);
                setDraft({ ...draft, maintenanceCompactMb: event.target.value });
              }} />
            </label>
            <label className="settings-field">
              <span>{tt("suggestCompactLines")}</span>
              <input value={draft.maintenanceCompactLines} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, maintenanceCompactLines: event.target.value });
              }} />
            </label>
          </div>
          <div className="settings-checks">
            <label className="toggle">
              <input checked={draft.maintenanceBackupBeforeCompact} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, maintenanceBackupBeforeCompact: event.target.checked });
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
