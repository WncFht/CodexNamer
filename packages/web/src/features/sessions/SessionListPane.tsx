import * as React from "react";

import {
  formatWhen,
  groupSessionsByTime,
  sessionListSubtitle,
  sessionListTitle,
  toneForSession,
} from "../../browser-utils.js";
import type { UiLanguage } from "../../i18n.js";
import { sessionStatusLabel, t } from "../../i18n.js";
import type { SessionSummary } from "../../types.js";
import { addAppTransitionType } from "../../view-transitions.js";

const SESSION_CONTEXT_MENU_WIDTH = 220;
const SESSION_CONTEXT_MENU_HEIGHT = 56;
const SESSION_CONTEXT_MENU_MARGIN = 12;

export function SessionListPane(props: {
  sessions: SessionSummary[];
  selectedWorkspaceLabel: string;
  search: string;
  selectedId?: string;
  sessionPaneCollapsed: boolean;
  loadingSessions: boolean;
  error: string | null;
  uiLanguage: UiLanguage;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onSelectSession: (threadId: string) => void;
  onCopySessionId: (threadId: string) => void | Promise<void>;
  onToggleSessionPane: () => void;
}) {
  const [contextMenu, setContextMenu] = React.useState<{
    threadId: string;
    x: number;
    y: number;
  } | null>(null);
  const [searchDraft, setSearchDraft] = React.useState(props.search);
  const contextMenuRef = React.useRef<HTMLDivElement | null>(null);
  const contextMenuActionRef = React.useRef<HTMLButtonElement | null>(null);
  const searchCommitTimerRef = React.useRef<number | null>(null);
  const searchComposingRef = React.useRef(false);
  const groupedSessions = React.useMemo(
    () => groupSessionsByTime(props.sessions, props.uiLanguage),
    [props.sessions, props.uiLanguage],
  );
  const tt = React.useCallback(
    (key: Parameters<typeof t>[1]) => t(props.uiLanguage, key),
    [props.uiLanguage],
  );
  const sessionPaneToggleLabel = props.sessionPaneCollapsed
    ? tt("showSessions")
    : tt("hideSessions");

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

  const commitSearch = React.useCallback(
    (nextValue: string) => {
      props.onSearchChange(nextValue.trim());
    },
    [props],
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
    [commitSearch],
  );

  const clearSearch = React.useCallback(() => {
    if (searchCommitTimerRef.current !== null) {
      window.clearTimeout(searchCommitTimerRef.current);
      searchCommitTimerRef.current = null;
    }
    setSearchDraft("");
    commitSearch("");
  }, [commitSearch]);

  const openSessionContextMenu = React.useCallback(
    (threadId: string, x: number, y: number) => {
      if (props.selectedId !== threadId) {
        props.onSelectSession(threadId);
      }
      setContextMenu({ threadId, x, y });
    },
    [props],
  );

  const handleSessionContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, threadId: string) => {
      event.preventDefault();
      openSessionContextMenu(threadId, event.clientX, event.clientY);
    },
    [openSessionContextMenu],
  );

  const handleSessionItemKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, threadId: string) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
        return;
      }

      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      openSessionContextMenu(threadId, rect.left + Math.min(rect.width - 16, 120), rect.top + 12);
    },
    [openSessionContextMenu],
  );

  const contextMenuPosition = React.useMemo(() => {
    if (!contextMenu) {
      return undefined;
    }

    const maxX =
      typeof window === "undefined"
        ? contextMenu.x
        : Math.max(
            SESSION_CONTEXT_MENU_MARGIN,
            window.innerWidth - SESSION_CONTEXT_MENU_WIDTH - SESSION_CONTEXT_MENU_MARGIN,
          );
    const maxY =
      typeof window === "undefined"
        ? contextMenu.y
        : Math.max(
            SESSION_CONTEXT_MENU_MARGIN,
            window.innerHeight - SESSION_CONTEXT_MENU_HEIGHT - SESSION_CONTEXT_MENU_MARGIN,
          );

    return {
      left: Math.max(SESSION_CONTEXT_MENU_MARGIN, Math.min(contextMenu.x, maxX)),
      top: Math.max(SESSION_CONTEXT_MENU_MARGIN, Math.min(contextMenu.y, maxY)),
    };
  }, [contextMenu]);

  const renderSessionCardContent = React.useCallback(
    (session: SessionSummary) => {
      const subtitle = sessionListSubtitle(session);
      const showWorkspaceLabel =
        props.selectedWorkspaceLabel === tt("allWorkspaces") ||
        props.selectedWorkspaceLabel !== session.workspaceLabel;
      const meta = [
        showWorkspaceLabel ? session.workspaceLabel : null,
        session.provider ?? tt("unknownProvider"),
        session.taskCompleteCount > 0
          ? `${session.taskCompleteCount} ${props.uiLanguage === "zh-CN" ? "个任务" : "tasks"}`
          : null,
        sessionStatusLabel(session.statusEstimate, props.uiLanguage),
      ]
        .filter(Boolean)
        .join(" · ");

      return (
        <>
          <div className="session-item-topline">
            <span className={`session-status-dot ${toneForSession(session)}`} />
            <span className="session-updated">
              {formatWhen(session.updatedAt, props.uiLanguage)}
            </span>
            {session.frozen ? (
              <span className="session-health-label frozen">{tt("frozen")}</span>
            ) : null}
            {!session.frozen && session.dirty ? (
              <span className="session-health-label dirty">{tt("dirty")}</span>
            ) : null}
          </div>
          <div className="session-item-title">{sessionListTitle(session)}</div>
          {subtitle ? <div className="session-item-subtitle">{subtitle}</div> : null}
          <div className="session-item-meta">{meta}</div>
        </>
      );
    },
    [props.selectedWorkspaceLabel, props.uiLanguage, tt],
  );

  return (
    <section
      className={props.sessionPaneCollapsed ? "session-list-view collapsed" : "session-list-view"}
      id="session-list-pane"
    >
      <header className="view-header session-list-header">
        <div className="session-list-heading">
          <p className="panel-kicker">{tt("conversationArchive")}</p>
          <h2>{props.selectedWorkspaceLabel}</h2>
          <p className="session-list-summary">
            {props.sessions.length} {tt("sessionCountSuffix")}
          </p>
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
          <button
            className="btn-refresh"
            onClick={props.onRefresh}
            title={tt("refresh")}
            type="button"
          >
            &#8635; {tt("refresh")}
          </button>
        </div>
      </header>

      <div className="session-list-toolbar">
        <label className="chat-search" htmlFor="session-list-search">
          <span className="sr-only">{tt("searchSessionsLabel")}</span>
          <input
            id="session-list-search"
            onChange={(event) => {
              const nextValue = event.target.value;
              setSearchDraft(nextValue);
              if (!searchComposingRef.current) {
                scheduleSearchCommit(nextValue);
              }
            }}
            onCompositionEnd={(event) => {
              searchComposingRef.current = false;
              scheduleSearchCommit(event.currentTarget.value);
            }}
            onCompositionStart={() => {
              searchComposingRef.current = true;
              if (searchCommitTimerRef.current !== null) {
                window.clearTimeout(searchCommitTimerRef.current);
                searchCommitTimerRef.current = null;
              }
            }}
            onKeyDown={(event) => {
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
                clearSearch();
              }
            }}
            placeholder={tt("filterSessions")}
            type="search"
            value={searchDraft}
          />
        </label>
        {searchDraft ? (
          <button className="btn-sm" onClick={clearSearch} type="button">
            {props.uiLanguage === "zh-CN" ? "清空" : "Clear"}
          </button>
        ) : null}
      </div>

      <div className="session-list">
        {props.loadingSessions ? (
          <div className="loading-state history-empty">{tt("loadingSessions")}</div>
        ) : null}
        {!props.loadingSessions && props.sessions.length === 0 ? (
          <div className="history-empty">{props.error ? tt("apiNotReady") : tt("noSessions")}</div>
        ) : null}
        {groupedSessions.map((group) => (
          <section className="session-group-block" key={group.label}>
            <div className="time-group-header">
              <span>{group.label}</span>
            </div>
            {group.items.map((session) => (
              <button
                className={
                  props.selectedId === session.threadId ? "session-item active" : "session-item"
                }
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
                {renderSessionCardContent(session)}
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
  );
}
