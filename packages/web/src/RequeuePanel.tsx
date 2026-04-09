import * as React from "react";

import { previewRequeueRenamesSince } from "./api.js";
import { formatWhen } from "./browser-utils.js";
import { formatUiNumber, t, type UiLanguage } from "./i18n.js";
import type { OverviewResponse, RenameReplayPreviewResult } from "./types.js";

function replayBasisLabel(
  basis: "session-updated-at" | "last-applied-at",
  language: UiLanguage
): string {
  if (language === "zh-CN") {
    return basis === "last-applied-at" ? "按上次正式命名时间" : "按会话更新时间";
  }
  return basis === "last-applied-at" ? "last applied at" : "session updated at";
}

function ruleStatusLabel(
  status: "latest" | "outdated" | "manual" | "unknown",
  language: UiLanguage
): string {
  if (language === "zh-CN") {
    switch (status) {
      case "latest":
        return "最新规则";
      case "outdated":
        return "规则落后";
      case "manual":
        return "手动命名";
      default:
        return "未知规则";
    }
  }

  switch (status) {
    case "latest":
      return "latest";
    case "outdated":
      return "outdated";
    case "manual":
      return "manual";
    default:
      return "unknown";
  }
}

function replayReasonLabel(reason: RenameReplayPreviewResult["items"][number]["reason"], language: UiLanguage): string {
  if (language === "zh-CN") {
    switch (reason) {
      case "rule_mismatch":
        return "规则签名不同";
      case "content_changed":
        return "内容有变化";
      case "legacy_unknown_rule":
        return "老数据无规则签名";
      case "already_latest_rule":
        return "已是最新规则";
      case "manual_name":
        return "手动命名";
      case "frozen":
        return "已冻结";
    }
  }

  switch (reason) {
    case "rule_mismatch":
      return "rule mismatch";
    case "content_changed":
      return "content changed";
    case "legacy_unknown_rule":
      return "legacy / unknown rule";
    case "already_latest_rule":
      return "already latest";
    case "manual_name":
      return "manual name";
    case "frozen":
      return "frozen";
  }
}

