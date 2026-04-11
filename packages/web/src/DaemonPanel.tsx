import * as React from "react";

import { formatWhen } from "./browser-utils.js";
import {
  deriveRuntimeDisplay,
  runtimeDaemonStatusLabel,
  runtimeExecutionLabel,
  runtimeProgressExplanation
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
      <div className="settings-hero daemon-hero">
        <div className="settings-hero-copy">
          <p className="panel-kicker">{inline("后台自动命名", "Background automation")}</p>
          <h2>{inline("默认随 API 启动，通常只需要看它是否在正常跑", "Usually you only need to know whether it is running")}</h2>
          <p>
            {inline(
              "这里控制的是 session sweep daemon。默认会随 Local API 拉起，所以主界面只保留运行状态、下一轮时间和当前队列；更技术的进程细节收进下面的折叠区。",
              "This controls the session sweep daemon. It starts with the Local API by default, so the main view stays focused on status, next sweep timing, and the current queue while deeper process details stay folded below."
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
      </div>

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
          className={`chip ${
            runtimeDisplay.daemonStatus === "running" || runtimeDisplay.daemonStatus === "controller-running"
              ? "success"
              : "warning"
          }`}
        >
          {inline("最近 sweep", "Last sweep heartbeat")}:{" "}
          {formatWhen(props.overview?.runtime.lastSweepAt, props.uiLanguage)}
        </span>
      </div>

      <div className="settings-stage-grid daemon-grid">
        <article className="settings-surface-card">
          <p className="panel-kicker">{inline("后台状态", "Worker status")}</p>
          <h4>{inline("先看后台有没有在正常跑", "Check whether the background worker is healthy")}</h4>
          <dl className="settings-runtime-grid compact">
            <div>
              <dt>{inline("实际执行", "Execution")}</dt>
              <dd>{runtimeExecutionLabel(runtimeDisplay.execution, props.uiLanguage)}</dd>
            </div>
            <div>
              <dt>{inline("扫描间隔", "Scan interval")}</dt>
              <dd>
                {typeof props.daemon?.intervalSeconds === "number"
                  ? `${props.daemon.intervalSeconds}s`
                  : inline("跟随配置", "config default")}
              </dd>
            </div>
            <div>
              <dt>{inline("下一轮定时 sweep", "Next scheduled sweep")}</dt>
              <dd>{formatWhen(nextSweepAt, props.uiLanguage)}</dd>
            </div>
            <div>
              <dt>{inline("倒计时", "Countdown")}</dt>
              <dd>{countdownLabel}</dd>
            </div>
            <div>
              <dt>{inline("启动时间", "Started")}</dt>
              <dd>{formatWhen(props.daemon?.startedAt, props.uiLanguage)}</dd>
            </div>
            <div>
              <dt>{inline("说明", "Explanation")}</dt>
              <dd className="daemon-copy">
                {(runtimeDisplay.sweepRunning ? runtimeProgressExplanation(props.uiLanguage) : "") ||
                  props.overview?.runtime.explain ||
                  "--"}
              </dd>
            </div>
          </dl>
          <p className="settings-copy">
            {inline(
              "对多数使用者来说，这一块足够回答两个问题：后台有没有活着，下一轮什么时候会跑。",
              "For most people this is enough to answer two questions: is the worker alive, and when will it run again."
            )}
          </p>
        </article>

        <article className="settings-surface-card">
          <p className="panel-kicker">{inline("当前队列", "Current queue")}</p>
          <h4>{inline("只保留最关心的排队结果", "Keep only the queue numbers that matter")}</h4>
          <dl className="settings-runtime-grid compact">
            <div>
              <dt>{inline("建议", "Suggest")}</dt>
              <dd>{previewSuggestCount}</dd>
            </div>
            <div>
              <dt>{inline("可应用", "Apply")}</dt>
              <dd>{previewApplyCount}</dd>
            </div>
            <div>
              <dt>{inline("最近自动应用", "Auto applied")}</dt>
              <dd>{lastSweep?.autoApplied ?? 0}</dd>
            </div>
            <div>
              <dt>{inline("未变化", "Unchanged")}</dt>
              <dd>{lastSweep?.unchanged ?? 0}</dd>
            </div>
            <div>
              <dt>{inline("运行态心跳", "Runtime heartbeat")}</dt>
              <dd>{runtimeDaemonStatusLabel(runtimeDisplay.daemonStatus, props.uiLanguage)}</dd>
            </div>
            <div>
              <dt>{inline("配置策略", "Configured policy")}</dt>
              <dd>{props.overview?.runtime.configuredAutoApply ?? "--"}</dd>
            </div>
          </dl>
          <p className="settings-copy">
            {inline(
              "如果这里长期只有建议而没有自动应用，再去看下面的技术细节就够了。",
              "If this stays stuck on suggestions without auto-apply, the folded technical details below are usually enough for debugging."
            )}
          </p>
        </article>
      </div>

      <section className="detail-panel ops-span-wide">
        <div className="panel-topline">
          <div>
            <p className="panel-kicker">{inline("高级", "Advanced")}</p>
            <h3>{inline("技术细节与日志", "Technical details and logs")}</h3>
            <p className="settings-copy">
              {inline(
                "PID、启动命令和日志都保留，但默认收起，避免后台页看起来像纯运维面板。",
                "PID, launch command, and log tail are still available, but folded by default so this page does not read like a pure ops console."
              )}
            </p>
          </div>
        </div>
        <details className="settings-disclosure ops-disclosure">
          <summary>{inline("展开技术细节", "Show technical details")}</summary>
          <div className="daemon-advanced-grid">
            <article className="settings-surface-card daemon-command-card">
              <p className="panel-kicker">{inline("Process", "Process")}</p>
              <h4>{inline("进程与启动参数", "Process and launch details")}</h4>
              <dl className="settings-runtime-grid compact">
                <div>
                  <dt>PID</dt>
                  <dd>{props.daemon?.pid ?? inline("未启动", "stopped")}</dd>
                </div>
                <div>
                  <dt>{inline("API 进程", "API pid")}</dt>
                  <dd>{props.daemon?.apiProcessId ?? "--"}</dd>
                </div>
                <div>
                  <dt>{inline("停止时间", "Stopped")}</dt>
                  <dd>{formatWhen(props.daemon?.stoppedAt, props.uiLanguage)}</dd>
                </div>
                <div>
                  <dt>{inline("退出状态", "Exit")}</dt>
                  <dd>
                    {props.daemon?.lastExitCode ?? "--"}
                    {props.daemon?.lastExitSignal ? ` / ${props.daemon.lastExitSignal}` : ""}
                  </dd>
                </div>
              </dl>
              <p className="daemon-mono">
                {props.daemon?.command.executable ?? "node"} {props.daemon?.command.scriptPath ?? "--"}{" "}
                {props.daemon?.command.args.join(" ") ?? ""}
              </p>
              <p className="settings-copy">
                {inline("工作目录：", "Working directory: ")}
                <span className="daemon-mono">{props.daemon?.command.cwd ?? "--"}</span>
              </p>
              {props.daemon?.lastError ? (
                <p className="settings-copy daemon-error">
                  {inline("最近错误：", "Last error: ")}
                  {props.daemon.lastError}
                </p>
              ) : null}
            </article>

            <article className="settings-surface-card daemon-log-card">
              <p className="panel-kicker">{inline("Logs", "Logs")}</p>
              <h4>{inline("最近日志", "Recent log tail")}</h4>
              <div className="daemon-log">
                {props.daemon?.recentLogs?.length ? (
                  props.daemon.recentLogs.map((entry, index) => (
                    <div className={`daemon-log-line ${entry.stream}`} key={`${entry.at}-${index}`}>
                      <span className="daemon-log-time">{formatWhen(entry.at, props.uiLanguage)}</span>
                      <span className="daemon-log-stream">{entry.stream}</span>
                      <code>{entry.line}</code>
                    </div>
                  ))
                ) : (
                  <p className="settings-copy">{inline("还没有 daemon 日志。", "No daemon logs yet.")}</p>
                )}
              </div>
            </article>
          </div>
        </details>
      </section>
    </section>
  );
}
