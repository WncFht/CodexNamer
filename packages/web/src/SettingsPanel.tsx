import { useEffect, useMemo, useRef, useState } from "react";

import { parseCodexProvider, testProvider } from "./api.js";
import { formatUiNumber, normalizeUiLanguage, t } from "./i18n.js";
import {
  deriveRuntimeDisplay,
  runtimeExecutionLabel,
  runtimeProgressExplanation
} from "./runtime-display.js";
import {
  encodeDraft,
  encodedConfigKey,
  type SettingsDraft,
  useSettingsDraft,
  updateSelectedProfile
} from "./settings-model.js";
import type {
  ConfigDocument,
  ConfigView,
  DaemonControlStatus,
  OverviewResponse,
  PromptPreviewResponse,
  ProviderResponse,
  ProviderTestResponse
} from "./types.js";
import { AppViewTransition } from "./view-transitions.js";
import { AiProviderSection } from "./features/settings/sections/AiProviderSection.js";
import { NamingSection } from "./features/settings/sections/NamingSection.js";
import { OverviewSection } from "./features/settings/sections/OverviewSection.js";
import { RuntimeSection } from "./features/settings/sections/RuntimeSection.js";
import { SchedulerSection } from "./features/settings/sections/SchedulerSection.js";
import {
  SettingsHeroMetric,
  SettingsNav,
  type InlineText,
  type SettingsSectionId,
  type TextTools,
  type Translate
} from "./features/settings/shared.js";

export function SettingsPanel(props: {
  configView: ConfigView | null;
  daemon: DaemonControlStatus | null;
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
  onOpenRequeue: () => void;
  onSave: (patch: ConfigDocument) => void | Promise<void>;
}) {
  const { draft, dirty, setDirty, draftRef, updateDraftState, updateDraftField } = useSettingsDraft(props.configView);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("naming");
  const [providerTesting, setProviderTesting] = useState(false);
  const [providerTestResult, setProviderTestResult] = useState<ProviderTestResponse | null>(null);
  const uiLanguage = draft?.uiLanguage ?? normalizeUiLanguage(props.configView);
  const tt: Translate = (key) => t(uiLanguage, key);
  const inline: InlineText = (zh, en) => (uiLanguage === "zh-CN" ? zh : en);
  const runtimeDisplay = deriveRuntimeDisplay(props.overview, props.daemon);
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
    setProviderTestResult(props.providers?.lastProviderTest ?? null);
  }, [props.providers?.lastProviderTest]);

  useEffect(() => {
    if (!previewDraft) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void refreshPromptPreviewRef.current(previewDraft, {
        urgent: false
      });
    }, 300);
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
            onOpenRequeue={props.onOpenRequeue}
            onRefreshPromptPreview={props.onRefreshPromptPreview}
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
            providerTestResult={providerTestResult}
            providerTesting={providerTesting}
            text={text}
            updateDraftField={updateDraftField}
            updateDraftState={updateDraftState}
            onParseCodex={async () => {
              const parsed = await parseCodexProvider();
              updateDraftState((current) => ({
                ...current,
                aiProviderSource: "manual",
                aiBackend: parsed.profile.requestType ?? current.aiBackend,
                providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                  requestType: parsed.profile.requestType,
                  providerRef: parsed.profile.providerRef,
                  baseUrl: parsed.profile.baseUrl,
                  model: parsed.profile.model,
                  apiKey: parsed.profile.apiKey
                })
              }));
            }}
            onTestProvider={async () => {
              setProviderTesting(true);
              try {
                const result = await testProvider(previewDraft ?? encodeDraft(loadedDraft));
                setProviderTestResult(result);
              } finally {
                setProviderTesting(false);
              }
            }}
          />
        );
      case "scheduler":
        return <SchedulerSection draft={loadedDraft} text={text} updateDraftField={updateDraftField} />;
      case "runtime":
        return <RuntimeSection configView={configView} providers={props.providers} text={text} />;
      case "overview":
        return (
          <OverviewSection
            daemon={props.daemon}
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
            detail={
              (runtimeDisplay.sweepRunning ? runtimeProgressExplanation(uiLanguage) : "") ||
              props.overview?.runtime.explain ||
              tt("nA")
            }
            label={inline("当前执行态", "Execution")}
            value={runtimeExecutionLabel(runtimeDisplay.execution, uiLanguage)}
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
