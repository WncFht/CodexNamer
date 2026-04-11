import { formatWhen } from "../../browser-utils.js";
import { formatUiNumber, t, type UiLanguage } from "../../i18n.js";
import {
  runtimeExecutionLabel,
  runtimeExecutionTone,
  type RuntimeDaemonStatusDisplay,
  type RuntimeExecutionDisplay
} from "../../runtime-display.js";
import type { OverviewResponse } from "../../types.js";

export function OpsOverviewSection(props: {
  overview: OverviewResponse | null;
  runtimeDisplay: {
    execution: RuntimeExecutionDisplay;
    daemonStatus: RuntimeDaemonStatusDisplay;
    sweepRunning: boolean;
  };
  lastSweepSummary: OverviewResponse["runtime"]["lastSweepSummary"] | null | undefined;
  ruleBacklogCount: number;
  previewApplyCount: number;
  previewSuggestCount: number;
  activeAiRequestCount?: number;
  uiLanguage: UiLanguage;
  inline: (zh: string, en: string) => string;
  onRefreshRuntime: () => void | Promise<void>;
}) {
  const tt = (key: Parameters<typeof t>[1]) => t(props.uiLanguage, key);

  return (
    <section className="detail-panel ops-runtime-panel ops-span-wide">
      <div className="panel-topline ops-runtime-header">
        <div>
          <p className="panel-kicker">{props.inline("概览", "Overview")}</p>
          <h3>{props.inline("运行摘要与积压", "Runtime summary and backlog")}</h3>
          <p className="settings-copy">
            {props.runtimeDisplay.sweepRunning
              ? props.inline(
                  "后台 sweep 正在运行，先看执行模式、dirty / pending 和 AI 请求活跃数。",
                  "A background sweep is running. Focus first on execution mode, dirty/pending volume, and active AI requests."
                )
              : props.overview?.runtime.explain ||
                props.inline(
                  "先判断有没有在跑、有没有积压、下一步该去补扫还是看诊断。",
                  "Start by checking whether the system is running, whether work is piling up, and whether replay or diagnostics is the next step."
                )}
          </p>
        </div>
        <div className="header-actions">
          <button
            className="btn-sm"
            onClick={() => {
              void props.onRefreshRuntime();
            }}
            type="button"
          >
            {tt("refresh")}
          </button>
        </div>
      </div>

      <dl className="ops-runtime-inline-list">
        <div className={`ops-runtime-inline-item ${runtimeExecutionTone(props.runtimeDisplay.execution)}`}>
          <dt>{props.inline("实际执行", "Execution")}</dt>
          <dd>{runtimeExecutionLabel(props.runtimeDisplay.execution, props.uiLanguage)}</dd>
        </div>
        <div className={`ops-runtime-inline-item ${(props.lastSweepSummary?.pending ?? 0) > 0 ? "warning" : "success"}`}>
          <dt>{props.inline("本轮 dirty / 待扫", "Dirty / pending")}</dt>
          <dd>
            {formatUiNumber(props.lastSweepSummary?.dirtyTotal, props.uiLanguage)} /{" "}
            {formatUiNumber(props.lastSweepSummary?.pending, props.uiLanguage)}
          </dd>
        </div>
        <div className={`ops-runtime-inline-item ${props.ruleBacklogCount > 0 ? "warning" : "success"}`}>
          <dt>{props.inline("待补扫规则", "Replay backlog")}</dt>
          <dd>{formatUiNumber(props.ruleBacklogCount, props.uiLanguage)}</dd>
        </div>
        <div className={`ops-runtime-inline-item ${props.activeAiRequestCount ? "warning" : "manual"}`}>
          <dt>{props.inline("活跃 AI 请求", "Active AI requests")}</dt>
          <dd>{formatUiNumber(props.activeAiRequestCount, props.uiLanguage)}</dd>
        </div>
        <div className="ops-runtime-inline-item manual">
          <dt>{props.inline("最近一轮 Sweep", "Last sweep")}</dt>
          <dd>{formatWhen(props.overview?.runtime.lastSweepAt, props.uiLanguage)}</dd>
        </div>
      </dl>

      <div className="settings-metrics-grid ops-kpis">
        <article className="metric-card">
          <span className="metric-label">{props.inline("上一轮 Sweep 处理量", "Last sweep handled")}</span>
          <strong>{formatUiNumber(props.lastSweepSummary?.total, props.uiLanguage)}</strong>
          <p>
            {formatUiNumber(props.lastSweepSummary?.dirtyTotal, props.uiLanguage)} {props.inline("个 dirty 命中", "dirty found")} /{" "}
            {formatUiNumber(props.lastSweepSummary?.pending, props.uiLanguage)} {props.inline("个待下轮", "left pending")}
          </p>
        </article>
        <article className="metric-card">
          <span className="metric-label">{props.inline("Sweep 落盘结果", "Sweep apply result")}</span>
          <strong>{formatUiNumber(props.lastSweepSummary?.autoApplied, props.uiLanguage)}</strong>
          <p>
            {formatUiNumber(props.lastSweepSummary?.unchanged, props.uiLanguage)} {props.inline("未变化", "unchanged")} /{" "}
            {formatUiNumber(props.lastSweepSummary?.failedSuggestions, props.uiLanguage)} {props.inline("建议失败", "suggest failed")}
          </p>
        </article>
        <article className="metric-card">
          <span className="metric-label">{props.inline("规则覆盖状态", "Rule coverage")}</span>
          <strong>{formatUiNumber(props.ruleBacklogCount, props.uiLanguage)}</strong>
          <p>{formatUiNumber(props.overview?.ruleCoverage.latest, props.uiLanguage)} {props.inline("已对齐最新规则", "already latest")}</p>
        </article>
        <article className="metric-card">
          <span className="metric-label">{props.inline("当前即时评估", "Live preview queue")}</span>
          <strong>{formatUiNumber(props.previewApplyCount + props.previewSuggestCount, props.uiLanguage)}</strong>
          <p>
            {formatUiNumber(props.previewApplyCount, props.uiLanguage)} {props.inline("待应用", "apply")} /{" "}
            {formatUiNumber(props.previewSuggestCount, props.uiLanguage)} {props.inline("待建议", "suggest")}
          </p>
        </article>
      </div>
    </section>
  );
}
