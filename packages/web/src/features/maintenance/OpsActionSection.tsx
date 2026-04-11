import { formatUiNumber } from "../../i18n.js";

export function OpsActionSection(props: {
  inline: (zh: string, en: string) => string;
  uiLanguage: "en-US" | "zh-CN";
  previewApplyCount: number;
  previewSuggestCount: number;
  ruleBacklogCount: number;
  activeAiRequestCount: number;
  failedAiRequestCount: number;
  previewRefreshing: boolean;
  onRefreshPreview: () => void | Promise<void>;
  onRefreshRuntime: () => void | Promise<void>;
  onOpenLogs: () => void;
  onOpenDiagnostics: () => void;
  onOpenRequeue: () => void;
}) {
  const queueTotal = props.previewApplyCount + props.previewSuggestCount;

  return (
    <section className="detail-panel ops-actions-panel ops-span-wide">
      <div className="panel-topline ops-runtime-header">
        <div>
          <p className="panel-kicker">{props.inline("动作", "Actions")}</p>
          <h3>{props.inline("先决定下一步要处理什么", "Decide what to do next")}</h3>
          <p className="settings-copy">
            {props.inline(
              "先看 backlog、规则补扫和模型请求状态，再决定是刷新 preview、看日志，还是去重新入队。",
              "Check backlog, replay backlog, and AI request status first, then decide whether to refresh preview, inspect logs, or open replay."
            )}
          </p>
        </div>
      </div>

      <div className="ops-attention-grid">
        <article className="ops-attention-card" data-tone={queueTotal > 0 ? "warning" : "success"}>
          <span className="metric-label">{props.inline("即时命名积压", "Live rename backlog")}</span>
          <strong>{formatUiNumber(queueTotal, props.uiLanguage)}</strong>
          <p>
            {formatUiNumber(props.previewApplyCount, props.uiLanguage)} {props.inline("待应用", "apply")} / {" "}
            {formatUiNumber(props.previewSuggestCount, props.uiLanguage)} {props.inline("待建议", "suggest")}
          </p>
        </article>
        <article className="ops-attention-card" data-tone={props.ruleBacklogCount > 0 ? "warning" : "success"}>
          <span className="metric-label">{props.inline("规则补扫积压", "Replay backlog")}</span>
          <strong>{formatUiNumber(props.ruleBacklogCount, props.uiLanguage)}</strong>
          <p>
            {props.ruleBacklogCount > 0
              ? props.inline("有会话还没跟上最新规则，适合去重新入队页确认。", "Some sessions are still on older rules. Open replay to confirm them.")
              : props.inline("规则签名已经基本对齐。", "Rule signatures are already aligned.")}
          </p>
        </article>
        <article
          className="ops-attention-card"
          data-tone={props.failedAiRequestCount > 0 || props.activeAiRequestCount > 0 ? "warning" : "success"}
        >
          <span className="metric-label">{props.inline("模型请求状态", "AI request health")}</span>
          <strong>{formatUiNumber(props.failedAiRequestCount + props.activeAiRequestCount, props.uiLanguage)}</strong>
          <p>
            {formatUiNumber(props.activeAiRequestCount, props.uiLanguage)} {props.inline("活跃", "active")} / {" "}
            {formatUiNumber(props.failedAiRequestCount, props.uiLanguage)} {props.inline("失败", "failed")}
          </p>
        </article>
      </div>

      <div className="ops-action-button-row">
        <button className="btn-sm primary" onClick={() => void props.onRefreshPreview()} type="button">
          {props.previewRefreshing
            ? props.inline("刷新 Preview 中...", "Refreshing preview...")
            : props.inline("刷新命名 Preview", "Refresh naming preview")}
        </button>
        <button className="btn-sm" onClick={() => void props.onRefreshRuntime()} type="button">
          {props.inline("刷新运行态", "Refresh runtime")}
        </button>
        <button className="btn-sm" onClick={props.onOpenLogs} type="button">
          {props.inline("查看请求日志", "Open request logs")}
        </button>
        <button className="btn-sm" onClick={props.onOpenDiagnostics} type="button">
          {props.inline("查看诊断", "Open diagnostics")}
        </button>
        <button className="btn-sm" onClick={props.onOpenRequeue} type="button">
          {props.inline("前往重新入队", "Open replay queue")}
        </button>
      </div>
    </section>
  );
}
