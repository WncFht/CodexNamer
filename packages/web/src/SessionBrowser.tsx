import * as React from "react";

import {
  formatWhen,
  groupSessionsByTime,
  sessionDisplayTitle,
  sessionListSubtitle,
  sessionListTitle,
  toneForSession
} from "./browser-utils.js";
import { sessionStatusLabel, t, type UiLanguage } from "./i18n.js";
import { TranscriptPanel } from "./TranscriptPanel.js";
import type { SessionDetail, SessionSummary } from "./types.js";
import { addAppTransitionType, AppViewTransition } from "./view-transitions.js";

const SESSION_PANE_MIN_WIDTH = 320;
const SESSION_PANE_MAX_WIDTH = 560;
const PANE_KEYBOARD_STEP = 24;

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

export function SessionBrowser(props: {
  sessions: SessionSummary[];
  selectedWorkspaceLabel: string;
  selectedId?: string;
  detail: SessionDetail | null;
  focusMode: boolean;
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
  onEnterFocusMode: () => void;
  onExitFocusMode: () => void;
  onToggleSessionPane: () => void;
  onSessionPaneWidthChange: (delta: number) => void;
  onStartSessionResize: (event: React.PointerEvent<HTMLDivElement>) => void;
  onSuggest: () => void | Promise<void>;
  onApply: () => void | Promise<void>;
  onToggleFreeze: () => void | Promise<void>;
}) {
  const [detailView, setDetailView] = React.useState<"transcript" | "naming">("transcript");
  const groupedSessions = React.useMemo(
    () => groupSessionsByTime(props.sessions, props.uiLanguage),
    [props.sessions, props.uiLanguage]
  );
  const actionLabelLower = props.actionLabel?.toLowerCase();
  const tt = (key: Parameters<typeof t>[1]) => t(props.uiLanguage, key);
  const sessionPaneToggleLabel = props.sessionPaneCollapsed ? tt("showSessions") : tt("hideSessions");
  const renameHistory = React.useMemo(() => {
    const seen = new Set<string>();
    return (props.detail?.renameHistory ?? []).filter((entry) => {
      const key = entry.newName.trim();
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [props.detail?.renameHistory]);

  React.useEffect(() => {
    setDetailView("transcript");
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
    <section
      className={
        props.focusMode
          ? "history-layout session-focus-mode"
          : props.sessionPaneCollapsed
            ? "history-layout session-pane-collapsed"
            : "history-layout"
      }
    >
      <section className={props.sessionPaneCollapsed ? "session-list-view collapsed" : "session-list-view"} id="session-list-pane">
        <header className="view-header session-list-header">
          <div>
            <p className="panel-kicker">{tt("conversationArchive")}</p>
            <h2>{props.selectedWorkspaceLabel}</h2>
          </div>
          <div className="header-actions">
            <button
              className="btn-sm"
              onClick={props.onToggleSessionPane}
              title={sessionPaneToggleLabel}
              type="button"
            >
              {sessionPaneToggleLabel}
            </button>
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

      {!props.sessionPaneCollapsed && !props.focusMode ? (
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
                {props.focusMode ? (
                  <button className="btn-sm chat-back-btn" onClick={props.onExitFocusMode} type="button">
                    ← {tt("back")}
                  </button>
                ) : null}
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
                  <button
                    className={detailView === "transcript" ? "btn-sm active" : "btn-sm"}
                    onClick={() => setDetailView("transcript")}
                    title={tt("transcript")}
                    type="button"
                  >
                    {tt("transcript")}
                  </button>
                  <button
                    className={detailView === "naming" ? "btn-sm active" : "btn-sm"}
                    onClick={() => setDetailView("naming")}
                    title={tt("namingActivity")}
                    type="button"
                  >
                    {tt("namingActivity")}
                  </button>
                  {!props.focusMode ? (
                    <>
                      <button className="btn-sm" onClick={props.onEnterFocusMode} title={tt("focusSession")} type="button">
                        {tt("focusSession")}
                      </button>
                      <button className="btn-sm" onClick={props.onToggleSessionPane} title={sessionPaneToggleLabel} type="button">
                        {sessionPaneToggleLabel}
                      </button>
                    </>
                  ) : null}
                  {props.detail.dirty ? <span className="chip danger">{tt("dirty")}</span> : <span className="chip success">{tt("clean")}</span>}
                  {props.detail.frozen ? <span className="chip warning">{tt("frozen")}</span> : null}
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
                </div>
              </div>
            </header>

            {props.error ? (
              <div className="error-banner notice-banner error">{props.error}</div>
            ) : null}

            <div className="chat-content-shell">
              <div className="chat-primary-stack">
                {props.loadingDetail ? <div className="loading-state chat-loading">{tt("loadingSessionDetail")}</div> : null}

                {detailView === "transcript" ? (
                  <TranscriptPanel
                    detail={props.detail}
                    showHiddenTranscript={props.showHiddenTranscript}
                    onToggleShowHiddenTranscript={props.onToggleShowHiddenTranscript}
                    uiLanguage={props.uiLanguage}
                  />
                ) : (
                  <section className="detail-panel" role="region">
                  <div className="naming-drawer-header">
                    <div>
                      <p className="panel-kicker">{tt("namingActivity")}</p>
                      <h3>{tt("renameHistory")}</h3>
                    </div>
                  </div>

                  <div className="naming-drawer-body">
                    <section className="naming-drawer-section">
                      <p className="panel-kicker">{tt("currentNaming")}</p>
                      <div className="naming-stack">
                        <article className="naming-row">
                          <div className="naming-row-header">
                            <span>{tt("officialTitle")}</span>
                            <span>{formatWhen(props.detail.lastAppliedAt, props.uiLanguage)}</span>
                          </div>
                          <strong className="naming-value">
                            {props.detail.officialName ?? tt("noOfficialTitle")}
                          </strong>
                        </article>
                        <article className="naming-row">
                          <div className="naming-row-header">
                            <span>{tt("candidateName")}</span>
                            <span>{formatWhen(props.detail.updatedAt, props.uiLanguage)}</span>
                          </div>
                          <strong className="naming-value">
                            {props.detail.candidateName ?? tt("noSuggestedTitle")}
                          </strong>
                        </article>
                      </div>
                    </section>

                    <section className="naming-drawer-section">
                      <div className="panel-topline">
                        <div>
                          <p className="panel-kicker">{tt("timeline")}</p>
                          <h3>{tt("renameHistory")}</h3>
                        </div>
                        <span className="chip manual">
                          {renameHistory.length} {tt("renameCountSuffix")}
                        </span>
                      </div>
                      <div className="naming-drawer-history">
                        {renameHistory.length === 0 ? (
                          <div className="history-empty compact">{tt("noRenameHistory")}</div>
                        ) : null}
                        {renameHistory.map((entry, index) => (
                          <article
                            className="naming-entry"
                            key={`${entry.appliedAt}-${entry.newName}-${entry.status}-${index}`}
                          >
                            <div className="naming-entry-main">
                              <strong>{entry.newName}</strong>
                              <div className="naming-entry-meta">
                                <span>{renameHistorySourceLabel(entry.source, props.uiLanguage)}</span>
                                <span>{renameHistoryStatusLabel(entry.status, props.uiLanguage)}</span>
                                {entry.reason ? <span>{entry.reason}</span> : null}
                              </div>
                            </div>
                            <span className="naming-entry-time">
                              {formatWhen(entry.appliedAt, props.uiLanguage)}
                            </span>
                          </article>
                        ))}
                      </div>
                    </section>
                  </div>
                  </section>
                )}
              </div>
            </div>
            </>
          </AppViewTransition>
        ) : (
          <div className="history-empty">
            <p>{tt("selectSessionHint")}</p>
            <div className="history-empty-actions">
              <button className="btn-sm" onClick={props.onToggleSessionPane} type="button">
                {tt("showSessions")}
              </button>
            </div>
          </div>
        )}
      </section>
    </section>
  );
}
