import { useEffect, useState } from "react";
import type {
  DraftFieldUpdater,
  DraftStateUpdater,
  NamingBuilderItem,
  NamingComponent,
  NamingCompositionMode,
  NamingTimestampPreset,
  RenameContextStrategy,
  SettingsDraft,
  SettingsTagDraft,
} from "../../../settings-model.js";
import {
  blankTagDraft,
  DEFAULT_TIMESTAMP_PRESET,
  moveItem,
  QUICK_SEPARATOR_OPTIONS,
  renderNamingStructurePreview,
  renderTagLabel,
  TIMESTAMP_PRESET_OPTIONS,
  tagToneClass,
} from "../../../settings-model.js";
import type { ConfigDocument, PromptPreviewResponse } from "../../../types.js";
import type { ChoiceOption, TextTools } from "../shared.js";
import { SelectField, SettingsSectionFrame } from "../shared.js";

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
                "Tag 用于给常见场景设置可复用的命名规则。",
                "Tags define reusable naming rules for common scenarios.",
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
                    id: event.target.value,
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
                    label: event.target.value,
                  }));
                }}
                value={form.label ?? ""}
              />
            </label>
            <label className="settings-field settings-field-wide">
              <span>{props.text.inline("描述", "Description")}</span>
              <textarea
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }));
                }}
                rows={3}
                value={form.description ?? ""}
              />
            </label>
            <label className="settings-field settings-field-wide">
              <span>{props.text.inline("Prompt 提示", "Prompt hint")}</span>
              <textarea
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    promptHint: event.target.value,
                  }));
                }}
                rows={4}
                value={form.promptHint ?? ""}
              />
            </label>
          </div>
        </div>

        <div className="settings-modal-footer">
          {props.onDelete ? (
            <button className="btn-refresh danger" onClick={props.onDelete} type="button">
              {props.text.inline("删除", "Delete")}
            </button>
          ) : (
            <span />
          )}
          <div className="settings-modal-actions">
            <button className="btn-refresh" onClick={props.onClose} type="button">
              {props.text.inline("取消", "Cancel")}
            </button>
            <button
              className="btn-sm primary"
              onClick={() => {
                props.onSave({
                  ...form,
                  id: form.id.trim(),
                  label: form.label?.trim() ?? "",
                  description: form.description?.trim() ?? "",
                  promptHint: form.promptHint?.trim() ?? "",
                });
              }}
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

