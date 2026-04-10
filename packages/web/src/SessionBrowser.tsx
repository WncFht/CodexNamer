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
const SESSION_CONTEXT_MENU_WIDTH = 220;
const SESSION_CONTEXT_MENU_HEIGHT = 56;
const SESSION_CONTEXT_MENU_MARGIN = 12;

function normalizeSearchText(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function sessionMatchesSearch(session: SessionSummary, query: string): boolean {
  if (!query) {
    return true;
  }

  const haystacks = [
    session.officialName,
    session.candidateName,
    session.firstUserMessage,
    session.projectName,
    session.workspaceLabel,
    session.provider,
    session.model,
    session.cwd,
    session.threadId
  ];

  return haystacks.some((value) => normalizeSearchText(value).includes(query));
}

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
  const [contextMenu, setContextMenu] = React.useState<{ threadId: string; x: number; y: number } | null>(null);
  const [searchDraft, setSearchDraft] = React.useState(props.search);
  const contextMenuRef = React.useRef<HTMLDivElement | null>(null);
  const contextMenuActionRef = React.useRef<HTMLButtonElement | null>(null);
  const searchCommitTimerRef = React.useRef<number | null>(null);
  const searchComposingRef = React.useRef(false);
  const deferredSearchDraft = React.useDeferredValue(searchDraft);
  const normalizedSearchQuery = React.useMemo(
    () => normalizeSearchText(deferredSearchDraft),
    [deferredSearchDraft]
  );
  const filteredSessions = React.useMemo(
    () => props.sessions.filter((session) => sessionMatchesSearch(session, normalizedSearchQuery)),
    [normalizedSearchQuery, props.sessions]
  );
  const groupedSessions = React.useMemo(
    () => groupSessionsByTime(filteredSessions, props.uiLanguage),
    [filteredSessions, props.uiLanguage]
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

  React.useEffect(() => {
    setSearchDraft(props.search);
  }, [props.search]);

  React.useEffect(() => {
    return () => {
      if (searchCommitTimerRef.current !== null) {
        window.clearTimeout(searchCommitTimerRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (!contextMenu) {
      return;
    }

    contextMenuActionRef.current?.focus();

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) {
        return;
      }
      setContextMenu(null);
    };
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);

    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  const openSessionContextMenu = React.useCallback(
    (threadId: string, x: number, y: number) => {
      if (props.selectedId !== threadId) {
        props.onSelectSession(threadId);
      }
      setContextMenu({ threadId, x, y });
    },
    [props]
  );

  const handleSessionContextMenu = (event: React.MouseEvent<HTMLButtonElement>, threadId: string) => {
    event.preventDefault();
    openSessionContextMenu(threadId, event.clientX, event.clientY);
  };

  const handleSessionItemKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, threadId: string) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openSessionContextMenu(threadId, rect.left + Math.min(rect.width - 16, 120), rect.top + 12);
  };

  const contextMenuPosition = React.useMemo(() => {
    if (!contextMenu) {
      return undefined;
    }

    const maxX =
      typeof window === "undefined"
        ? contextMenu.x
        : Math.max(
            SESSION_CONTEXT_MENU_MARGIN,
            window.innerWidth - SESSION_CONTEXT_MENU_WIDTH - SESSION_CONTEXT_MENU_MARGIN
          );
    const maxY =
      typeof window === "undefined"
        ? contextMenu.y
        : Math.max(
            SESSION_CONTEXT_MENU_MARGIN,
            window.innerHeight - SESSION_CONTEXT_MENU_HEIGHT - SESSION_CONTEXT_MENU_MARGIN
          );

    return {
      left: Math.max(SESSION_CONTEXT_MENU_MARGIN, Math.min(contextMenu.x, maxX)),
      top: Math.max(SESSION_CONTEXT_MENU_MARGIN, Math.min(contextMenu.y, maxY))
    };
  }, [contextMenu]);

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

  const commitSearch = React.useCallback(
    (nextValue: string) => {
      props.onSearchChange(nextValue.trim());
    },
    [props]
  );

  const scheduleSearchCommit = React.useCallback(
    (nextValue: string) => {
      if (searchCommitTimerRef.current !== null) {
        window.clearTimeout(searchCommitTimerRef.current);
      }
      searchCommitTimerRef.current = window.setTimeout(() => {
        searchCommitTimerRef.current = null;
        commitSearch(nextValue);
      }, 300);
    },
    [commitSearch]
  );

  const handleSearchInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setSearchDraft(nextValue);
    if (!searchComposingRef.current) {
      scheduleSearchCommit(nextValue);
    }
  };

  const handleSearchCompositionStart = () => {
    searchComposingRef.current = true;
    if (searchCommitTimerRef.current !== null) {
      window.clearTimeout(searchCommitTimerRef.current);
      searchCommitTimerRef.current = null;
    }
  };

  const handleSearchCompositionEnd = (event: React.CompositionEvent<HTMLInputElement>) => {
    searchComposingRef.current = false;
    scheduleSearchCommit(event.currentTarget.value);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (searchCommitTimerRef.current !== null) {
        window.clearTimeout(searchCommitTimerRef.current);
        searchCommitTimerRef.current = null;
      }
      commitSearch(searchDraft);
      return;
    }

    if (event.key === "Escape" && searchDraft) {
      event.preventDefault();
      if (searchCommitTimerRef.current !== null) {
        window.clearTimeout(searchCommitTimerRef.current);
        searchCommitTimerRef.current = null;
      }
      setSearchDraft("");
      commitSearch("");
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
          <div className="session-list-heading">
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

        <div className="session-list-toolbar">
          <label className="chat-search" htmlFor="session-list-search">
            <span className="sr-only">{tt("searchSessionsLabel")}</span>
            <input
              id="session-list-search"
              onChange={handleSearchInputChange}
              onCompositionEnd={handleSearchCompositionEnd}
              onCompositionStart={handleSearchCompositionStart}
              onKeyDown={handleSearchKeyDown}
              placeholder={tt("filterSessions")}
              type="search"
              value={searchDraft}
            />
          </label>
          {searchDraft ? (
            <button
              className="btn-sm"
              onClick={() => {
                if (searchCommitTimerRef.current !== null) {
                  window.clearTimeout(searchCommitTimerRef.current);
                  searchCommitTimerRef.current = null;
                }
                setSearchDraft("");
                commitSearch("");
              }}
              type="button"
            >
              {props.uiLanguage === "zh-CN" ? "清空" : "Clear"}
            </button>
          ) : null}
        </div>

        <div className="session-list">
          {props.loadingSessions ? <div className="loading-state history-empty">{tt("loadingSessions")}</div> : null}
          {!props.loadingSessions && filteredSessions.length === 0 ? (
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
                  onContextMenu={(event) => handleSessionContextMenu(event, session.threadId)}
                  onClick={() =>
                    React.startTransition(() => {
                      addAppTransitionType("nav-forward");
                      props.onSelectSession(session.threadId);
                    })
                  }
                  onKeyDown={(event) => handleSessionItemKeyDown(event, session.threadId)}
                  type="button"
                >
                  <div className="session-item-topline">
                    <span className={`session-status-dot ${toneForSession(session)}`} />
                    <span className="session-updated">{formatWhen(session.updatedAt, props.uiLanguage)}</span>
                    <span className={session.dirty ? "session-health-label dirty" : "session-health-label clean"}>
                      {session.dirty ? tt("dirty") : tt("clean")}
                    </span>
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
        {contextMenu && contextMenuPosition ? (
          <div
            className="session-context-menu"
            ref={contextMenuRef}
            role="menu"
            style={contextMenuPosition}
          >
            <button
              className="session-context-menu-item"
              onClick={() => {
                void props.onCopySessionId(contextMenu.threadId);
                setContextMenu(null);
              }}
              ref={contextMenuActionRef}
              role="menuitem"
              type="button"
            >
              {tt("copySessionId")}
            </button>
          </div>
        ) : null}
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
                  {!props.focusMode ? (
                    <>
                      <button
                        aria-label={tt("focusSession")}
                        className="btn-sm btn-icon"
                        onClick={props.onEnterFocusMode}
                        title={tt("focusSession")}
                        type="button"
                      >
                        <span aria-hidden="true">⤢</span>
                      </button>
                      <button className="btn-sm" onClick={props.onToggleSessionPane} title={sessionPaneToggleLabel} type="button">
                        {sessionPaneToggleLabel}
                      </button>
                    </>
                  ) : null}
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
                <div className="detail-view-switch" role="tablist" aria-label={tt("selectedSession")}>
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
