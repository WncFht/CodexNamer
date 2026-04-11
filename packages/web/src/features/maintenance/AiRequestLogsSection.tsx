import { formatWhen } from "../../browser-utils.js";
import { formatUiNumber, t, type UiLanguage } from "../../i18n.js";
import type { AiRequestLogDetailResponse, AiRequestLogResponse } from "../../types.js";

function formatDurationMs(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} s`;
}

function aiRequestStatusTone(status: string | undefined): "success" | "warning" | "danger" | "manual" {
  if (status === "succeeded") {
    return "success";
  }
  if (status === "running") {
    return "warning";
  }
  if (status === "failed") {
    return "danger";
  }
  return "manual";
}

function aiRequestStatusLabel(status: string | undefined, language: UiLanguage): string {
  if (status === "succeeded") {
    return language === "zh-CN" ? "成功" : "Succeeded";
  }
  if (status === "running") {
    return language === "zh-CN" ? "进行中" : "Running";
  }
  if (status === "failed") {
    return language === "zh-CN" ? "失败" : "Failed";
  }
  return language === "zh-CN" ? "未知" : "Unknown";
}

export type AiRequestLogsSectionProps = {
  aiRequestLogs: AiRequestLogResponse | null;
  aiRequestLogDetail: AiRequestLogDetailResponse | null;
  previewRefreshing: boolean;
  requestLogLoading: boolean;
  visibleAiRequests: AiRequestLogResponse["items"];
  totalFilteredAiRequests: number;
  totalLogPages: number;
  filteredRunningCount: number;
  filteredSucceededCount: number;
  filteredFailedCount: number;
  latestAiRequest?: AiRequestLogResponse["items"][number];
  projectOptions: Array<{ value: string; label: string }>;
  logQuery: string;
  logProjectFilter: string;
  logStatusFilter: "all" | "running" | "succeeded" | "failed";
  logTransportFilter: "all" | "responses" | "openai-compatible";
  logPage: number;
  logPageInput: string;
  LOGS_PER_PAGE: number;
  noDataLabel: string;
  inline: (zh: string, en: string) => string;
  uiLanguage: UiLanguage;
  selectedRequestLogId?: number;
  onSelectRequestLog: (id?: number) => void;
  onSetLogQuery: (value: string) => void;
  onSetLogProjectFilter: (value: string) => void;
  onSetLogStatusFilter: (value: "all" | "running" | "succeeded" | "failed") => void;
  onSetLogTransportFilter: (value: "all" | "responses" | "openai-compatible") => void;
  onSetLogPage: (updater: number | ((page: number) => number)) => void;
  onSetLogPageInput: (value: string) => void;
  onHandleLogPageJump: () => void;
  onRefreshRuntime: () => void | Promise<void>;
  onReloadRequestLogs: () => void | Promise<void>;
  onRefreshPreview: (options?: { includeCandidateNames?: boolean; urgent?: boolean }) => void | Promise<void>;
};

export function AiRequestLogsSection(props: AiRequestLogsSectionProps) {
  const tt = (key: Parameters<typeof t>[1]) => t(props.uiLanguage, key);

  return (
    <section className="detail-panel ops-log-panel">
      <div className="panel-topline ops-log-panel-header">
        <div>
          <p className="panel-kicker">AI</p>
          <h3>{props.inline("模型请求日志", "Model request logs")}</h3>
          <p className="settings-copy">
            {props.inline(
              "先筛选，再扫表格。这里主要回答三件事：现在有没有请求、最近慢在哪、失败落在哪一层。",
              "Filter first, then scan the table. This mainly answers three questions: is anything active now, where is latency accumulating, and which layer is failing."
            )}
          </p>
        </div>
        <div className="header-actions">
          <button
            className="btn-sm"
            onClick={() => {
              void props.onRefreshPreview({ includeCandidateNames: true, urgent: true });
            }}
            type="button"
          >
            {props.previewRefreshing
              ? props.inline("候选名载入中...", "Loading candidate names...")
              : props.inline("按需载入候选名", "Load candidate names")}
          </button>
          <span className={`chip ${props.aiRequestLogs?.activeCount ? "warning" : "manual"}`}>
            {props.inline("活跃中", "Active")}: {formatUiNumber(props.aiRequestLogs?.activeCount, props.uiLanguage)}
          </span>
        </div>
      </div>

      <div className="ops-log-toolbar">
        <label className="ops-log-filter ops-log-filter-search">
          <span>{props.inline("搜索", "Search")}</span>
          <input
            onChange={(event) => props.onSetLogQuery(event.target.value)}
            placeholder={props.inline("项目 / thread / 模型 / 错误", "project / thread / model / error")}
            type="search"
            value={props.logQuery}
          />
        </label>
        <label className="ops-log-filter">
          <span>{props.inline("项目", "Project")}</span>
          <select onChange={(event) => props.onSetLogProjectFilter(event.target.value)} value={props.logProjectFilter}>
            <option value="all">{props.inline("全部", "All")}</option>
            {props.projectOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ops-log-filter">
          <span>{props.inline("状态", "Status")}</span>
          <select
            onChange={(event) => props.onSetLogStatusFilter(event.target.value as "all" | "running" | "succeeded" | "failed")}
            value={props.logStatusFilter}
          >
            <option value="all">{props.inline("全部", "All")}</option>
            <option value="running">{props.inline("进行中", "Running")}</option>
            <option value="succeeded">{props.inline("成功", "Succeeded")}</option>
            <option value="failed">{props.inline("失败", "Failed")}</option>
          </select>
        </label>
        <label className="ops-log-filter">
          <span>{props.inline("传输", "Transport")}</span>
          <select
            onChange={(event) => props.onSetLogTransportFilter(event.target.value as "all" | "responses" | "openai-compatible")}
            value={props.logTransportFilter}
          >
            <option value="all">{props.inline("全部", "All")}</option>
            <option value="responses">responses</option>
            <option value="openai-compatible">openai-compatible</option>
          </select>
        </label>
        <button
          className="btn-sm"
          onClick={() => {
            void Promise.all([Promise.resolve(props.onRefreshRuntime()), Promise.resolve(props.onReloadRequestLogs())]);
          }}
          type="button"
        >
          {tt("refresh")}
        </button>
      </div>

      <div className="ops-log-summary-row">
        <span className="ops-log-summary-chip">
          {props.inline("筛选结果", "Filtered")}: {formatUiNumber(props.totalFilteredAiRequests, props.uiLanguage)}
        </span>
        <span className="ops-log-summary-chip">
          {props.inline("页码", "Page")}: {formatUiNumber(props.logPage, props.uiLanguage)} / {formatUiNumber(props.totalLogPages, props.uiLanguage)}
        </span>
        <span className="ops-log-summary-chip">
          {props.inline("进行中", "Running")}: {formatUiNumber(props.filteredRunningCount, props.uiLanguage)}
        </span>
        <span className="ops-log-summary-chip">
          {props.inline("成功", "Succeeded")}: {formatUiNumber(props.filteredSucceededCount, props.uiLanguage)}
        </span>
        <span className="ops-log-summary-chip">
          {props.inline("失败", "Failed")}: {formatUiNumber(props.filteredFailedCount, props.uiLanguage)}
        </span>
        <span className="ops-log-summary-chip">
          {props.inline("最近完成", "Last finished")}: {formatWhen(props.aiRequestLogs?.lastFinishedAt, props.uiLanguage)}
        </span>
        {props.requestLogLoading ? <span className="ops-log-summary-chip">{props.inline("日志加载中...", "Loading logs...")}</span> : null}
      </div>

      {props.totalFilteredAiRequests > 0 ? (
        <div className="ops-log-pagination">
          <span className="ops-log-pagination-copy">
            {props.inline("每页 10 条", "10 rows per page")} · {props.inline("当前显示", "Showing")} {formatUiNumber((props.logPage - 1) * props.LOGS_PER_PAGE + 1, props.uiLanguage)}-
            {formatUiNumber((props.logPage - 1) * props.LOGS_PER_PAGE + props.visibleAiRequests.length, props.uiLanguage)} / {formatUiNumber(props.totalFilteredAiRequests, props.uiLanguage)}
          </span>
          <div className="ops-log-pagination-actions">
            <button className="btn-sm" disabled={props.logPage <= 1} onClick={() => props.onSetLogPage(1)} type="button">
              {props.inline("首页", "First")}
            </button>
            <button className="btn-sm" disabled={props.logPage <= 1} onClick={() => props.onSetLogPage((page) => Math.max(1, page - 1))} type="button">
              {props.inline("上一页", "Prev")}
            </button>
            <button className="btn-sm" disabled={props.logPage >= props.totalLogPages} onClick={() => props.onSetLogPage((page) => Math.min(props.totalLogPages, page + 1))} type="button">
              {props.inline("下一页", "Next")}
            </button>
            <button className="btn-sm" disabled={props.logPage >= props.totalLogPages} onClick={() => props.onSetLogPage(props.totalLogPages)} type="button">
              {props.inline("末页", "Last")}
            </button>
            <div className="ops-log-page-jump">
              <input
                min={1}
                onChange={(event) => props.onSetLogPageInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    props.onHandleLogPageJump();
                  }
                }}
                step={1}
                type="number"
                value={props.logPageInput}
              />
              <button className="btn-sm" onClick={props.onHandleLogPageJump} type="button">
                {props.inline("跳转", "Go")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {props.aiRequestLogDetail ? (
        <div className="detail-panel">
          <div className="panel-topline">
            <div>
              <p className="panel-kicker">AI Trace</p>
              <h3>{props.inline("请求详情", "Request detail")}</h3>
            </div>
            <button className="btn-sm" onClick={() => props.onSelectRequestLog(undefined)} type="button">
              {props.inline("返回日志列表", "Back to logs")}
            </button>
          </div>
          <dl className="settings-runtime-grid compact ops-log-detail-grid">
            <div><dt>ID</dt><dd className="ops-log-mono">{props.aiRequestLogDetail.id}</dd></div>
            <div><dt>{props.inline("项目", "Project")}</dt><dd>{props.aiRequestLogDetail.projectName ?? props.noDataLabel}</dd></div>
            <div><dt>Thread</dt><dd className="ops-log-mono">{props.aiRequestLogDetail.threadId}</dd></div>
            <div><dt>{props.inline("状态", "Status")}</dt><dd>{aiRequestStatusLabel(props.aiRequestLogDetail.status, props.uiLanguage)}</dd></div>
            <div><dt>{props.inline("开始时间", "Started at")}</dt><dd title={props.aiRequestLogDetail.startedAt}>{formatWhen(props.aiRequestLogDetail.startedAt, props.uiLanguage)}</dd></div>
            <div><dt>{props.inline("结束时间", "Finished at")}</dt><dd title={props.aiRequestLogDetail.finishedAt ?? ""}>{formatWhen(props.aiRequestLogDetail.finishedAt, props.uiLanguage)}</dd></div>
            <div><dt>{props.inline("耗时", "Duration")}</dt><dd>{formatDurationMs(props.aiRequestLogDetail.durationMs)}</dd></div>
            <div><dt>{props.inline("模型", "Model")}</dt><dd>{props.aiRequestLogDetail.model ?? props.noDataLabel}</dd></div>
            <div><dt>{props.inline("后端", "Backend")}</dt><dd>{props.aiRequestLogDetail.backend}</dd></div>
            <div><dt>{props.inline("传输", "Transport")}</dt><dd>{props.aiRequestLogDetail.transport}</dd></div>
            <div><dt>{props.inline("请求后端", "Requested backend")}</dt><dd>{props.aiRequestLogDetail.metadata?.requestedBackend ?? props.aiRequestLogDetail.backend}</dd></div>
            <div><dt>{props.inline("接口", "Endpoint")}</dt><dd className="ops-log-mono">{props.aiRequestLogDetail.baseUrl ?? props.noDataLabel}</dd></div>
            <div><dt>{props.inline("Provider ref", "Provider ref")}</dt><dd className="ops-log-mono">{props.aiRequestLogDetail.metadata?.providerRef ?? props.noDataLabel}</dd></div>
            <div><dt>{props.inline("Profile", "Profile")}</dt><dd className="ops-log-mono">{props.aiRequestLogDetail.metadata?.profile ?? props.noDataLabel}</dd></div>
            <div><dt>{props.inline("字符", "Chars")}</dt><dd>{formatUiNumber(props.aiRequestLogDetail.promptChars, props.uiLanguage)} / {formatUiNumber(props.aiRequestLogDetail.responseChars, props.uiLanguage)}</dd></div>
            <div><dt>{props.inline("最终标题", "Final name")}</dt><dd>{props.aiRequestLogDetail.finalName ?? props.aiRequestLogDetail.result?.composition?.finalName ?? props.noDataLabel}</dd></div>
            <div><dt>{props.inline("信息", "Info")}</dt><dd>{props.aiRequestLogDetail.status === "succeeded" ? props.aiRequestLogDetail.finalName ?? props.aiRequestLogDetail.result?.composition?.finalName ?? props.noDataLabel : props.aiRequestLogDetail.error ?? props.noDataLabel}</dd></div>
          </dl>
          <details className="settings-disclosure" open>
            <summary>{props.inline("Prompt 输入", "Prompt input")}</summary>
            <pre className="settings-json settings-json-large">{props.aiRequestLogDetail.promptText ?? props.noDataLabel}</pre>
          </details>
          <details className="settings-disclosure">
            <summary>{props.inline("请求载荷", "Request payload")}</summary>
            <pre className="settings-json">{JSON.stringify(props.aiRequestLogDetail.requestPayload ?? {}, null, 2)}</pre>
          </details>
          <details className="settings-disclosure" open>
            <summary>{props.inline("模型原始输出", "Raw model output")}</summary>
            <pre className="settings-json settings-json-large">{props.aiRequestLogDetail.responseText ?? props.noDataLabel}</pre>
          </details>
          <details className="settings-disclosure">
            <summary>{props.inline("响应载荷", "Response payload")}</summary>
            <pre className="settings-json">{JSON.stringify(props.aiRequestLogDetail.responsePayload ?? {}, null, 2)}</pre>
          </details>
          <details className="settings-disclosure" open>
            <summary>{props.inline("解析后的结构化结果", "Parsed structured result")}</summary>
            <pre className="settings-json">{JSON.stringify(props.aiRequestLogDetail.result?.parsedModelOutput ?? {}, null, 2)}</pre>
          </details>
          <details className="settings-disclosure" open>
            <summary>{props.inline("Builder 到最终标题", "Builder to final title")}</summary>
            <pre className="settings-json">{JSON.stringify(props.aiRequestLogDetail.result?.composition ?? {}, null, 2)}</pre>
          </details>
        </div>
      ) : null}

      <div className="ops-log-table-container">
        <table className="ops-log-table">
          <thead>
            <tr>
              <th>{props.inline("时间", "Time")}</th>
              <th>{props.inline("项目", "Project")}</th>
              <th>Thread</th>
              <th>{props.inline("模型", "Model")}</th>
              <th>{props.inline("状态", "Status")}</th>
              <th>{props.inline("耗时", "Duration")}</th>
              <th>{props.inline("字符", "Chars")}</th>
              <th>{props.inline("传输", "Transport")}</th>
              <th>{props.inline("接口", "Endpoint")}</th>
              <th>{props.inline("信息", "Info")}</th>
            </tr>
          </thead>
          <tbody>
            {props.visibleAiRequests.length === 0 ? (
              <tr>
                <td className="ops-log-empty" colSpan={10}>
                  {props.aiRequestLogs
                    ? props.inline("当前筛选条件下没有日志。", "No logs matched the current filters.")
                    : props.inline("还没有 AI 请求日志。", "No AI request logs yet.")}
                </td>
              </tr>
            ) : null}
            {props.visibleAiRequests.map((item) => (
              <tr
                className="ops-log-row"
                data-selected={props.selectedRequestLogId === item.id ? "true" : undefined}
                data-status={item.status}
                key={item.id}
                onClick={() => props.onSelectRequestLog(item.id)}
              >
                <td className="ops-log-col-time">
                  <div className="ops-log-primary ops-log-nowrap" title={item.startedAt}>{formatWhen(item.startedAt, props.uiLanguage)}</div>
                  <div className="ops-log-secondary ops-log-nowrap" title={item.finishedAt ?? ""}>{formatWhen(item.finishedAt, props.uiLanguage)}</div>
                </td>
                <td className="ops-log-col-project">
                  <div className="ops-log-primary ops-log-nowrap" title={item.projectName ?? ""}>{item.projectName ?? props.noDataLabel}</div>
                  <div className="ops-log-secondary ops-log-nowrap" title={item.backend}>{item.backend}</div>
                </td>
                <td className="ops-log-mono ops-log-col-thread" title={item.threadId}>{item.threadId}</td>
                <td className="ops-log-col-model">
                  <div className="ops-log-primary ops-log-nowrap" title={item.model ?? ""}>{item.model ?? props.noDataLabel}</div>
                  <div className="ops-log-secondary ops-log-nowrap" title={item.metadata?.providerRef ?? ""}>{item.metadata?.providerRef ?? props.noDataLabel}</div>
                </td>
                <td><span className={`chip ${aiRequestStatusTone(item.status)}`}>{aiRequestStatusLabel(item.status, props.uiLanguage)}</span></td>
                <td className="ops-log-col-duration">
                  <div className="ops-log-primary ops-log-nowrap">{formatDurationMs(item.durationMs)}</div>
                  <div className="ops-log-secondary">{props.latestAiRequest?.id === item.id ? props.inline("最新", "latest") : "\u00A0"}</div>
                </td>
                <td className="ops-log-col-chars">
                  <div className="ops-log-primary ops-log-nowrap">{formatUiNumber(item.promptChars, props.uiLanguage)} / {formatUiNumber(item.responseChars, props.uiLanguage)}</div>
                  <div className="ops-log-secondary ops-log-nowrap">{props.inline("prompt / response", "prompt / response")}</div>
                </td>
                <td className="ops-log-col-transport">
                  <div className="ops-log-primary ops-log-nowrap" title={item.transport}>{item.transport}</div>
                  <div className="ops-log-secondary ops-log-nowrap" title={item.metadata?.requestedBackend ?? item.backend}>{item.metadata?.requestedBackend ?? item.backend}</div>
                </td>
                <td className="ops-log-mono ops-log-col-endpoint" title={item.baseUrl ?? ""}>{item.baseUrl ?? props.noDataLabel}</td>
                <td className="ops-log-col-info">
                  <div className="ops-log-primary" title={item.status === "succeeded" ? item.finalName ?? "" : item.error ?? ""}>
                    {item.status === "succeeded" ? item.finalName ?? props.noDataLabel : item.error ?? props.noDataLabel}
                  </div>
                  <div className="ops-log-secondary ops-log-nowrap" title={item.status === "succeeded" ? props.inline("输出标题", "final name") : item.error ? props.inline("错误", "error") : item.metadata?.profile ?? ""}>
                    {item.status === "succeeded"
                      ? props.inline("输出标题", "final name")
                      : item.error
                        ? props.inline("错误", "error")
                        : item.metadata?.profile ?? props.noDataLabel}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