export function NamingSection(props: {
  draft: SettingsDraft;
  text: TextTools;
  promptPreview: PromptPreviewResponse | null;
  promptPreviewDirty: boolean;
  promptPreviewRefreshing: boolean;
  draftConfig: ConfigDocument;
  onOpenRequeue: () => void;
  onRefreshPromptPreview: (
    userConfig?: ConfigDocument,
    options?: { urgent?: boolean },
  ) => void | Promise<void>;
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
      copy: props.text.inline(
        "按选定格式输出日期或时间。",
        "Render date or time using the selected format.",
      ),
    },
    {
      value: "workspace",
      label: props.text.inline("工作区", "Workspace"),
      copy: props.text.inline(
        "工作区标签，通常来自 cwd / project。",
        "Workspace label, usually derived from cwd / project.",
      ),
    },
    {
      value: "project",
      label: props.text.inline("项目", "Project"),
      copy: props.text.inline(
        "项目目录名，适合做更短的路径信号。",
        "Project directory name for a shorter path signal.",
      ),
    },
    {
      value: "tag",
      label: props.text.inline("Tag", "Tag"),
      copy: props.text.inline("由 AI 选择的命名预设标签。", "AI-selected naming preset tag."),
    },
    {
      value: "kind",
      label: props.text.inline("Kind", "Kind"),
      copy: props.text.inline(
        "任务动作，例如 fix / design / review。",
        "Task action such as fix / design / review.",
      ),
    },
    {
      value: "scope",
      label: props.text.inline("Scope", "Scope"),
      copy: props.text.inline("主子系统或主话题。", "Primary subsystem or scope."),
    },
    {
      value: "summary",
      label: props.text.inline("Summary", "Summary"),
      copy: props.text.inline("标题正文与具体动作焦点。", "Main title body and concrete focus."),
    },
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
        ...(component === "timestamp" ? { format: DEFAULT_TIMESTAMP_PRESET } : {}),
      },
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
        value: separator,
      },
    ]);
    setCustomSeparator("");
  };
  const updateBuilderItem = (index: number, item: NamingBuilderItem) => {
    updateNamingBuilder(
      props.draft.namingBuilder.map((current, currentIndex) =>
        currentIndex === index ? item : current,
      ),
    );
  };
  const removeBuilderItem = (index: number) => {
    updateNamingBuilder(
      props.draft.namingBuilder.filter((_, currentIndex) => currentIndex !== index),
    );
  };
  const moveBuilderItem = (index: number, delta: number) => {
    updateNamingBuilder(moveItem(props.draft.namingBuilder, index, index + delta));
  };
  const contextStrategyOptions: ChoiceOption<RenameContextStrategy>[] = [
    {
      value: "summary-signals",
      label: props.text.inline("首尾摘要", "Summary signals"),
      description: props.text.inline(
        "首条用户 + 末条用户 + 末条助手。",
        "First user + last user + last assistant.",
      ),
    },
    {
      value: "last-user-last-assistant",
      label: props.text.inline("最后一轮", "Last turn pair"),
      description: props.text.inline(
        "只读最后一条用户和最后一条助手。",
        "Only the last user and the last assistant.",
      ),
    },
    {
      value: "user-assistant-transcript",
      label: props.text.inline("用户+助手全文", "User + assistant transcript"),
      description: props.text.inline(
        "读可见 user / assistant message。",
        "Read visible user / assistant messages.",
      ),
    },
    {
      value: "user-only-transcript",
      label: props.text.inline("仅用户全文", "User-only transcript"),
      description: props.text.inline(
        "只读用户消息，适合保留原始目标。",
        "Read only user messages to keep the original goal.",
      ),
    },
    {
      value: "assistant-only-transcript",
      label: props.text.inline("仅助手全文", "Assistant-only transcript"),
      description: props.text.inline(
        "只读助手消息，适合按产出总结。",
        "Read only assistant messages to summarize output.",
      ),
    },
    {
      value: "user-transcript-last-assistant",
      label: props.text.inline("用户全文 + 最后助手", "User transcript + last assistant"),
      description: props.text.inline(
        "读用户过程，再补最后一条助手总结。",
        "Read user history, then append the last assistant summary.",
      ),
    },
    {
      value: "paired-user-turns",
      label: props.text.inline("配对用户轮次", "Paired user turns"),
      description: props.text.inline(
        "每个用户轮次只挂前一段里最后一条有效助手结论。",
        "For each user turn, attach only the last substantive assistant from the preceding assistant cluster.",
      ),
    },
  ];

  return (
    <SettingsSectionFrame
      kicker={props.text.inline("Naming policy", "Naming policy")}
      title={props.text.inline("命名规则与标题结构", "Naming rules and title structure")}
      copy={props.text.inline(
        "设置上下文、标题结构和 Prompt。",
        "Set context, title structure, and prompt.",
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
                { value: "zh-CN", label: "中文" },
              ]}
              value={props.draft.uiLanguage}
            />
            <SelectField
              label={props.text.tt("defaultSortOrder")}
              onChange={(value) => {
                props.updateDraftField("sessionSortOrder", value);
              }}
              options={[
                {
                  value: "desc",
                  label: props.text.tt("sortNewestFirst"),
                  description: props.text.inline(
                    "最新的会话显示在最前面。",
                    "Newest sessions appear first.",
                  ),
                },
                {
                  value: "asc",
                  label: props.text.tt("sortOldestFirst"),
                  description: props.text.inline(
                    "最早的会话显示在最前面。",
                    "Oldest sessions appear first.",
                  ),
                },
              ]}
              value={props.draft.sessionSortOrder}
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
            <strong>
              {props.text.inline("上下文策略与输出语言", "Context strategy and output language")}
            </strong>
            <p>
              {props.text.inline(
                "选择上下文策略，并单独设置标题输出语言。",
                "Choose a context strategy and set the title output language separately.",
              )}
            </p>
          </div>
        </article>

        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">
                {props.text.inline("Naming builder", "Naming builder")}
              </p>
              <h4>
                {props.text.inline(
                  "结构化组件与最终标题预览",
                  "Structured components and final title preview",
                )}
              </h4>
              <p className="settings-copy">
                {props.text.inline(
                  "按顺序编辑标题组件并查看预览。",
                  "Edit title components in order and review the preview.",
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
                  description: props.text.inline(
                    "推荐。由组件和 AI 字段共同决定。",
                    "Recommended. Driven by components plus AI fields.",
                  ),
                },
                {
                  value: "prompt-override",
                  label: props.text.inline("Prompt 覆写", "Prompt override"),
                  description: props.text.inline(
                    "高级模式。允许直接改写命名指令。",
                    "Advanced mode. Allows direct prompt override.",
                  ),
                },
              ]}
              value={props.draft.namingCompositionMode}
            />
          </div>

          <div className="settings-builder-grid">
            <div className="settings-builder-column">
              <div className="settings-builder-strip">
                <span className="settings-builder-label">
                  {props.text.inline("可用组件", "Available components")}
                </span>
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
                <span className="settings-builder-label">
                  {props.text.inline("快捷分隔符", "Quick separators")}
                </span>
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
                  <button
                    className="btn-refresh"
                    onClick={() => addSeparator(customSeparator)}
                    type="button"
                  >
                    {props.text.inline("添加", "Add")}
                  </button>
                </div>
              </div>

              <div className="settings-builder-lane">
                {props.draft.namingBuilder.length === 0 ? (
                  <div className="settings-empty-state">
                    {props.text.inline(
                      "先从上方添加组件或分隔符。",
                      "Start by adding components or separators above.",
                    )}
                  </div>
                ) : null}
                {props.draft.namingBuilder.map((item, index) => {
                  const option =
                    item.type === "component"
                      ? namingComponentOptions.find(
                          (candidate) => candidate.value === item.component,
                        )
                      : undefined;

                  return (
                    <article
                      className={
                        item.type === "separator"
                          ? "settings-builder-card separator"
                          : "settings-builder-card"
                      }
                      key={`${item.type}-${index}-${item.type === "separator" ? item.value : item.component}`}
                    >
                      <div>
                        <strong>
                          {item.type === "separator"
                            ? props.text.inline(
                                `分隔符 ${JSON.stringify(item.value)}`,
                                `Separator ${JSON.stringify(item.value)}`,
                              )
                            : (option?.label ?? item.component)}
                        </strong>
                        <p>
                          {item.type === "separator"
                            ? props.text.inline(
                                "原样拼进最终标题。",
                                "Inserted into the final title verbatim.",
                              )
                            : option?.copy}
                        </p>
                      </div>
                      <div className="settings-builder-actions">
                        {item.type === "component" && item.component === "timestamp" ? (
                          <select
                            onChange={(event) => {
                              updateBuilderItem(index, {
                                ...item,
                                format: event.target.value as NamingTimestampPreset,
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
              <span className="settings-preview-kicker">
                {props.text.inline("预览", "Preview")}
              </span>
              <strong>{renderNamingStructurePreview(props.draft, props.text.uiLanguage)}</strong>
              <p>
                {props.text.inline(
                  "按当前组件顺序生成的标题示例。",
                  "A sample title generated from the current component order.",
                )}
              </p>
            </aside>
          </div>
        </article>

        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">
                {props.text.inline("AI tag presets", "AI tag presets")}
              </p>
              <h4>{props.text.inline("把规则做成可编辑预设", "Make rules editable presets")}</h4>
              <p className="settings-copy">
                {props.text.inline(
                  "为常见场景定义可复用的标签规则。",
                  "Define reusable tag rules for common scenarios.",
                )}
              </p>
            </div>
            <button
              className="btn-sm"
              onClick={() => {
                setDialogState({
                  mode: "create",
                  tag: blankTagDraft(),
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
                    tag,
                  });
                }}
                type="button"
              >
                <div className="settings-tag-card-header">
                  <span className={`settings-tag-pill ${tagToneClass(index)}`}>
                    #{renderTagLabel(tag, props.text.uiLanguage)}
                  </span>
                  <code>{tag.id}</code>
                </div>
                <p>{tag.description || props.text.inline("还没有说明。", "No description yet.")}</p>
                <small>
                  {tag.promptHint ||
                    props.text.inline("还没有 AI 规则提示。", "No AI rule hint yet.")}
                </small>
              </button>
            ))}

            {props.draft.namingTags.length === 0 ? (
              <div className="settings-empty-state">
                {props.text.inline(
                  "还没有自定义 tag 预设。可以直接添加，也可以先用默认目录。",
                  "No custom tag presets yet. Add one now or keep the default catalog.",
                )}
              </div>
            ) : null}
          </div>
        </article>

        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Override", "Override")}</p>
              <h4>
                {props.text.inline(
                  "给高级用户的 prompt 覆写",
                  "Prompt override for advanced users",
                )}
              </h4>
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
                "For example: always output a Chinese tag first, then a title with subsystem and action.",
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
              <h4>{props.text.inline("规则变更后的重新入队", "Requeue after rule changes")}</h4>
              <p className="settings-copy">
                {props.text.inline(
                  "在独立页面查看预览和入队结果。",
                  "Use the dedicated page to view preview and queue results.",
                )}
              </p>
            </div>
            <button className="btn-sm" onClick={props.onOpenRequeue} type="button">
              {props.text.inline("打开重新入队页", "Open requeue page")}
            </button>
          </div>
        </article>

        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.tt("promptPreview")}</p>
              <h4>
                {props.text.inline(
                  "命名策略实际发送给 AI 的 Prompt",
                  "The prompt actually sent to AI for naming",
                )}
              </h4>
              <p className="settings-copy">
                {props.text.inline(
                  "当前命名策略生成的 Prompt。",
                  "Prompt generated from the current naming policy.",
                )}
              </p>
            </div>
            <div className="settings-inline-actions">
              {props.promptPreviewDirty ? (
                <span className="chip warning">
                  {props.text.inline("预览未同步", "Preview out of date")}
                </span>
              ) : null}
              <button
                className="btn-sm"
                disabled={manualPromptPreviewRefreshing}
                onClick={() => {
                  void handleManualPromptPreviewRefresh();
                }}
                type="button"
              >
                {manualPromptPreviewRefreshing
                  ? props.text.tt("refreshing")
                  : props.text.tt("refresh")}
              </button>
            </div>
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
              (props.promptPreviewRefreshing
                ? props.text.tt("loadingPrompt")
                : props.text.tt("noPreviewLoaded"))}
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
                  namingTags: current.namingTags.filter(
                    (_, tagIndex) => tagIndex !== dialogState.index,
                  ),
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
                  tagIndex === dialogState.index ? tag : item,
                ),
              };
            }
            return {
              ...current,
              namingTags: [...current.namingTags, tag],
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
