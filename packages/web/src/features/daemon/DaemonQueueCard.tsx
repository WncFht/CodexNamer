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
      <h4>{props.inline("只保留最关心的排队结果", "Keep only the queue numbers that matter")}</h4>
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
      <p className="settings-copy">
        {props.inline(
          "如果这里长期只有建议而没有自动应用，再去看下面的技术细节就够了。",
          "If this stays stuck on suggestions without auto-apply, the folded technical details below are usually enough for debugging."
        )}
      </p>
    </article>
  );
}
