import * as React from "react";

import {
  formatWhen,
  groupSessionsByTime,
  sessionDisplayTitle,
  sessionListSubtitle,
  sessionListTitle,
  toneForSession
} from "./browser-utils.js";
import {
  autoRenameReasonLabel,
  autoRenameStatusLabel,
  sessionStatusLabel,
  t,
  type UiLanguage
} from "./i18n.js";
import { TranscriptPanel } from "./TranscriptPanel.js";
import type { SessionDetail, SessionSummary } from "./types.js";
import { addAppTransitionType, AppViewTransition } from "./view-transitions.js";

const SESSION_PANE_MIN_WIDTH = 320;
const SESSION_PANE_MAX_WIDTH = 560;
const PANE_KEYBOARD_STEP = 24;

export function SessionBrowser(props: {
  sessions: SessionSummary[];
  selectedWorkspaceLabel: string;
  selectedId?: string;
  detail: SessionDetail | null;
  sessionPaneCollapsed: boolean;
  sessionPaneWidth: number;
  loadingSessions: boolean;
  loadingDetail: boolean;
  actioning: boolean;
  actionLabel: string | null;
  showHiddenTranscript: boolean;
  error: string | null;
  uiLanguage: UiLanguage;
  onToggleShowHiddenTranscript: (value: boolean) => void;
  onRefresh: () => void;
  onSelectSession: (threadId: string) => void;
  onToggleSessionPane: () => void;
  onSessionPaneWidthChange: (delta: number) => void;
  onStartSessionResize: (event: React.PointerEvent<HTMLDivElement>) => void;
  onSuggest: () => void | Promise<void>;
  onApply: () => void | Promise<void>;
  onToggleFreeze: () => void | Promise<void>;
  onToggleManualOverride: () => void | Promise<void>;
}) {
  const groupedSessions = React.useMemo(
    () => groupSessionsByTime(props.sessions, props.uiLanguage),
    [props.sessions, props.uiLanguage]
  );
  const [historyExpanded, setHistoryExpanded] = React.useState(false);
  const actionLabelLower = props.actionLabel?.toLowerCase();
  const tt = (key: Parameters<typeof t>[1]) => t(props.uiLanguage, key);
  const inline = (zh: string, en: string) => (props.uiLanguage === "zh-CN" ? zh : en);
  const latestRename = props.detail?.renameHistory?.[0];

  React.useEffect(() => {
    setHistoryExpanded(false);
  }, [props.detail?.threadId]);

  const handleSessionSplitterKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        props.onSessionPaneWidthChange(-PANE_KEYBOARD_STEP);
        break;
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        props.onSessionPaneWidthChange(PANE_KEYBOARD_STEP);
        break;
      case "Home":
        event.preventDefault();
        props.onSessionPaneWidthChange(SESSION_PANE_MIN_WIDTH - props.sessionPaneWidth);
        break;
      case "End":
        event.preventDefault();
        props.onSessionPaneWidthChange(SESSION_PANE_MAX_WIDTH - props.sessionPaneWidth);
        break;
      default:
        break;
    }
  };

  return (
    <section className={props.sessionPaneCollapsed ? "history-layout session-pane-collapsed" : "history-layout"}>
      <section className={props.sessionPaneCollapsed ? "session-list-view collapsed" : "session-list-view"} id="session-list-pane">
        <header className="view-header session-list-header">
          <div>
            <p className="panel-kicker">{tt("conversationArchive")}</p>
            <h2>{props.selectedWorkspaceLabel}</h2>
          </div>
          <div className="header-actions">
            <button className="btn-refresh" onClick={props.onRefresh} title={tt("refresh")} type="button">
              &#8635; {tt("refresh")}
            </button>
          </div>
        </header>

        <div className="session-list">
          {props.loadingSessions ? <div className="loading-state history-empty">{tt("loadingSessions")}</div> : null}
          {!props.loadingSessions && props.sessions.length === 0 ? (
            <div className="history-empty">
              {props.error ? tt("apiNotReady") : tt("noSessions")}
            </div>
          ) : null}
          {groupedSessions.map((group) => (
            <section className="session-group-block" key={group.label}>
              <div className="time-group-header">
                <span>{group.label}</span>
              </div>
              {group.items.map((session) => (
                <button
                  className={props.selectedId === session.threadId ? "session-item active" : "session-item"}
                  key={session.threadId}
                  onClick={() =>
                    React.startTransition(() => {
                      addAppTransitionType("nav-forward");
                      props.onSelectSession(session.threadId);
                    })
                  }
                  type="button"
                >
                  <div className="session-item-topline">
                    <span className={`session-status-dot ${toneForSession(session)}`} />
                    <span className="session-updated">{formatWhen(session.updatedAt, props.uiLanguage)}</span>
                    <span className="session-state-label">{sessionStatusLabel(session.statusEstimate, props.uiLanguage)}</span>
                  </div>
                  <div className="session-item-title">{sessionListTitle(session)}</div>
                  <div className="session-item-subtitle">{sessionListSubtitle(session)}</div>
                  <div className="session-item-meta">
                    <span>{session.workspaceLabel}</span>
                    <span>{session.provider ?? tt("unknownProvider")}</span>
                    <span>{session.taskCompleteCount} {props.uiLanguage === "zh-CN" ? "个任务" : "tasks"}</span>
                  </div>
                </button>
              ))}
            </section>
          ))}
        </div>
      </section>

      {!props.sessionPaneCollapsed ? (
        <div
          className="history-splitter"
          onKeyDown={handleSessionSplitterKeyDown}
          onPointerDown={props.onStartSessionResize}
          role="separator"
          tabIndex={0}
          aria-controls="session-list-pane"
          aria-label={tt("resizeSessionList")}
          aria-orientation="vertical"
          aria-valuemax={SESSION_PANE_MAX_WIDTH}
          aria-valuemin={SESSION_PANE_MIN_WIDTH}
          aria-valuenow={props.sessionPaneWidth}
        />
      ) : null}

      <section className="chat-view">
        {props.detail ? (
          <AppViewTransition
            default="none"
            enter={{ "nav-forward": "nav-forward", default: "fade-in" }}
            exit={{ "nav-forward": "nav-forward", default: "fade-out" }}
            key={props.detail.threadId}
          >
            <>
            <header className="view-header chat-header">
              <div className="chat-title-wrap">
                <div className="chat-title-block">
                  <p className="panel-kicker">{tt("selectedSession")}</p>
                  <h2 className="editable-title">{sessionDisplayTitle(props.detail)}</h2>
                  <div className="chat-meta-bar">
                    <span>{props.detail.cwd ?? props.detail.workspaceLabel}</span>
                    <span>{props.detail.provider ?? tt("unknownProvider")}</span>
                    <span>{props.detail.model ?? tt("unknownModel")}</span>
                    <span>{props.detail.tokenTotal} {props.uiLanguage === "zh-CN" ? "tokens" : "tokens"}</span>
                  </div>
                </div>
                <div className="chat-header-right">
                  {props.detail.dirty ? <span className="chip danger">{tt("dirty")}</span> : <span className="chip success">{tt("clean")}</span>}
                  {props.detail.frozen ? <span className="chip warning">{tt("frozen")}</span> : null}
                  {props.detail.manualOverride ? <span className="chip manual">{tt("manual")}</span> : null}
                  <button className="btn-sm" disabled={props.actioning} onClick={props.onSuggest} type="button">
                    {props.actioning && props.actionLabel?.includes("Suggest") ? tt("suggesting") : tt("suggest")}
                  </button>
                  <button className="btn-sm" disabled={props.actioning} onClick={props.onApply} type="button">
                    {props.actioning && props.actionLabel?.includes("Applying") ? tt("applying") : tt("apply")}
                  </button>
                  <button className="btn-sm" disabled={props.actioning} onClick={props.onToggleFreeze} type="button">
                    {props.actioning && actionLabelLower?.includes("freez")
                      ? props.detail.frozen
                        ? tt("unfreezing")
                        : tt("freezing")
                      : props.detail.frozen
                        ? tt("unfreeze")
                        : tt("freeze")}
                  </button>
                  <button className="btn-sm" disabled={props.actioning} onClick={props.onToggleManualOverride} type="button">
                    {props.actioning && actionLabelLower?.includes("manual")
                      ? props.detail.manualOverride
                        ? tt("clearing")
                        : tt("saving")
                      : props.detail.manualOverride
                        ? tt("clearManual")
                        : tt("manualOverride")}
                  </button>
                </div>
              </div>
            </header>

            {props.error ? (
              <div className="error-banner notice-banner error">{props.error}</div>
            ) : null}

            {props.loadingDetail ? <div className="loading-state chat-loading">{tt("loadingSessionDetail")}</div> : null}

            <TranscriptPanel
              detail={props.detail}
              showHiddenTranscript={props.showHiddenTranscript}
              onToggleShowHiddenTranscript={props.onToggleShowHiddenTranscript}
              uiLanguage={props.uiLanguage}
            />

            <div className="chat-footer-panels">
              <section className="detail-panel naming-tray">
                <div className="panel-topline history-tray-header">
                  <div>
                    <p className="panel-kicker">{inline("当前命名", "Current naming")}</p>
                    <h3>{inline("正式标题与候选标题", "Official and candidate titles")}</h3>
                  </div>
                </div>

                <div className="naming-stack">
                  <article className="naming-row">
                    <div className="naming-row-header">
                      <span>{inline("正式标题", "Official title")}</span>
                      <span className="chip success">{props.detail.officialName ? inline("已应用", "Applied") : inline("暂无", "None")}</span>
                    </div>
                    <strong className="naming-value">{props.detail.officialName ?? inline("还没有正式标题", "No official title yet")}</strong>
                  </article>

                  <article className="naming-row">
                    <div className="naming-row-header">
                      <span>{tt("candidateName")}</span>
                      {props.detail.candidateName ? (
                        <span className="chip warning">
                          {props.detail.dirty ? inline("待应用", "Pending apply") : inline("候选保留", "Candidate kept")}
                        </span>
                      ) : (
                        <span className="chip">{inline("暂无", "None")}</span>
                      )}
                    </div>
                    <strong className="naming-value">{props.detail.candidateName ?? inline("还没有候选标题", "No candidate title yet")}</strong>
                  </article>

                  <dl className="signal-grid">
                    <div>
                      <dt>{tt("status")}</dt>
                      <dd>{sessionStatusLabel(props.detail.statusEstimate, props.uiLanguage)}</dd>
                    </div>
                    <div>
                      <dt>{inline("最后应用", "Last applied")}</dt>
                      <dd>{props.detail.lastAppliedAt ? formatWhen(props.detail.lastAppliedAt, props.uiLanguage) : tt("nA")}</dd>
                    </div>
                  </dl>
                </div>
              </section>

              <section className="detail-panel history-tray">
                <div className="panel-topline history-tray-header">
                  <div>
                    <p className="panel-kicker">{tt("timeline")}</p>
                    <h3>{tt("renameHistory")}</h3>
                  </div>
                  <button
                    className="btn-refresh"
                    onClick={() =>
                      React.startTransition(() => {
                        setHistoryExpanded((current) => !current);
                      })
                    }
                    type="button"
                  >
                    {historyExpanded ? tt("hideRenameHistory") : tt("showRenameHistory")}
                  </button>
                </div>

                {latestRename ? (
                  <div className="history-summary-row">
                  <div className="history-summary-copy">
                      <strong>{latestRename.newName}</strong>
                      <p>
                        {latestRename.kind} / {latestRename.source} / {autoRenameStatusLabel(latestRename.status, props.uiLanguage)}
                        {latestRename.reason ? ` / ${autoRenameReasonLabel(latestRename.reason, props.uiLanguage)}` : ""}
                      </p>
                    </div>
                    <div className="history-summary-meta">
                      <span>{formatWhen(latestRename.appliedAt, props.uiLanguage)}</span>
                      <span>
                        {(props.detail.renameHistory ?? []).length} {tt("renameCountSuffix")}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="history-empty compact">{tt("noRenameHistory")}</div>
                )}

                {historyExpanded && (props.detail.renameHistory ?? []).length > 0 ? (
                  <AppViewTransition default="none" enter="fade-in" exit="fade-out">
                    <div className="history-stack history-expanded-list">
                      {(props.detail.renameHistory ?? []).slice(0, 10).map((entry, index) => (
                        <article className="history-row" key={`${index}-${entry.appliedAt}-${entry.newName}`}>
                          <div>
                            <strong>{entry.newName}</strong>
                            <p>
                              {entry.kind} / {entry.source} / {autoRenameStatusLabel(entry.status, props.uiLanguage)}
                              {entry.reason ? ` / ${autoRenameReasonLabel(entry.reason, props.uiLanguage)}` : ""}
                            </p>
                          </div>
                          <span>{formatWhen(entry.appliedAt, props.uiLanguage)}</span>
                        </article>
                      ))}
                    </div>
                  </AppViewTransition>
                ) : null}
              </section>
            </div>
            </>
          </AppViewTransition>
        ) : (
          <div className="history-empty">{tt("selectSessionHint")}</div>
        )}
      </section>
    </section>
  );
}
