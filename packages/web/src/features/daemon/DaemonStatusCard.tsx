import { formatWhen } from "../../browser-utils.js";
import {
  runtimeExecutionLabel,
  runtimeProgressExplanation,
  type RuntimeDaemonStatusDisplay,
  type RuntimeExecutionDisplay
} from "../../runtime-display.js";
import type { DaemonControlStatus, OverviewResponse } from "../../types.js";

export function DaemonStatusCard(props: {
  inline: (zh: string, en: string) => string;
  daemon: DaemonControlStatus | null;
  overview: OverviewResponse | null;
  runtimeDisplay: {
    execution: RuntimeExecutionDisplay;
    daemonStatus: RuntimeDaemonStatusDisplay;
    sweepRunning: boolean;
  };
  nextSweepAt?: string;
  countdownLabel: string;
  uiLanguage: "en-US" | "zh-CN";
}) {
  return (
    <article className="settings-surface-card">
      <p className="panel-kicker">{props.inline("后台状态", "Worker status")}</p>
      <h4>{props.inline("先看后台有没有在正常跑", "Check whether the background worker is healthy")}</h4>
      <dl className="settings-runtime-grid compact">
        <div>
          <dt>{props.inline("实际执行", "Execution")}</dt>
          <dd>{runtimeExecutionLabel(props.runtimeDisplay.execution, props.uiLanguage)}</dd>
        </div>
        <div>
          <dt>{props.inline("扫描间隔", "Scan interval")}</dt>
          <dd>
            {typeof props.daemon?.intervalSeconds === "number"
              ? `${props.daemon.intervalSeconds}s`
              : props.inline("跟随配置", "config default")}
          </dd>
        </div>
        <div>
          <dt>{props.inline("下一轮定时 sweep", "Next scheduled sweep")}</dt>
          <dd>{formatWhen(props.nextSweepAt, props.uiLanguage)}</dd>
        </div>
        <div>
          <dt>{props.inline("倒计时", "Countdown")}</dt>
          <dd>{props.countdownLabel}</dd>
        </div>
        <div>
          <dt>{props.inline("启动时间", "Started")}</dt>
          <dd>{formatWhen(props.daemon?.startedAt, props.uiLanguage)}</dd>
        </div>
        <div>
          <dt>{props.inline("说明", "Explanation")}</dt>
          <dd className="daemon-copy">
            {(props.runtimeDisplay.sweepRunning ? runtimeProgressExplanation(props.uiLanguage) : "") ||
              props.overview?.runtime.explain ||
              "--"}
          </dd>
        </div>
      </dl>
      <p className="settings-copy">
        {props.inline(
          "对多数使用者来说，这一块足够回答两个问题：后台有没有活着，下一轮什么时候会跑。",
          "For most people this is enough to answer two questions: is the worker alive, and when will it run again."
        )}
      </p>
    </article>
  );
}
