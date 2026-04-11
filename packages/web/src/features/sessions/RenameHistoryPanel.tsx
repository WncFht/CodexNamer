import { formatWhen } from "../../browser-utils.js";
import type { t } from "../../i18n.js";
import type { SessionDetail, UiLanguage } from "../../types.js";

function renameHistoryStatusLabel(status: string, language: UiLanguage): string {
  if (language === "zh-CN") {
    switch (status) {
      case "applied":
        return "已应用";
      case "skipped":
        return "已跳过";
      case "failed":
        return "失败";
      case "preview_only":
        return "建议";
      default:
        return status;
    }
  }

  switch (status) {
    case "applied":
      return "applied";
    case "skipped":
      return "skipped";
    case "failed":
      return "failed";
    case "preview_only":
      return "suggested";
    default:
      return status;
  }
}

function renameHistorySourceLabel(source: string, language: UiLanguage): string {
  if (language === "zh-CN") {
    switch (source) {
      case "ai":
        return "AI";
      case "manual":
        return "手动";
      case "heuristic":
        return "启发式";
      default:
        return source;
    }
  }

  switch (source) {
    case "ai":
      return "AI";
    case "manual":
      return "manual";
    case "heuristic":
      return "heuristic";
    default:
      return source;
  }
}

export function RenameHistoryPanel(props: {
  detail: SessionDetail;
  renameHistory: NonNullable<SessionDetail["renameHistory"]>;
  uiLanguage: UiLanguage;
  tt: (key: Parameters<typeof t>[1]) => string;
}) {
  return (
    <section className="detail-panel" role="region">
      <div className="naming-drawer-header">
        <div>
          <p className="panel-kicker">{props.tt("namingActivity")}</p>
          <h3>{props.tt("renameHistory")}</h3>
        </div>
      </div>

      <div className="naming-drawer-body">
        <section className="naming-drawer-section">
          <p className="panel-kicker">{props.tt("currentNaming")}</p>
          <div className="naming-stack">
            <article className="naming-row">
              <div className="naming-row-header">
                <span>{props.tt("officialTitle")}</span>
                <span>{formatWhen(props.detail.lastAppliedAt, props.uiLanguage)}</span>
              </div>
              <strong className="naming-value">{props.detail.officialName ?? props.tt("noOfficialTitle")}</strong>
            </article>
            <article className="naming-row">
              <div className="naming-row-header">
                <span>{props.tt("candidateName")}</span>
                <span>{formatWhen(props.detail.updatedAt, props.uiLanguage)}</span>
              </div>
              <strong className="naming-value">{props.detail.candidateName ?? props.tt("noSuggestedTitle")}</strong>
            </article>
          </div>
        </section>

        <section className="naming-drawer-section">
          <div className="panel-topline">
            <div>
              <p className="panel-kicker">{props.tt("timeline")}</p>
              <h3>{props.tt("renameHistory")}</h3>
            </div>
            <span className="panel-note">
              {props.renameHistory.length} {props.tt("renameCountSuffix")}
            </span>
          </div>
          <div className="naming-drawer-history">
            {props.renameHistory.length === 0 ? <div className="history-empty compact">{props.tt("noRenameHistory")}</div> : null}
            {props.renameHistory.map((entry, index) => (
              <article className="naming-entry" key={`${entry.appliedAt}-${entry.newName}-${entry.status}-${index}`}>
                <div className="naming-entry-main">
                  <strong>{entry.newName}</strong>
                  <div className="naming-entry-meta">
                    <span>{renameHistorySourceLabel(entry.source, props.uiLanguage)}</span>
                    <span>{renameHistoryStatusLabel(entry.status, props.uiLanguage)}</span>
                    {entry.reason ? <span>{entry.reason}</span> : null}
                  </div>
                </div>
                <span className="naming-entry-time">{formatWhen(entry.appliedAt, props.uiLanguage)}</span>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