function shortRuleSignature(value: string | undefined): string {
  if (!value) {
    return "--";
  }
  if (value.length <= 16) {
    return value;
  }
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function actionTone(
  action: RenameReplayPreviewResult["items"][number]["action"],
  reason: RenameReplayPreviewResult["items"][number]["reason"]
): "success" | "warning" | "manual" {
  if (action === "queue") {
    return "success";
  }
  if (reason === "manual_name" || reason === "frozen") {
    return "manual";
  }
  return "warning";
}

export function RequeuePanel(props: {
  overview: OverviewResponse | null;
  uiLanguage: UiLanguage;
  onRefresh: () => void | Promise<void>;
  onRequeue: (params: {
    since: string;
    basis: "session-updated-at" | "last-applied-at";
  }) => Promise<unknown> | unknown;
}) {
  const { onRefresh, onRequeue, overview, uiLanguage } = props;
  const isChinese = uiLanguage === "zh-CN";
  const inline = React.useCallback((zh: string, en: string) => (isChinese ? zh : en), [isChinese]);
  const tt = React.useCallback((key: Parameters<typeof t>[1]) => t(uiLanguage, key), [uiLanguage]);
  const [replaySince, setReplaySince] = React.useState("");
  const [replayBasis, setReplayBasis] = React.useState<"session-updated-at" | "last-applied-at">("session-updated-at");
  const [preview, setPreview] = React.useState<RenameReplayPreviewResult | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [requeueing, setRequeueing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const currentRuleSignature =
    preview?.currentRuleSignature ||
    overview?.runtime.currentRuleSignature ||
    overview?.ruleCoverage.currentSignature ||
    "";
  const recentRuns = overview?.replay.recentRuns ?? [];
  const coverage = overview?.ruleCoverage;

  const handlePreview = React.useCallback(async () => {
    if (!replaySince || previewing) {
      return;
    }
    setPreviewing(true);
    setError(null);
    try {
      const result = await previewRequeueRenamesSince({
        since: new Date(replaySince).toISOString(),
        basis: replayBasis
      });
      setPreview(result);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setPreviewing(false);
    }
  }, [previewing, replayBasis, replaySince]);

  const handleRequeue = React.useCallback(async () => {
    if (!replaySince || requeueing) {
      return;
    }
    setRequeueing(true);
    setError(null);
    try {
      await onRequeue({
        since: new Date(replaySince).toISOString(),
        basis: replayBasis
      });
      await Promise.resolve(onRefresh());
      await handlePreview();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setRequeueing(false);
    }
  }, [handlePreview, onRefresh, onRequeue, replayBasis, replaySince, requeueing]);

  const queueCountEntries = React.useMemo(
    () =>
      Object.entries(preview?.queueCounts ?? {}).sort((left, right) => right[1] - left[1]),
    [preview?.queueCounts]
  );
  const skipCountEntries = React.useMemo(
    () =>
      Object.entries(preview?.skipCounts ?? {}).sort((left, right) => right[1] - left[1]),
    [preview?.skipCounts]
  );

  return (
    <section className="panel-grid ops-layout">
      <section className="detail-panel ops-runtime-panel ops-span-wide">
        <div className="panel-topline ops-runtime-header">
          <div>
            <p className="panel-kicker">{inline("Requeue", "Requeue")}</p>
            <h3>{inline("按规则签名重新归队", "Requeue by rule signature")}</h3>
            <p className="settings-copy">
              {inline(
                "系统只有一套全局命名规则，但每次正式命名都会记录当时的规则签名。这里先做预览，再只把签名落后、内容变化或老数据未知签名的会话重新入队。",
                "The system keeps one global naming strategy, but every applied rename stores the rule signature used at the time. Preview here first, then requeue only sessions whose signatures are outdated, whose content changed, or whose legacy state has no stored signature."
              )}
            </p>
          </div>
          <div className="header-actions">
            <button
              className="btn-sm"
              onClick={() => {
                void onRefresh();
              }}
              type="button"
            >
              {tt("refresh")}
            </button>
          </div>
        </div>

        <div className="ops-runtime-badges">
          <span className="chip manual">
            {inline("当前规则签名", "Current rule signature")}: {shortRuleSignature(currentRuleSignature)}
          </span>
          <span className="chip success">
            {inline("最新覆盖", "Latest coverage")}: {formatUiNumber(coverage?.latest, uiLanguage)}
          </span>
          <span className={`chip ${(coverage?.outdated ?? 0) > 0 ? "warning" : "manual"}`}>
            {inline("落后规则", "Outdated")}: {formatUiNumber(coverage?.outdated, uiLanguage)}
          </span>
          <span className="chip manual">
            {inline("手动命名", "Manual")}: {formatUiNumber(coverage?.manual, uiLanguage)}
          </span>
          <span className="chip manual">
            {inline("未知规则", "Unknown")}: {formatUiNumber(coverage?.unknown, uiLanguage)}
          </span>
          <span className="chip manual">
            {inline("最近执行", "Last run")}: {formatWhen(overview?.replay.lastRunAt, uiLanguage)}
          </span>
        </div>

        <div className="settings-metrics-grid ops-kpis">
          <article className="metric-card">
            <span className="metric-label">{inline("已对齐最新规则", "Latest rule sessions")}</span>
            <strong>{formatUiNumber(coverage?.latest, uiLanguage)}</strong>
            <p>{inline("这些会话已按当前全局规则正式命名。", "These sessions already landed with the current global rule.")}</p>
          </article>
          <article className="metric-card">
            <span className="metric-label">{inline("待规则迁移", "Needs rule migration")}</span>
            <strong>{formatUiNumber(coverage?.outdated, uiLanguage)}</strong>
            <p>{inline("这些会话的正式命名签名落后于当前规则。", "These sessions were applied under an older rule signature.")}</p>
          </article>
          <article className="metric-card">
            <span className="metric-label">{inline("手动保持", "Manual keep")}</span>
            <strong>{formatUiNumber(coverage?.manual, uiLanguage)}</strong>
            <p>{inline("手动命名的会话默认在归队时跳过。", "Manually named sessions are skipped by default during requeue.")}</p>
          </article>
          <article className="metric-card">
            <span className="metric-label">{inline("未知签名", "Unknown signature")}</span>
            <strong>{formatUiNumber(coverage?.unknown, uiLanguage)}</strong>
            <p>{inline("老数据没有记录规则签名，通常需要补扫一次。", "Legacy sessions without a stored signature usually need one replay pass.")}</p>
          </article>
        </div>
      </section>

      <section className="detail-panel ops-replay-panel ops-span-wide">
        <div className="panel-topline">
          <div>
            <p className="panel-kicker">{inline("Preview", "Preview")}</p>
            <h3>{inline("先看会进队还是会跳过", "Preview queue vs skip first")}</h3>
            <p className="settings-copy">
              {inline(
                "重新归队前先做一轮预览，明确看到每个会话为什么会入队或跳过。",
                "Run a preview first so every session shows exactly why it will queue or skip."
              )}
            </p>
          </div>
        </div>

        <div className="ops-replay-form">
          <label className="ops-log-filter">
            <span>{inline("起始时间", "Since")}</span>
            <input
              onChange={(event) => setReplaySince(event.target.value)}
              type="datetime-local"
              value={replaySince}
            />
          </label>
          <label className="ops-log-filter">
            <span>{inline("基准", "Basis")}</span>
            <select
              onChange={(event) => setReplayBasis(event.target.value as "session-updated-at" | "last-applied-at")}
              value={replayBasis}
            >
              <option value="session-updated-at">{inline("按会话更新时间", "Session updated at")}</option>
              <option value="last-applied-at">{inline("按上次正式命名时间", "Last applied at")}</option>
            </select>
          </label>
          <div className="requeue-actions">
            <button className="btn-sm" disabled={!replaySince || previewing} onClick={() => void handlePreview()} type="button">
              {previewing ? inline("预览中...", "Previewing...") : inline("预览队列", "Preview queue")}
            </button>
            <button className="btn-sm primary" disabled={!replaySince || requeueing} onClick={() => void handleRequeue()} type="button">
              {requeueing ? inline("重新入队中...", "Requeueing...") : inline("执行重新入队", "Run requeue")}
            </button>
          </div>
        </div>

        {error ? <div className="ops-queue-empty">{error}</div> : null}

        <div className="ops-log-summary-row">
          <span className="ops-log-summary-chip">
            {inline("匹配到", "Matched")}: {formatUiNumber(preview?.matched, uiLanguage)}
          </span>
          <span className="ops-log-summary-chip">
            {inline("将入队", "Will queue")}: {formatUiNumber(preview?.queued, uiLanguage)}
          </span>
          <span className="ops-log-summary-chip">
            {inline("将跳过", "Will skip")}: {formatUiNumber(preview?.skipped, uiLanguage)}
          </span>
          <span className="ops-log-summary-chip">
            {inline("当前签名", "Current signature")}: {shortRuleSignature(currentRuleSignature)}
          </span>
        </div>

        <div className="requeue-summary-grid">
          <article className="detail-panel requeue-summary-card" data-tone="success">
            <div className="panel-topline">
              <div>
                <p className="panel-kicker">{inline("入队原因", "Queue reasons")}</p>
                <h3>{inline("哪些会进入待处理队列", "What will enter the queue")}</h3>
              </div>
            </div>
            <div className="ops-skip-chip-list">
              {queueCountEntries.length === 0 ? (
                <span className="ops-log-summary-chip">{inline("还没有预览结果", "No preview yet")}</span>
              ) : null}
              {queueCountEntries.map(([reason, count]) => (
                <span className="ops-log-summary-chip" key={reason}>
                  {replayReasonLabel(reason as RenameReplayPreviewResult["items"][number]["reason"], uiLanguage)}:{" "}
                  {formatUiNumber(count, uiLanguage)}
                </span>
              ))}
            </div>
          </article>

          <article className="detail-panel requeue-summary-card" data-tone="warning">
            <div className="panel-topline">
              <div>
                <p className="panel-kicker">{inline("跳过原因", "Skip reasons")}</p>
                <h3>{inline("哪些会被跳过", "What will be skipped")}</h3>
              </div>
            </div>
            <div className="ops-skip-chip-list">
              {skipCountEntries.length === 0 ? (
                <span className="ops-log-summary-chip">{inline("当前没有跳过项", "No skipped items")}</span>
              ) : null}
              {skipCountEntries.map(([reason, count]) => (
                <span className="ops-log-summary-chip" key={reason}>
                  {replayReasonLabel(reason as RenameReplayPreviewResult["items"][number]["reason"], uiLanguage)}:{" "}
                  {formatUiNumber(count, uiLanguage)}
                </span>
              ))}
            </div>
          </article>
        </div>

        <div className="ops-log-table-container">
          <table className="ops-log-table">
            <thead>
              <tr>
                <th>{inline("时间", "Time")}</th>
                <th>{inline("正式标题", "Official title")}</th>
                <th>Thread</th>
                <th>{inline("规则状态", "Rule state")}</th>
                <th>{inline("动作", "Action")}</th>
                <th>{inline("原因", "Reason")}</th>
              </tr>
            </thead>
            <tbody>
              {(preview?.items.length ?? 0) === 0 ? (
                <tr>
                  <td className="ops-log-empty" colSpan={6}>
                    {inline("先选择时间并执行预览。", "Choose a timestamp and run preview first.")}
                  </td>
                </tr>
              ) : null}
              {preview?.items.map((item) => (
                <tr className="ops-log-row" data-status={item.action === "queue" ? "running" : undefined} key={`${item.threadId}-${item.reason}`}>
                  <td className="ops-log-col-time">
                    <div className="ops-log-primary ops-log-nowrap" title={item.updatedAt ?? ""}>
                      {formatWhen(item.updatedAt, uiLanguage)}
                    </div>
                    <div className="ops-log-secondary ops-log-nowrap">{replayBasisLabel(replayBasis, uiLanguage)}</div>
                  </td>
                  <td className="ops-log-col-info">
                    <div className="ops-log-primary" title={item.officialName ?? ""}>{item.officialName ?? inline("还没有正式标题", "No official title")}</div>
                  </td>
                  <td className="ops-log-mono ops-log-col-thread" title={item.threadId}>{item.threadId}</td>
                  <td>
                    <span className={`chip ${item.ruleStatus === "outdated" ? "warning" : item.ruleStatus === "latest" ? "success" : "manual"}`}>
                      {ruleStatusLabel(item.ruleStatus, uiLanguage)}
                    </span>
                  </td>
                  <td>
                    <span className={`chip ${actionTone(item.action, item.reason)}`}>
                      {item.action === "queue" ? inline("入队", "queue") : inline("跳过", "skip")}
                    </span>
                  </td>
                  <td className="ops-log-col-info">
                    <div className="ops-log-primary">{replayReasonLabel(item.reason, uiLanguage)}</div>
                    <div className="ops-log-secondary ops-log-nowrap">{shortRuleSignature(currentRuleSignature)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="detail-panel ops-span-wide">
        <div className="panel-topline">
          <div>
            <p className="panel-kicker">{inline("History", "History")}</p>
            <h3>{inline("最近的归队执行记录", "Recent requeue runs")}</h3>
          </div>
        </div>
        <div className="history-stack">
          {recentRuns.length === 0 ? (
            <div className="ops-queue-empty">{inline("还没有重新入队记录。", "No requeue runs recorded yet.")}</div>
          ) : null}
          {recentRuns.map((run) => (
            <article className="history-row" key={`${run.requestedAt}-${run.since}-${run.basis}`}>
              <div>
                <strong>{replayBasisLabel(run.basis, uiLanguage)}</strong>
                <p>
                  {inline("起点", "Since")}: {formatWhen(run.since, uiLanguage)}
                </p>
              </div>
              <div className="ops-replay-run-meta">
                <span>{formatUiNumber(run.queued, uiLanguage)} {inline("入队", "queued")}</span>
                <span>{formatUiNumber(run.skipped, uiLanguage)} {inline("跳过", "skipped")}</span>
                <span>{formatUiNumber(run.clearedCandidates, uiLanguage)} {inline("清空 candidate", "candidates cleared")}</span>
                <span>{formatWhen(run.requestedAt, uiLanguage)}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
