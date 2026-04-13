import { formatWhen, sessionDisplayTitle } from "../../browser-utils.js";
import type { t } from "../../i18n.js";
import type { SessionDetail } from "../../types.js";

export function SessionDetailHeader(props: {
  detail: SessionDetail;
  focusMode: boolean;
  actioning: boolean;
  actionLabel: string | null;
  sessionPaneToggleLabel: string;
  uiLanguage: "en-US" | "zh-CN";
  tt: (key: Parameters<typeof t>[1]) => string;
  onExitFocusMode: () => void;
  onEnterFocusMode: () => void;
  onToggleSessionPane: () => void;
  onSuggest: () => void | Promise<void>;
  onApply: () => void | Promise<void>;
  onToggleFreeze: () => void | Promise<void>;
}) {
  const actionLabelLower = props.actionLabel?.toLowerCase();

  return (
    <header className="view-header chat-header">
      <div className="chat-title-wrap">
        {props.focusMode ? (
          <button className="btn-sm chat-back-btn" onClick={props.onExitFocusMode} type="button">
            ← {props.tt("back")}
          </button>
        ) : null}
        <div className="chat-title-block">
          <p className="panel-kicker">{props.tt("selectedSession")}</p>
          <h2 className="editable-title">{sessionDisplayTitle(props.detail)}</h2>
          <div className="chat-meta-bar">
            <span>{props.detail.cwd ?? props.detail.workspaceLabel}</span>
            <span>{props.detail.provider ?? props.tt("unknownProvider")}</span>
            <span>{props.detail.model ?? props.tt("unknownModel")}</span>
            <span>
              {props.detail.tokenTotal} {props.uiLanguage === "zh-CN" ? "tokens" : "tokens"}
            </span>
            {props.detail.lastAppliedAt ? (
              <span>{formatWhen(props.detail.lastAppliedAt, props.uiLanguage)}</span>
            ) : null}
          </div>
        </div>
        <div className="chat-header-right">
          {!props.focusMode ? (
            <>
              <button
                aria-label={props.tt("focusSession")}
                className="btn-sm btn-icon"
                onClick={props.onEnterFocusMode}
                title={props.tt("focusSession")}
                type="button"
              >
                <span aria-hidden="true">⤢</span>
              </button>
              <button
                className="btn-sm"
                onClick={props.onToggleSessionPane}
                title={props.sessionPaneToggleLabel}
                type="button"
              >
                {props.sessionPaneToggleLabel}
              </button>
            </>
          ) : null}
          {props.detail.frozen ? (
            <span className="session-header-flag frozen">{props.tt("frozen")}</span>
          ) : null}
          <button
            className="btn-sm"
            disabled={props.actioning}
            onClick={props.onSuggest}
            type="button"
          >
            {props.actioning && props.actionLabel?.includes("Suggest")
              ? props.tt("suggesting")
              : props.tt("suggest")}
          </button>
          <button
            className="btn-sm"
            disabled={props.actioning}
            onClick={props.onApply}
            type="button"
          >
            {props.actioning && props.actionLabel?.includes("Applying")
              ? props.tt("applying")
              : props.tt("apply")}
          </button>
          <button
            className="btn-sm"
            disabled={props.actioning}
            onClick={props.onToggleFreeze}
            type="button"
          >
            {props.actioning && actionLabelLower?.includes("freez")
              ? props.detail.frozen
                ? props.tt("unfreezing")
                : props.tt("freezing")
              : props.detail.frozen
                ? props.tt("unfreeze")
                : props.tt("freeze")}
          </button>
        </div>
      </div>
    </header>
  );
}
