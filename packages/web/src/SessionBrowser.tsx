import * as React from "react";
import { RenameHistoryPanel } from "./features/sessions/RenameHistoryPanel.js";
import { SessionDetailHeader } from "./features/sessions/SessionDetailHeader.js";
import { SessionListPane } from "./features/sessions/SessionListPane.js";
import type { UiLanguage } from "./i18n.js";
import { t } from "./i18n.js";
import { TranscriptPanel } from "./TranscriptPanel.js";
import type { SessionDetail, SessionSummary, SortOrder } from "./types.js";
import { AppViewTransition } from "./view-transitions.js";

const SESSION_PANE_MIN_WIDTH = 320;
const SESSION_PANE_MAX_WIDTH = 560;
const PANE_KEYBOARD_STEP = 24;

export function SessionBrowser(props: {
  sessions: SessionSummary[];
  selectedWorkspaceLabel: string;
  search: string;
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
  sortOrder: SortOrder;
  onToggleShowHiddenTranscript: (value: boolean) => void;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onSelectSession: (threadId: string) => void;
  onCopySessionId: (threadId: string) => void | Promise<void>;
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
  const tt = React.useCallback(
    (key: Parameters<typeof t>[1]) => t(props.uiLanguage, key),
    [props.uiLanguage],
  );
  const sessionPaneToggleLabel = props.sessionPaneCollapsed
    ? tt("showSessions")
    : tt("hideSessions");
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

  const handleSessionSplitterKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
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
    },
    [props],
  );

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
      <SessionListPane
        error={props.error}
        loadingSessions={props.loadingSessions}
        onCopySessionId={props.onCopySessionId}
        onRefresh={props.onRefresh}
        onSearchChange={props.onSearchChange}
        onSelectSession={props.onSelectSession}
        onToggleSessionPane={props.onToggleSessionPane}
        search={props.search}
        selectedId={props.selectedId}
        selectedWorkspaceLabel={props.selectedWorkspaceLabel}
        sessionPaneCollapsed={props.sessionPaneCollapsed}
        sessions={props.sessions}
        uiLanguage={props.uiLanguage}
        sortOrder={props.sortOrder}
      />

      {!props.sessionPaneCollapsed && !props.focusMode ? (
        <div
          aria-controls="session-list-pane"
          aria-label={tt("resizeSessionList")}
          aria-orientation="vertical"
          aria-valuemax={SESSION_PANE_MAX_WIDTH}
          aria-valuemin={SESSION_PANE_MIN_WIDTH}
          aria-valuenow={props.sessionPaneWidth}
          className="history-splitter"
          onKeyDown={handleSessionSplitterKeyDown}
          onPointerDown={props.onStartSessionResize}
          role="separator"
          tabIndex={0}
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
              <SessionDetailHeader
                actionLabel={props.actionLabel}
                actioning={props.actioning}
                detail={props.detail}
                focusMode={props.focusMode}
                onApply={props.onApply}
                onEnterFocusMode={props.onEnterFocusMode}
                onExitFocusMode={props.onExitFocusMode}
                onSuggest={props.onSuggest}
                onToggleFreeze={props.onToggleFreeze}
                onToggleSessionPane={props.onToggleSessionPane}
                sessionPaneToggleLabel={sessionPaneToggleLabel}
                tt={tt}
                uiLanguage={props.uiLanguage}
              />

              {props.error ? (
                <div className="error-banner notice-banner error">{props.error}</div>
              ) : null}

              <div className="chat-content-shell">
                <div className="chat-primary-stack">
                  {props.loadingDetail ? (
                    <div className="loading-state chat-loading">{tt("loadingSessionDetail")}</div>
                  ) : null}
                  <div
                    aria-label={tt("selectedSession")}
                    className="detail-view-switch"
                    role="tablist"
                  >
                    <button
                      aria-selected={detailView === "transcript"}
                      className={detailView === "transcript" ? "btn-sm active" : "btn-sm"}
                      onClick={() => setDetailView("transcript")}
                      role="tab"
                      title={tt("transcript")}
                      type="button"
                    >
                      {tt("transcript")}
                    </button>
                    <button
                      aria-selected={detailView === "naming"}
                      className={detailView === "naming" ? "btn-sm active" : "btn-sm"}
                      onClick={() => setDetailView("naming")}
                      role="tab"
                      title={tt("namingActivity")}
                      type="button"
                    >
                      {tt("namingActivity")}
                    </button>
                  </div>

                  {detailView === "transcript" ? (
                    <TranscriptPanel
                      detail={props.detail}
                      onToggleShowHiddenTranscript={props.onToggleShowHiddenTranscript}
                      showHiddenTranscript={props.showHiddenTranscript}
                      uiLanguage={props.uiLanguage}
                    />
                  ) : (
                    <RenameHistoryPanel
                      detail={props.detail}
                      renameHistory={renameHistory}
                      tt={tt}
                      uiLanguage={props.uiLanguage}
                    />
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
