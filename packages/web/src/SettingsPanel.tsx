import { startTransition, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { parseCodexProvider, testProvider } from "./api.js";
import { formatUiNumber, normalizeUiLanguage, t } from "./i18n.js";
import {
  deriveRuntimeDisplay,
  runtimeDaemonStatusLabel,
  runtimeExecutionLabel,
  runtimeProgressExplanation
} from "./runtime-display.js";
import {
  asRecord,
  blankTagDraft,
  DEFAULT_TIMESTAMP_PRESET,
  encodeDraft,
  encodedConfigKey,
  firstNonEmptyString,
  moveItem,
  QUICK_SEPARATOR_OPTIONS,
  renderNamingStructurePreview,
  renderTagLabel,
  SettingsTagDraft,
  tagToneClass,
  TIMESTAMP_PRESET_OPTIONS,
  type AiBackend,
  type DraftFieldUpdater,
  type DraftStateUpdater,
  type NamingBuilderItem,
  type NamingComponent,
  type NamingCompositionMode,
  type RenameContextStrategy,
  type NamingTimestampPreset,
  type ProviderSource,
  type RenameAutoApply,
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
  ProviderProfile,
  ProviderResponse,
  ProviderTestResponse
} from "./types.js";
import { addAppTransitionType, AppViewTransition } from "./view-transitions.js";
type SettingsSectionId = "overview" | "naming" | "ai" | "scheduler" | "runtime";
type ChoiceOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
};
type Translate = (key: Parameters<typeof t>[1]) => string;
type InlineText = (zh: string, en: string) => string;
type TextTools = {
  tt: Translate;
  inline: InlineText;
  uiLanguage: "en-US" | "zh-CN";
};
const SECTION_ORDER: SettingsSectionId[] = ["naming", "ai", "scheduler", "runtime", "overview"];

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
  const [manualPromptPreviewRefreshing, setManualPromptPreviewRefreshing] = useState(false);

  const handleManualPromptPreviewRefresh = async () => {
    if (manualPromptPreviewRefreshing) {
      return;
    }
    setManualPromptPreviewRefreshing(true);
    try {
      await props.onRefreshPromptPreview(props.draftConfig, { urgent: true });
    } finally {
      setManualPromptPreviewRefreshing(false);
    }
  };

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
              <h4>{props.text.inline("语言与长度", "Language and length")}</h4>
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
              disabled={manualPromptPreviewRefreshing}
              onClick={() => {
                void handleManualPromptPreviewRefresh();
              }}
              type="button"
            >
              {manualPromptPreviewRefreshing ? props.text.tt("refreshing") : props.text.tt("refresh")}
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
  providerTestResult: ProviderTestResponse | null;
  providerTesting: boolean;
  configView: ConfigView;
  text: TextTools;
  updateDraftState: DraftStateUpdater;
  updateDraftField: DraftFieldUpdater;
  onParseCodex: () => Promise<void>;
  onTestProvider: () => Promise<void>;
}) {
  const effective = asRecord(props.configView.effectiveConfig);
  const inheritedCodex = asRecord(effective.inheritedCodex);
  const resolvedProvider = asRecord(props.providers?.resolvedProvider);
  const selectedProfile = useMemo(
    () => props.draft.providerProfiles.find((profile) => profile.profileId === props.draft.selectedProfileId),
    [props.draft]
  );
  const usingManualSource = props.draft.aiProviderSource === "manual";
  const selectedProfileLabel = usingManualSource
    ? firstNonEmptyString(selectedProfile?.profileId, props.draft.aiProfile) ?? props.text.tt("nA")
    : props.text.inline("Codex 配置", "Codex config");
  const selectedBaseUrl =
    firstNonEmptyString(
      ...(usingManualSource
        ? [selectedProfile?.baseUrl, props.providers?.resolvedProvider?.baseUrl, inheritedCodex.baseUrl]
        : [props.providers?.resolvedProvider?.baseUrl, inheritedCodex.baseUrl, selectedProfile?.baseUrl])
    ) ?? props.text.tt("nA");
  const selectedModel =
    firstNonEmptyString(
      ...(usingManualSource
        ? [selectedProfile?.model, props.providers?.resolvedProvider?.model, inheritedCodex.model]
        : [props.providers?.resolvedProvider?.model, inheritedCodex.model, selectedProfile?.model])
    ) ?? props.text.tt("nA");
  const selectedRequestType =
    firstNonEmptyString(
      ...(usingManualSource
        ? [selectedProfile?.requestType, resolvedProvider.requestType, inheritedCodex.wireApi]
        : [resolvedProvider.requestType, inheritedCodex.wireApi, selectedProfile?.requestType])
    ) ?? props.text.tt("nA");
  const resolvedRequestedBackend = firstNonEmptyString(resolvedProvider.requestedBackend, props.draft.aiBackend) ?? props.text.tt("nA");
  const resolvedTransport = firstNonEmptyString(resolvedProvider.preferredTransport, resolvedProvider.transport) ?? props.text.tt("nA");
  const resolvedCredential = resolvedProvider.hasCredential
    ? firstNonEmptyString(resolvedProvider.credentialSource, resolvedProvider.credentialKind) ?? props.text.inline("已配置", "Configured")
    : props.text.inline("未配置", "Missing");
  const directHttpLabel = resolvedProvider.canDirectHttp
    ? props.text.inline("可直接 HTTP", "Direct HTTP ready")
    : props.text.inline("配置不完整", "Configuration incomplete");
  const requestPath = [props.draft.aiBackend, props.draft.aiProviderSource, selectedProfileLabel, resolvedTransport].filter(Boolean);
  const timeoutOptions = Array.from(new Set([props.draft.aiTimeoutSeconds, "15", "30", "45", "60", "90"])).filter(Boolean);
  const temperatureOptions = Array.from(new Set([props.draft.aiTemperature, "0", "0.2", "0.4", "0.7", "1"])).filter(Boolean);
  const sourceDetailTitle = usingManualSource
    ? props.text.inline("手动配置", "Manual config")
    : props.text.inline("Codex 配置", "Codex config");
  const sourceDetailCopy = usingManualSource
    ? props.text.inline(
        "当来源为 `manual` 时，rename 和测试都会使用这里选中的手动配置。",
        "When the source is `manual`, rename and provider tests use the selected manual profile here."
      )
    : props.text.inline(
        "当来源为 `codex-config` 时，rename 和测试都会直接读取当前 Codex 配置与鉴权。",
        "When the source is `codex-config`, rename and provider tests read the current Codex config and auth directly."
      );

  return (
    <SettingsSectionFrame
      kicker={props.text.tt("provider")}
      title={props.text.inline("把命名请求走向讲清楚", "Make the naming request path easy to inspect")}
      copy={props.text.inline(
        "先确定请求类型与配置来源，再看当前实际命中的 provider、凭证和连通性。这里只保留 builder + AI 路径，不再做静默回退。",
        "Choose the request type and config source first, then inspect the provider, credentials, and connectivity actually in effect. This panel only supports the builder plus AI path, with no silent fallback."
      )}
    >
      <div className="settings-stage-grid settings-stage-grid-wide">
        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.tt("ai")}</p>
              <h4>{props.text.inline("请求类型与配置来源", "Request type and config source")}</h4>
            </div>
          </div>
          <div className="settings-two-up">
            <SelectField
              label={props.text.tt("requestType")}
              onChange={(value) => {
                props.updateDraftField("aiBackend", value);
              }}
              options={[
                { value: "responses", label: "responses" },
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
                { value: "codex-config", label: "codex-config" },
                { value: "manual", label: "manual" }
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
          <div className="settings-action-row">
            {usingManualSource ? (
              <button className="btn-sm" onClick={() => void props.onParseCodex()} type="button">
                {props.text.inline("从 Codex 配置导入当前手动配置", "Import Codex config into manual profile")}
              </button>
            ) : (
              <button className="btn-sm" onClick={() => void props.onParseCodex()} type="button">
                {props.text.inline("重新解析 Codex 配置", "Reload Codex config")}
              </button>
            )}
            <button className="btn-sm primary" disabled={props.providerTesting} onClick={() => void props.onTestProvider()} type="button">
              {props.providerTesting ? props.text.inline("测试中...", "Testing...") : props.text.inline("测试 URL + API Key", "Test URL + API key")}
            </button>
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
              <dt>{props.text.tt("requestType")}</dt>
              <dd>{resolvedRequestedBackend}</dd>
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
              <dt>{usingManualSource ? props.text.tt("selectedProfile") : props.text.inline("配置来源", "Config source")}</dt>
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
              <dt>{props.text.tt("requestType")}</dt>
              <dd>{selectedRequestType}</dd>
            </div>
            <div>
              <dt>{props.text.tt("providerRef")}</dt>
              <dd>{String(resolvedProvider.providerRef ?? selectedProfile?.providerRef ?? props.text.tt("nA"))}</dd>
            </div>
            <div>
              <dt>{props.text.inline("requires auth", "Requires auth")}</dt>
              <dd>{resolvedProvider.requiresOpenaiAuth ? props.text.inline("是", "Yes") : props.text.inline("否", "No")}</dd>
            </div>
          </dl>
          <details className="settings-disclosure">
            <summary>{props.text.tt("inspectResolvedProvider")}</summary>
            <pre className="settings-json">{JSON.stringify(props.providers?.resolvedProvider ?? {}, null, 2)}</pre>
          </details>
        </article>

        <article className="settings-surface-card">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Connectivity", "Connectivity")}</p>
              <h4>{props.text.inline("测试结果与延迟", "Test result and latency")}</h4>
            </div>
          </div>
          <dl className="settings-runtime-grid compact">
            <div>
              <dt>{props.text.inline("状态", "Status")}</dt>
              <dd>
                {props.providerTestResult
                  ? props.providerTestResult.ok
                    ? props.text.inline("通过", "Passed")
                    : props.text.inline("失败", "Failed")
                  : props.text.tt("nA")}
              </dd>
            </div>
            <div>
              <dt>{props.text.inline("Ping", "Ping")}</dt>
              <dd>{props.providerTestResult?.latencyMs ? `${props.providerTestResult.latencyMs} ms` : props.text.tt("nA")}</dd>
            </div>
            <div>
              <dt>{props.text.inline("测试时间", "Tested at")}</dt>
              <dd>{props.providerTestResult?.testedAt ?? props.text.tt("nA")}</dd>
            </div>
            <div>
              <dt>{props.text.inline("结果摘要", "Summary")}</dt>
              <dd>{firstNonEmptyString(props.providerTestResult?.responseText, props.providerTestResult?.error) ?? props.text.tt("nA")}</dd>
            </div>
          </dl>
        </article>

        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Source detail", "Source detail")}</p>
              <h4>{sourceDetailTitle}</h4>
              <p className="settings-copy">{sourceDetailCopy}</p>
            </div>
          </div>

          {usingManualSource && selectedProfile ? (
            <>
              <div className="settings-provider-groups">
                <section className="settings-provider-group">
                  <div className="settings-card-header">
                    <div>
                      <p className="panel-kicker">{props.text.inline("Profile", "Profile")}</p>
                      <h4>{props.text.inline("选择并标识手动配置", "Select and identify the manual profile")}</h4>
                    </div>
                  </div>
                  <div className="settings-two-up">
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
                    <SelectField<NonNullable<ProviderProfile["requestType"]>>
                      label={props.text.tt("requestType")}
                      onChange={(value) => {
                        props.updateDraftState((current) => ({
                          ...current,
                          providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                            requestType: value
                          })
                        }));
                      }}
                      options={[
                        { value: "responses", label: "responses" },
                        { value: "openai-compatible", label: "openai-compatible" }
                      ]}
                      value={selectedProfile.requestType ?? "responses"}
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
          ) : !usingManualSource ? (
            <div className="settings-provider-groups">
              <section className="settings-provider-group">
                <div className="settings-card-header">
                  <div>
                    <p className="panel-kicker">{props.text.inline("Inherited provider", "Inherited provider")}</p>
                    <h4>{props.text.inline("当前读取到的 Codex 配置", "Codex config currently in effect")}</h4>
                  </div>
                </div>
                <dl className="settings-runtime-grid compact">
                  <div>
                    <dt>{props.text.inline("模型提供方", "Model provider")}</dt>
                    <dd>{String(inheritedCodex.modelProvider ?? props.text.tt("nA"))}</dd>
                  </div>
                  <div>
                    <dt>{props.text.tt("requestType")}</dt>
                    <dd>{String(inheritedCodex.wireApi ?? props.text.tt("nA"))}</dd>
                  </div>
                  <div>
                    <dt>{props.text.tt("baseUrl")}</dt>
                    <dd>{String(inheritedCodex.baseUrl ?? resolvedProvider.baseUrl ?? props.text.tt("nA"))}</dd>
                  </div>
                  <div>
                    <dt>{props.text.tt("model")}</dt>
                    <dd>{String(inheritedCodex.model ?? props.text.tt("nA"))}</dd>
                  </div>
                </dl>
              </section>
            </div>
          ) : (
            <div className="settings-empty-state">
              {props.text.inline(
                "当前没有可编辑的手动配置，请先创建或选择一个 profile。",
                "There is no editable manual config yet. Create or select a profile first."
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
  daemon: DaemonControlStatus | null;
  previewApplyCount: number;
  previewSuggestCount: number;
  text: TextTools;
}) {
  const runtimeDisplay = deriveRuntimeDisplay(props.overview, props.daemon);
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
              <dd>{runtimeExecutionLabel(runtimeDisplay.execution, props.text.uiLanguage)}</dd>
            </div>
            <div>
              <dt>{props.text.inline("Daemon", "Daemon")}</dt>
              <dd>{runtimeDaemonStatusLabel(runtimeDisplay.daemonStatus, props.text.uiLanguage)}</dd>
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
  onReplayRenames: (params: {
    since: string;
    basis: "session-updated-at" | "last-applied-at";
  }) => Promise<unknown>;
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
