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

function toDateTimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
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
  const REQUEUE_PAGE_SIZE = 10;
  const isChinese = uiLanguage === "zh-CN";
  const inline = React.useCallback((zh: string, en: string) => (isChinese ? zh : en), [isChinese]);
  const tt = React.useCallback((key: Parameters<typeof t>[1]) => t(uiLanguage, key), [uiLanguage]);
  const [replaySince, setReplaySince] = React.useState("");
  const [replayBasis, setReplayBasis] = React.useState<"session-updated-at" | "last-applied-at">("session-updated-at");
  const [preview, setPreview] = React.useState<RenameReplayPreviewResult | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [requeueing, setRequeueing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [previewPage, setPreviewPage] = React.useState(1);
  const [previewPageInput, setPreviewPageInput] = React.useState("1");

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
      setPreviewPage(1);
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
  const totalPreviewItems = preview?.items.length ?? 0;
  const totalPreviewPages = Math.max(1, Math.ceil(totalPreviewItems / REQUEUE_PAGE_SIZE));
  const visiblePreviewItems = React.useMemo(() => {
    const start = (previewPage - 1) * REQUEUE_PAGE_SIZE;
    return (preview?.items ?? []).slice(start, start + REQUEUE_PAGE_SIZE);
  }, [REQUEUE_PAGE_SIZE, preview?.items, previewPage]);

  React.useEffect(() => {
    const nextPage = Math.min(previewPage, totalPreviewPages);
    if (nextPage !== previewPage) {
      setPreviewPage(nextPage);
    }
  }, [previewPage, totalPreviewPages]);

  React.useEffect(() => {
    setPreviewPageInput(String(previewPage));
  }, [previewPage]);

  React.useEffect(() => {
    setPreview(null);
  }, [replayBasis, replaySince]);

  const handlePreviewPageJump = React.useCallback(() => {
    const parsed = Number(previewPageInput);
    if (!Number.isFinite(parsed)) {
      setPreviewPageInput(String(previewPage));
      return;
    }
    const nextPage = Math.max(1, Math.min(totalPreviewPages, Math.trunc(parsed)));
    setPreviewPage(nextPage);
    setPreviewPageInput(String(nextPage));
  }, [previewPage, previewPageInput, totalPreviewPages]);

  const applyPreset = React.useCallback((hoursBack: number) => {
    setReplaySince(toDateTimeLocalValue(new Date(Date.now() - hoursBack * 60 * 60 * 1000)));
  }, []);

  const applyLastRunPreset = React.useCallback(() => {
    if (!overview?.replay.lastRunAt) {
      return;
    }
    setReplaySince(toDateTimeLocalValue(new Date(overview.replay.lastRunAt)));
  }, [overview?.replay.lastRunAt]);

  const hasPreview = preview !== null;
  const hasQueuedItems = (preview?.queued ?? 0) > 0;

  return (
    <section className="panel-grid ops-layout">
      <section className="detail-panel ops-runtime-panel ops-span-wide">
        <div className="panel-topline ops-runtime-header">
          <div>
            <p className="panel-kicker">{inline("补扫旧标题", "Replay older titles")}</p>
            <h3>{inline("按新规则补跑旧标题", "Replay older titles with the latest rule")}</h3>
            <p className="settings-copy">
              {inline("按当前规则预览并重新入队旧标题。", "Preview and requeue older titles with the current rule.")}
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

        <div className="ops-log-summary-row">
          <span className="ops-log-summary-chip">
            {inline("当前规则签名", "Current rule signature")}: {shortRuleSignature(currentRuleSignature)}
          </span>
          <span className="ops-log-summary-chip">
            {inline("待补扫", "Needs replay")}: {formatUiNumber(coverage?.outdated, uiLanguage)}
          </span>
          <span className="ops-log-summary-chip">
            {inline("未知签名", "Unknown signature")}: {formatUiNumber(coverage?.unknown, uiLanguage)}
          </span>
          <span className="ops-log-summary-chip">
            {inline("最近执行", "Last run")}: {formatWhen(overview?.replay.lastRunAt, uiLanguage)}
          </span>
        </div>
      </section>

      <section className="detail-panel ops-replay-panel ops-span-wide">
        <div className="panel-topline">
          <div>
            <p className="panel-kicker">{inline("范围", "Range")}</p>
            <h3>{inline("选择补扫范围", "Choose replay range")}</h3>
            <p className="settings-copy">
              {inline("常用时间范围在这里，更多筛选在高级选项。", "Common time ranges appear here, with more filters in advanced options.")}
            </p>
          </div>
        </div>

        <div className="requeue-preset-row">
          <span className="requeue-preset-label">{inline("常用范围", "Quick ranges")}</span>
          <button className="btn-chip" onClick={() => applyPreset(24)} type="button">
            {inline("最近 24 小时", "Last 24 hours")}
          </button>
          <button className="btn-chip" onClick={() => applyPreset(24 * 7)} type="button">
            {inline("最近 7 天", "Last 7 days")}
          </button>
          <button
            className="btn-chip"
            disabled={!overview?.replay.lastRunAt}
            onClick={applyLastRunPreset}
            type="button"
          >
            {inline("自上次补扫以来", "Since last replay")}
          </button>
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
          <div className="requeue-actions">
            <button className="btn-sm" disabled={!replaySince || previewing} onClick={() => void handlePreview()} type="button">
              {previewing ? inline("预览中...", "Previewing...") : inline("预览匹配项", "Preview matches")}
            </button>
            {hasPreview ? (
              <button
                className="btn-sm primary"
                disabled={!replaySince || requeueing || !hasQueuedItems}
                onClick={() => void handleRequeue()}
                type="button"
              >
                {requeueing ? inline("重新入队中...", "Requeueing...") : inline("确认重新入队", "Confirm replay")}
              </button>
            ) : null}
          </div>
        </div>

        <details className="settings-disclosure ops-disclosure">
          <summary>{inline("高级选项", "Advanced options")}</summary>
          <div className="requeue-advanced-grid">
            <label className="ops-log-filter">
              <span>{inline("基准", "Basis")}</span>
              <select
                onChange={(event) =>
                  setReplayBasis(event.target.value as "session-updated-at" | "last-applied-at")
                }
                value={replayBasis}
              >
                <option value="session-updated-at">{inline("按会话更新时间", "Session updated at")}</option>
                <option value="last-applied-at">{inline("按上次正式命名时间", "Last applied at")}</option>
              </select>
            </label>
          </div>
        </details>

        {error ? <div className="ops-queue-empty">{error}</div> : null}

        {!hasPreview ? (
          <div className="ops-queue-empty requeue-placeholder">
            <strong>{inline("选择时间范围后查看预览", "Choose a time range to view the preview")}</strong>
            <span>{inline("预览结果会显示匹配、入队和跳过明细。", "The preview shows matched, queued, and skipped results.")}</span>
          </div>
        ) : (
          <>
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
                {inline("基准", "Basis")}: {replayBasisLabel(replayBasis, uiLanguage)}
              </span>
            </div>

            <div className="requeue-summary-grid">
              <article className="detail-panel requeue-summary-card" data-tone="success">
                <div className="panel-topline">
                  <div>
                    <p className="panel-kicker">{inline("会入队", "Will queue")}</p>
                    <h3>{inline("这些旧标题会被补跑", "These titles will be replayed")}</h3>
                  </div>
                </div>
                <div className="ops-skip-chip-list">
                  {queueCountEntries.length === 0 ? (
                    <span className="ops-log-summary-chip">{inline("当前没有入队项", "Nothing will queue")}</span>
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
                    <p className="panel-kicker">{inline("会跳过", "Will skip")}</p>
                    <h3>{inline("这些旧标题暂时不动", "These titles stay untouched")}</h3>
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
                    <th>{inline("动作", "Action")}</th>
                    <th>{inline("原因", "Reason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(preview?.items.length ?? 0) === 0 ? (
                    <tr>
                      <td className="ops-log-empty" colSpan={4}>
                        {inline("这个范围内没有匹配到旧标题。", "No older titles matched this range.")}
                      </td>
                    </tr>
                  ) : null}
                  {visiblePreviewItems.map((item) => (
                    <tr
                      className="ops-log-row"
                      data-status={item.action === "queue" ? "running" : undefined}
                      key={`${item.threadId}-${item.reason}`}
                    >
                      <td className="ops-log-col-time">
                        <div className="ops-log-primary ops-log-nowrap" title={item.updatedAt ?? ""}>
                          {formatWhen(item.updatedAt, uiLanguage)}
                        </div>
                        <div className="ops-log-secondary ops-log-nowrap">{replayBasisLabel(replayBasis, uiLanguage)}</div>
                      </td>
                      <td className="ops-log-col-info">
                        <div className="ops-log-primary" title={item.officialName ?? ""}>
                          {item.officialName ?? inline("还没有正式标题", "No official title")}
                        </div>
                        <div className="ops-log-secondary ops-log-nowrap" title={item.threadId}>
                          {item.threadId}
                        </div>
                      </td>
                      <td>
                        <span className={`chip ${actionTone(item.action, item.reason)}`}>
                          {item.action === "queue" ? inline("入队", "queue") : inline("跳过", "skip")}
                        </span>
                        <div className="ops-log-secondary ops-log-nowrap">
                          {ruleStatusLabel(item.ruleStatus, uiLanguage)}
                        </div>
                      </td>
                      <td className="ops-log-col-info">
                        <div className="ops-log-primary">{replayReasonLabel(item.reason, uiLanguage)}</div>
                        <div className="ops-log-secondary ops-log-nowrap">
                          {shortRuleSignature(currentRuleSignature)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPreviewItems > 0 ? (
              <div className="ops-log-pagination">
                <span className="ops-log-pagination-copy">
                  {inline("每页 10 条", "10 rows per page")} · {inline("当前显示", "Showing")}{" "}
                  {formatUiNumber((previewPage - 1) * REQUEUE_PAGE_SIZE + 1, uiLanguage)}-
                  {formatUiNumber((previewPage - 1) * REQUEUE_PAGE_SIZE + visiblePreviewItems.length, uiLanguage)} /{" "}
                  {formatUiNumber(totalPreviewItems, uiLanguage)}
                </span>
                <div className="ops-log-pagination-actions">
                  <button className="btn-sm" disabled={previewPage <= 1} onClick={() => setPreviewPage(1)} type="button">
                    {inline("首页", "First")}
                  </button>
                  <button
                    className="btn-sm"
                    disabled={previewPage <= 1}
                    onClick={() => setPreviewPage((page) => Math.max(1, page - 1))}
                    type="button"
                  >
                    {inline("上一页", "Prev")}
                  </button>
                  <button
                    className="btn-sm"
                    disabled={previewPage >= totalPreviewPages}
                    onClick={() => setPreviewPage((page) => Math.min(totalPreviewPages, page + 1))}
                    type="button"
                  >
                    {inline("下一页", "Next")}
                  </button>
                  <button
                    className="btn-sm"
                    disabled={previewPage >= totalPreviewPages}
                    onClick={() => setPreviewPage(totalPreviewPages)}
                    type="button"
                  >
                    {inline("末页", "Last")}
                  </button>
                  <div className="ops-log-page-jump">
                    <input
                      min={1}
                      onChange={(event) => setPreviewPageInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          handlePreviewPageJump();
                        }
                      }}
                      step={1}
                      type="number"
                      value={previewPageInput}
                    />
                    <button className="btn-sm" onClick={handlePreviewPageJump} type="button">
                      {inline("跳转", "Go")}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="detail-panel ops-span-wide">
        <div className="panel-topline">
          <div>
            <p className="panel-kicker">{inline("历史", "History")}</p>
            <h3>{inline("最近执行记录", "Recent replay runs")}</h3>
            <p className="settings-copy">{inline("查看最近的重新入队记录。", "View recent replay runs.")}</p>
          </div>
        </div>
        <details className="settings-disclosure ops-disclosure">
          <summary>{inline("展开最近执行记录", "Show recent replay runs")}</summary>
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
                  <span>
                    {formatUiNumber(run.queued, uiLanguage)} {inline("入队", "queued")}
                  </span>
                  <span>
                    {formatUiNumber(run.skipped, uiLanguage)} {inline("跳过", "skipped")}
                  </span>
                  <span>
                    {formatUiNumber(run.clearedCandidates, uiLanguage)} {inline("清空 candidate", "candidates cleared")}
                  </span>
                  <span>{formatWhen(run.requestedAt, uiLanguage)}</span>
                </div>
              </article>
            ))}
          </div>
        </details>
      </section>
    </section>
  );
}
