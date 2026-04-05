import * as React from "react";

import {
  formatWhen,
  groupSessionsByTime,
  sessionDisplayTitle,
  sessionListSubtitle,
  sessionListTitle,
  toneForSession
} from "./browser-utils.js";
import { autoRenameReasonLabel, autoRenameStatusLabel, sessionStatusLabel, t, type UiLanguage } from "./i18n.js";
import { TranscriptPanel } from "./TranscriptPanel.js";
import type { SessionDetail, SessionSummary } from "./types.js";

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
  search: string;
  dirtyOnly: boolean;
  showHiddenTranscript: boolean;
  error: string | null;
  uiLanguage: UiLanguage;
  onSearchChange: (value: string) => void;
  onDirtyOnlyChange: (value: boolean) => void;
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
  const groupedSessions = groupSessionsByTime(props.sessions, props.uiLanguage);
  const actionLabelLower = props.actionLabel?.toLowerCase();
  const tt = (key: Parameters<typeof t>[1]) => t(props.uiLanguage, key);
  const sessionSearchId = React.useId();

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
            <span className="badge">{props.sessions.length} {tt("sessionCountSuffix")}</span>
          </div>
          <div className="header-actions">
            <button className="btn-sm" onClick={props.onToggleSessionPane} type="button">
              {props.sessionPaneCollapsed ? tt("showSessions") : tt("hideSessions")}
            </button>
            <button className="btn-refresh" onClick={props.onRefresh} title={tt("refresh")} type="button">
              &#8635; {tt("refresh")}
            </button>
            <label className="checkbox-inline">
              <input
                checked={props.dirtyOnly}
                onChange={(event) => props.onDirtyOnlyChange(event.target.checked)}
                type="checkbox"
              />
              {tt("dirtyOnly")}
            </label>
            <label className="sr-only" htmlFor={sessionSearchId}>
              {tt("searchSessionsLabel")}
            </label>
            <input
              id={sessionSearchId}
              className="filter-input"
              name="session-search"
              onChange={(event) => props.onSearchChange(event.target.value)}
              placeholder={tt("filterSessions")}
              type="search"
              value={props.search}
            />
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
                <span>{group.items.length}</span>
              </div>
              {group.items.map((session) => (
                <button
                  className={props.selectedId === session.threadId ? "session-item active" : "session-item"}
                  key={session.threadId}
                  onClick={() => props.onSelectSession(session.threadId)}
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
                  <button className="btn-sm" onClick={props.onToggleSessionPane} type="button">
                    {props.sessionPaneCollapsed ? tt("showSessions") : tt("hideSessions")}
                  </button>
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

            <div className="chat-footer-panels single-panel">
              <section className="detail-panel">
                <p className="panel-kicker">{tt("timeline")}</p>
                <h3>{tt("renameHistory")}</h3>
                <div className="history-stack">
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
                  {(props.detail.renameHistory ?? []).length === 0 ? (
                    <div className="history-empty">{tt("noRenameHistory")}</div>
                  ) : null}
                </div>
              </section>
            </div>
          </>
        ) : (
          <div className="history-empty">{tt("selectSessionHint")}</div>
        )}
      </section>
    </section>
  );
}
