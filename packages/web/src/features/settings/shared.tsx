import { startTransition, type ReactNode } from "react";

import type { t } from "../../i18n.js";
import { addAppTransitionType } from "../../view-transitions.js";

export type SettingsSectionId = "overview" | "naming" | "ai" | "scheduler" | "runtime";
export type ChoiceOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
};
export type Translate = (key: Parameters<typeof t>[1]) => string;
export type InlineText = (zh: string, en: string) => string;
export type TextTools = {
  tt: Translate;
  inline: InlineText;
  uiLanguage: "en-US" | "zh-CN";
};

export const SECTION_ORDER: SettingsSectionId[] = ["naming", "ai", "scheduler", "runtime", "overview"];

export function SelectField<T extends string>(props: {
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

export function SettingsSummaryMetric(props: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="settings-summary-metric">
      <span className="settings-summary-metric-label">{props.label}</span>
      <strong>{props.value}</strong>
      <p>{props.detail}</p>
    </article>
  );
}

export function SettingsNav(props: {
  activeSection: SettingsSectionId;
  onChange: (section: SettingsSectionId) => void;
  text: TextTools;
}) {
  const labels: Record<SettingsSectionId, { title: string; copy: string }> = {
    naming: {
      title: props.text.inline("命名策略", "Naming policy"),
      copy: props.text.inline("规则、上下文和标题结构。", "Rules, context, and title structure.")
    },
    ai: {
      title: props.text.inline("AI 提供方", "AI provider"),
      copy: props.text.inline("后端、配置来源与 profile。", "Backend, source, and profiles.")
    },
    scheduler: {
      title: props.text.inline("调度阈值", "Scheduler"),
      copy: props.text.inline("自动应用与空闲阈值。", "Auto-apply and idle thresholds.")
    },
    runtime: {
      title: props.text.inline("运行时", "Runtime"),
      copy: props.text.inline("解析结果、路径与 provider 状态。", "Resolved paths, provider state, and runtime info.")
    },
    overview: {
      title: props.text.inline("总览", "Overview"),
      copy: props.text.inline("当前命名队列与系统状态。", "Current rename queue and system state.")
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

export function SettingsSectionFrame(props: {
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
