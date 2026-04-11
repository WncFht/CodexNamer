import * as React from "react";

import { formatWhen } from "./browser-utils.js";
import { DaemonQueueCard } from "./features/daemon/DaemonQueueCard.js";
import { DaemonStatusCard } from "./features/daemon/DaemonStatusCard.js";
import { DaemonTechnicalDetails } from "./features/daemon/DaemonTechnicalDetails.js";
import {
  deriveRuntimeDisplay,
  runtimeDaemonStatusTone
} from "./runtime-display.js";
import type { AutoRenamePreviewResponse, DaemonControlStatus, OverviewResponse } from "./types.js";

function deriveNextSweepAt(status: DaemonControlStatus | null, nowMs: number): string | undefined {
  if (!status?.running) {
    return undefined;
  }

  if (!status.startedAt || typeof status.intervalSeconds !== "number") {
    return undefined;
  }

  const startedAtMs = Date.parse(status.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return undefined;
  }

  const intervalMs = Math.max(1, Math.trunc(status.intervalSeconds)) * 1000;
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  const nextTickIndex = Math.floor(elapsedMs / intervalMs) + 1;
  return new Date(startedAtMs + nextTickIndex * intervalMs).toISOString();
}

function formatCountdown(targetAt: string | undefined, nowMs: number, language: "en-US" | "zh-CN"): string {
  if (!targetAt) {
    return "--";
  }

  const targetMs = Date.parse(targetAt);
  if (!Number.isFinite(targetMs)) {
    return "--";
  }

  const remainingSeconds = Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
  if (remainingSeconds <= 0) {
    return language === "zh-CN" ? "即将开始" : "due now";
  }

  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;

  if (hours > 0) {
    return language === "zh-CN"
      ? `${hours}小时 ${minutes}分 ${seconds}秒`
      : `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return language === "zh-CN" ? `${minutes}分 ${seconds}秒` : `${minutes}m ${seconds}s`;
  }
  return language === "zh-CN" ? `${seconds}秒` : `${seconds}s`;
}

function daemonStatusLabel(status: DaemonControlStatus | null, language: "en-US" | "zh-CN"): string {
  if (language === "zh-CN") {
    return status?.running ? "已启动" : "未启动";
  }
  return status?.running ? "running" : "stopped";
}

export function DaemonPanel(props: {
  daemon: DaemonControlStatus | null;
  overview: OverviewResponse | null;
  preview: AutoRenamePreviewResponse | null;
  actioning: "start" | "stop" | null;
  uiLanguage: "en-US" | "zh-CN";
  onRefresh: () => void;
  onStart: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
}) {
  const inline = React.useCallback(
    (zh: string, en: string) => (props.uiLanguage === "zh-CN" ? zh : en),
    [props.uiLanguage]
  );
  const previewApplyCount = props.preview?.items.filter((item) => item.status === "apply").length ?? 0;
  const previewSuggestCount = props.preview?.items.filter((item) => item.status === "suggest").length ?? 0;
  const lastSweep = props.overview?.runtime.lastSweepSummary;
  const runtimeDisplay = deriveRuntimeDisplay(props.overview, props.daemon);
  const [countdownNow, setCountdownNow] = React.useState(() => Date.now());
  const nextSweepAt = React.useMemo(
    () => deriveNextSweepAt(props.daemon, countdownNow),
    [countdownNow, props.daemon]
  );
  const countdownLabel = React.useMemo(
    () => formatCountdown(nextSweepAt, countdownNow, props.uiLanguage),
    [countdownNow, nextSweepAt, props.uiLanguage]
  );

  React.useEffect(() => {
    if (!props.daemon?.running) {
      return;
    }

    const timer = window.setInterval(() => {
      setCountdownNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [props.daemon?.running, nextSweepAt]);

  return (
    <section className="settings-layout daemon-layout">
      <header className="daemon-header">
        <div className="daemon-header-copy">
          <p className="panel-kicker">{inline("后台", "Background")}</p>
          <h2>{inline("先看运行态，再决定要不要排障", "Check runtime first, then decide whether debugging is needed")}</h2>
          <p>
            {inline(
              "大多数时候只需要确认 daemon 是否在跑、下一轮什么时候触发，以及当前积压有没有继续堆高。",
              "Most of the time you only need to know whether the daemon is alive, when the next sweep fires, and whether backlog is still growing."
            )}
          </p>
        </div>

        <div className="daemon-actions">
          <button className="btn-sm" onClick={props.onRefresh} type="button">
            {inline("刷新状态", "Refresh")}
          </button>
          {props.daemon?.running ? (
            <button
              className="btn-sm"
              disabled={props.actioning === "stop"}
              onClick={() => void props.onStop()}
              type="button"
            >
              {props.actioning === "stop" ? inline("停止中...", "Stopping...") : inline("停止后台", "Stop background worker")}
            </button>
          ) : (
            <button
              className="btn-sm primary"
              disabled={props.actioning === "start"}
              onClick={() => void props.onStart()}
              type="button"
            >
              {props.actioning === "start" ? inline("启动中...", "Starting...") : inline("启动后台", "Start background worker")}
            </button>
          )}
        </div>
      </header>

      <div className="daemon-summary-strip">
        <article className="settings-summary-metric daemon-summary-metric">
          <span className="settings-summary-metric-label">{inline("后台状态", "Background status")}</span>
          <strong>{daemonStatusLabel(props.daemon, props.uiLanguage)}</strong>
          <p>{inline("运行态心跳", "Runtime heartbeat")}: {formatWhen(props.overview?.runtime.lastSweepAt, props.uiLanguage)}</p>
        </article>
        <article className="settings-summary-metric daemon-summary-metric">
          <span className="settings-summary-metric-label">{inline("下一轮 sweep", "Next sweep")}</span>
          <strong>{countdownLabel}</strong>
          <p>{formatWhen(nextSweepAt, props.uiLanguage)}</p>
        </article>
        <article className="settings-summary-metric daemon-summary-metric">
          <span className="settings-summary-metric-label">{inline("当前积压", "Current backlog")}</span>
          <strong>{previewApplyCount + previewSuggestCount}</strong>
          <p>
            {previewApplyCount} {inline("待应用", "apply")} / {previewSuggestCount} {inline("待建议", "suggest")}
          </p>
        </article>
        <article className="settings-summary-metric daemon-summary-metric">
          <span className="settings-summary-metric-label">{inline("自动应用策略", "Auto-apply policy")}</span>
          <strong>{props.overview?.runtime.daemonAutoApply ? inline("生效中", "active") : inline("未生效", "inactive")}</strong>
          <p className={`daemon-summary-copy ${runtimeDaemonStatusTone(runtimeDisplay.daemonStatus)}`}>
            {props.overview?.runtime.configuredAutoApply ?? "--"}
          </p>
        </article>
      </div>

      <div className="settings-stage-grid daemon-grid">
        <DaemonStatusCard
          countdownLabel={countdownLabel}
          daemon={props.daemon}
          inline={inline}
          nextSweepAt={nextSweepAt}
          overview={props.overview}
          runtimeDisplay={runtimeDisplay}
          uiLanguage={props.uiLanguage}
        />
        <DaemonQueueCard
          inline={inline}
          lastSweep={lastSweep}
          overview={props.overview}
          previewApplyCount={previewApplyCount}
          previewSuggestCount={previewSuggestCount}
          runtimeDisplay={runtimeDisplay}
          uiLanguage={props.uiLanguage}
        />
      </div>

      <DaemonTechnicalDetails daemon={props.daemon} inline={inline} uiLanguage={props.uiLanguage} />
    </section>
  );
}
