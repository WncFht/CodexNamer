import { runtimeDaemonStatusLabel, type RuntimeDaemonStatusDisplay, type RuntimeExecutionDisplay } from "../../runtime-display.js";
import type { OverviewResponse } from "../../types.js";

export function DaemonQueueCard(props: {
  inline: (zh: string, en: string) => string;
  previewApplyCount: number;
  previewSuggestCount: number;
  lastSweep: OverviewResponse["runtime"]["lastSweepSummary"] | undefined;
  overview: OverviewResponse | null;
  runtimeDisplay: {
    execution: RuntimeExecutionDisplay;
    daemonStatus: RuntimeDaemonStatusDisplay;
    sweepRunning: boolean;
  };
  uiLanguage: "en-US" | "zh-CN";
}) {
  return (
    <article className="settings-surface-card">
      <p className="panel-kicker">{props.inline("当前队列", "Current queue")}</p>
      <h4>{props.inline("当前积压与落盘结果", "Backlog and recent landing result")}</h4>
      <dl className="settings-runtime-grid compact">
        <div>
          <dt>{props.inline("建议", "Suggest")}</dt>
          <dd>{props.previewSuggestCount}</dd>
        </div>
        <div>
          <dt>{props.inline("可应用", "Apply")}</dt>
          <dd>{props.previewApplyCount}</dd>
        </div>
        <div>
          <dt>{props.inline("最近自动应用", "Auto applied")}</dt>
          <dd>{props.lastSweep?.autoApplied ?? 0}</dd>
        </div>
        <div>
          <dt>{props.inline("未变化", "Unchanged")}</dt>
          <dd>{props.lastSweep?.unchanged ?? 0}</dd>
        </div>
        <div>
          <dt>{props.inline("运行态心跳", "Runtime heartbeat")}</dt>
          <dd>{runtimeDaemonStatusLabel(props.runtimeDisplay.daemonStatus, props.uiLanguage)}</dd>
        </div>
        <div>
          <dt>{props.inline("配置策略", "Configured policy")}</dt>
          <dd>{props.overview?.runtime.configuredAutoApply ?? "--"}</dd>
        </div>
      </dl>
    </article>
  );
}
