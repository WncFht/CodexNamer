import { formatUiNumber } from "../../../i18n.js";
import {
  deriveRuntimeDisplay,
  runtimeDaemonStatusLabel,
  runtimeExecutionLabel,
} from "../../../runtime-display.js";
import type { DaemonControlStatus, OverviewResponse } from "../../../types.js";
import type { TextTools } from "../shared.js";
import { SettingsSectionFrame } from "../shared.js";

export function OverviewSection(props: {
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
      title={props.text.inline("命名系统总览", "Naming system overview")}
      copy={props.text.inline(
        "查看队列、命名和运行态。",
        "Review queue, naming, and runtime state.",
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
              <h4>
                {props.text.inline(
                  "正式命名与平均标题字数",
                  "Official names and average title length",
                )}
              </h4>
            </div>
          </div>
          <dl className="settings-runtime-grid compact">
            <div>
              <dt>{props.text.inline("AI 已应用", "AI applied")}</dt>
              <dd>
                {formatUiNumber(props.overview?.renameHistory.aiApplied, props.text.uiLanguage)}
              </dd>
            </div>
            <div>
              <dt>{props.text.inline("手动应用", "Manual applied")}</dt>
              <dd>
                {formatUiNumber(props.overview?.renameHistory.manualApplied, props.text.uiLanguage)}
              </dd>
            </div>
            <div>
              <dt>{props.text.inline("自动应用", "Auto applied")}</dt>
              <dd>
                {formatUiNumber(props.overview?.renameHistory.autoApplied, props.text.uiLanguage)}
              </dd>
            </div>
            <div>
              <dt>{props.text.inline("平均标题字数", "Average title length")}</dt>
              <dd>
                {formatUiNumber(props.overview?.workload.averageTitleLength, props.text.uiLanguage)}
              </dd>
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
              <dd>
                {runtimeDaemonStatusLabel(runtimeDisplay.daemonStatus, props.text.uiLanguage)}
              </dd>
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
