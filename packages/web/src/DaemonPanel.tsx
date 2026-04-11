import * as React from "react";

import { formatWhen } from "./browser-utils.js";
import { DaemonHero } from "./features/daemon/DaemonHero.js";
import { DaemonQueueCard } from "./features/daemon/DaemonQueueCard.js";
import { DaemonStatusCard } from "./features/daemon/DaemonStatusCard.js";
import { DaemonTechnicalDetails } from "./features/daemon/DaemonTechnicalDetails.js";
import {
  deriveRuntimeDisplay,
  runtimeDaemonStatusTone
} from "./runtime-display.js";
import type { AutoRenamePreviewResponse, DaemonControlStatus, OverviewResponse } from "./types.js";

function chipTone(running: boolean): "success" | "manual" {
  return running ? "success" : "manual";
}

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
      <DaemonHero
        actioning={props.actioning}
        inline={inline}
        onRefresh={props.onRefresh}
        onStart={props.onStart}
        onStop={props.onStop}
        running={Boolean(props.daemon?.running)}
      />

      <div className="settings-chip-row">
        <span className={`chip ${chipTone(Boolean(props.daemon?.running))}`}>
          {inline("后台状态", "Background status")}: {daemonStatusLabel(props.daemon, props.uiLanguage)}
        </span>
        <span className={`chip ${props.overview?.runtime.daemonAutoApply ? "success" : "warning"}`}>
          {inline("自动应用", "Auto apply")}:{" "}
          {props.overview?.runtime.daemonAutoApply ? inline("生效中", "active") : inline("未生效", "inactive")}
        </span>
        <span className={`chip ${props.daemon?.running ? "success" : "manual"}`}>
          {inline("下一轮定时 sweep", "Next scheduled sweep")}: {countdownLabel}
        </span>
        <span
          className={`chip ${runtimeDaemonStatusTone(runtimeDisplay.daemonStatus)}`}
        >
          {inline("最近 sweep", "Last sweep heartbeat")}: {formatWhen(props.overview?.runtime.lastSweepAt, props.uiLanguage)}
        </span>
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
