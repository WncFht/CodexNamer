import * as React from "react";

import { formatWhen } from "./browser-utils.js";
import { normalizeUiLanguage, t } from "./i18n.js";
import { SessionBrowser } from "./SessionBrowser.js";
import { ALL_WORKSPACES_ID, useControlDeckState } from "./useControlDeckState.js";

const WORKSPACE_PANE_MIN_WIDTH = 220;
const WORKSPACE_PANE_MAX_WIDTH = 420;
const SESSION_PANE_MIN_WIDTH = 320;
const SESSION_PANE_MAX_WIDTH = 560;
const SESSION_PANE_AUTO_COLLAPSE_WIDTH = 272;
const SESSION_PANE_RESTORE_WIDTH = 390;
const PANE_KEYBOARD_STEP = 24;
const SettingsPanel = React.lazy(() =>
  import("./SettingsPanel.js").then((module) => ({ default: module.SettingsPanel }))
);
const RenameOpsPanel = React.lazy(() =>
  import("./RenameOpsPanel.js").then((module) => ({ default: module.RenameOpsPanel }))
);

function clampWorkspacePaneWidth(value: number): number {
  return Math.max(WORKSPACE_PANE_MIN_WIDTH, Math.min(WORKSPACE_PANE_MAX_WIDTH, value));
}

function clampSessionPaneWidth(value: number): number {
  return Math.max(SESSION_PANE_MIN_WIDTH, Math.min(SESSION_PANE_MAX_WIDTH, value));
}

function readStoredNumber(key: string, fallback: number): number {
  const raw = window.localStorage.getItem(key);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readStoredBoolean(key: string, fallback = false): boolean {
  const raw = window.localStorage.getItem(key);
  return raw === null ? fallback : raw === "true";
}

export function App() {
  const state = useControlDeckState();
  const workspaceDragRef = React.useRef<{ startX: number; startWidth: number } | null>(null);
  const sessionDragRef = React.useRef<{ startX: number; startWidth: number } | null>(null);
  const [workspacePaneCollapsed, setWorkspacePaneCollapsed] = React.useState(() =>
    readStoredBoolean("csm:workspacePaneCollapsed", false)
  );
  const [sessionPaneCollapsed, setSessionPaneCollapsed] = React.useState(() =>
    readStoredBoolean("csm:sessionPaneCollapsed", false)
  );
  const [workspacePaneWidth, setWorkspacePaneWidth] = React.useState(() =>
    readStoredNumber("csm:workspacePaneWidth", 280)
  );
  const [sessionPaneWidth, setSessionPaneWidth] = React.useState(() =>
    readStoredNumber("csm:sessionPaneWidth", 390)
  );
  const [settingsPanelLoaded, setSettingsPanelLoaded] = React.useState(() => state.tab === "settings");
  const [maintenancePanelLoaded, setMaintenancePanelLoaded] = React.useState(() => state.tab === "maintenance");
  const sessionPaneRestoreWidthRef = React.useRef(Math.max(SESSION_PANE_RESTORE_WIDTH, readStoredNumber("csm:sessionPaneWidth", 390)));
  const uiLanguage = normalizeUiLanguage(state.configView);
  const tt = (key: Parameters<typeof t>[1]) => t(uiLanguage, key);
  const previewApplyCount = state.preview?.items.filter((item) => item.status === "apply").length ?? 0;
  const previewSuggestCount = state.preview?.items.filter((item) => item.status === "suggest").length ?? 0;
  const selectedWorkspace =
    state.selectedWorkspaceId === ALL_WORKSPACES_ID
      ? undefined
      : state.workspaces.find((item) => item.workspaceId === state.selectedWorkspaceId);
  const selectedWorkspaceLabel = selectedWorkspace?.workspaceLabel ?? tt("allWorkspaces");

  React.useEffect(() => {
    document.documentElement.lang = uiLanguage;
  }, [uiLanguage]);

  React.useEffect(() => {
    window.localStorage.setItem("csm:workspacePaneCollapsed", String(workspacePaneCollapsed));
  }, [workspacePaneCollapsed]);

  React.useEffect(() => {
    window.localStorage.setItem("csm:sessionPaneCollapsed", String(sessionPaneCollapsed));
  }, [sessionPaneCollapsed]);

  React.useEffect(() => {
    window.localStorage.setItem("csm:workspacePaneWidth", String(workspacePaneWidth));
  }, [workspacePaneWidth]);

  React.useEffect(() => {
    window.localStorage.setItem("csm:sessionPaneWidth", String(sessionPaneWidth));
  }, [sessionPaneWidth]);

  React.useEffect(() => {
    if (!sessionPaneCollapsed && sessionPaneWidth >= SESSION_PANE_MIN_WIDTH) {
      sessionPaneRestoreWidthRef.current = sessionPaneWidth;
    }
  }, [sessionPaneCollapsed, sessionPaneWidth]);

  React.useEffect(() => {
    if (state.tab === "settings") {
      setSettingsPanelLoaded(true);
    }
    if (state.tab === "maintenance") {
      setMaintenancePanelLoaded(true);
    }
  }, [state.tab]);

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (workspaceDragRef.current) {
        const delta = event.clientX - workspaceDragRef.current.startX;
        setWorkspacePaneWidth(clampWorkspacePaneWidth(workspaceDragRef.current.startWidth + delta));
      }
      if (sessionDragRef.current) {
        const delta = event.clientX - sessionDragRef.current.startX;
        const nextWidth = Math.max(220, Math.min(SESSION_PANE_MAX_WIDTH, sessionDragRef.current.startWidth + delta));
        if (nextWidth <= SESSION_PANE_AUTO_COLLAPSE_WIDTH) {
          setSessionPaneCollapsed(true);
          setSessionPaneWidth(Math.max(sessionPaneRestoreWidthRef.current, SESSION_PANE_RESTORE_WIDTH));
        } else {
          setSessionPaneCollapsed(false);
          setSessionPaneWidth(Math.max(SESSION_PANE_MIN_WIDTH, nextWidth));
        }
      }
    };

    const handlePointerUp = () => {
      workspaceDragRef.current = null;
      sessionDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  const adjustWorkspacePaneWidth = (delta: number) => {
    setWorkspacePaneCollapsed(false);
    setWorkspacePaneWidth((value) => clampWorkspacePaneWidth(value + delta));
  };

  const setWorkspacePaneWidthTo = (value: number) => {
    setWorkspacePaneCollapsed(false);
    setWorkspacePaneWidth(clampWorkspacePaneWidth(value));
  };

  const adjustSessionPaneWidth = (delta: number) => {
    setSessionPaneCollapsed(false);
    setSessionPaneWidth((value) => clampSessionPaneWidth(value + delta));
  };

  const handleWorkspaceSplitterKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        adjustWorkspacePaneWidth(-PANE_KEYBOARD_STEP);
        break;
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        adjustWorkspacePaneWidth(PANE_KEYBOARD_STEP);
        break;
      case "Home":
        event.preventDefault();
        setWorkspacePaneWidthTo(WORKSPACE_PANE_MIN_WIDTH);
        break;
      case "End":
        event.preventDefault();
        setWorkspacePaneWidthTo(WORKSPACE_PANE_MAX_WIDTH);
        break;
      default:
        break;
    }
  };

  const startWorkspaceResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setWorkspacePaneCollapsed(false);
    workspaceDragRef.current = {
      startX: event.clientX,
      startWidth: workspacePaneWidth
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const startSessionResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setSessionPaneCollapsed(false);
    sessionDragRef.current = {
      startX: event.clientX,
      startWidth: sessionPaneWidth
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const toggleSessionPane = () => {
    setSessionPaneCollapsed((previous) => {
      const nextCollapsed = !previous;
      if (!nextCollapsed) {
        setSessionPaneWidth(Math.max(sessionPaneRestoreWidthRef.current, SESSION_PANE_RESTORE_WIDTH));
      }
      return nextCollapsed;
    });
  };

  const showSettingsPanel = settingsPanelLoaded || state.tab === "settings";
  const showMaintenancePanel = maintenancePanelLoaded || state.tab === "maintenance";

  return (
    <div
      id="app"
      style={
        {
          "--sidebar-width": `${workspacePaneCollapsed ? 88 : workspacePaneWidth}px`,
          "--session-list-width": `${sessionPaneCollapsed ? 0 : sessionPaneWidth}px`
        } as React.CSSProperties
      }
    >
      <aside className={workspacePaneCollapsed ? "collapsed" : undefined} id="sidebar">
        <div className="sidebar-header">
          <div>
            <p className="sidebar-kicker">Claude Design MD</p>
            <h1 className="home-link">Codex Session Manager</h1>
            <p className="sidebar-copy">{tt("warmEditorial")}</p>
          </div>
          <div className="pane-controls">
            <button
              aria-controls="sidebar"
              aria-expanded={!workspacePaneCollapsed}
              className="pane-btn"
              onClick={() => setWorkspacePaneCollapsed((value) => !value)}
              title={workspacePaneCollapsed ? tt("expandWorkspacePane") : tt("collapseWorkspacePane")}
              type="button"
            >
              {workspacePaneCollapsed ? tt("open") : tt("fold")}
            </button>
          </div>
        </div>

        <div className="sidebar-actions">
          {[
            ["sessions", tt("sessions")],
            ["settings", tt("settings")],
            ["maintenance", tt("renameOps")]
          ].map(([id, label]) => (
            <button
              aria-current={state.tab === id ? "page" : undefined}
              className={state.tab === id ? "sidebar-btn active" : "sidebar-btn"}
              key={id}
              onClick={() => state.setTab(id as typeof state.tab)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <nav id="projectList">
          <div className="project-group-wrapper">
            <div className="project-group-header codex">
              <span className="project-group-dot" />
              <span>{tt("workspaces")}</span>
              <span className="project-group-count">{state.workspaces.length}</span>
            </div>
            <div className="project-group-items">
              <button
                className={state.selectedWorkspaceId === ALL_WORKSPACES_ID ? "project-item active" : "project-item"}
                onClick={() => state.setSelectedWorkspaceId(ALL_WORKSPACES_ID)}
                type="button"
              >
                <span className="name">{tt("allWorkspaces")}</span>
                <span className="count">{state.workspaces.reduce((sum, item) => sum + item.sessionCount, 0)}</span>
              </button>
              {state.workspaces.map((workspace) => (
                <button
                  className={state.selectedWorkspaceId === workspace.workspaceId ? "project-item active" : "project-item"}
                  key={workspace.workspaceId}
                  onClick={() => state.setSelectedWorkspaceId(workspace.workspaceId)}
                  type="button"
                >
                  <span className="name">{workspace.workspaceLabel}</span>
                  <span className="count">{workspace.sessionCount}</span>
                </button>
              ))}
            </div>
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-stat-row">
            <span>{tt("visible")}</span>
            <strong>{state.sessions.length}</strong>
          </div>
          <div className="sidebar-stat-row">
            <span>{tt("applyQueue")}</span>
            <strong>{state.previewRefreshing && !state.preview ? "..." : previewApplyCount}</strong>
          </div>
          <div className="sidebar-stat-row">
            <span>{tt("suggestQueue")}</span>
            <strong>{state.previewRefreshing && !state.preview ? "..." : previewSuggestCount}</strong>
          </div>
          <div className="sidebar-stat-row">
            <span>{tt("selected")}</span>
            <strong>{selectedWorkspaceLabel}</strong>
          </div>
          <div className="sidebar-stat-row">
            <span>{tt("lastSync")}</span>
            <strong>{formatWhen(state.lastSyncAt, uiLanguage)}</strong>
          </div>
        </div>
      </aside>

      <div
        className="splitter"
        onKeyDown={handleWorkspaceSplitterKeyDown}
        onPointerDown={startWorkspaceResize}
        role="separator"
        tabIndex={0}
        aria-controls="sidebar"
        aria-label={tt("resizeWorkspacePane")}
        aria-orientation="vertical"
        aria-valuemax={WORKSPACE_PANE_MAX_WIDTH}
        aria-valuemin={WORKSPACE_PANE_MIN_WIDTH}
        aria-valuenow={workspacePaneWidth}
      />

      <main id="content">
        {state.notice ? (
          <div
            aria-live={state.notice.tone === "error" ? "assertive" : "polite"}
            className={`notice-banner app-notice ${state.notice.tone}`}
            role={state.notice.tone === "error" ? "alert" : "status"}
          >
            {state.notice.text}
          </div>
        ) : null}

        <div className="app-tab-panel" hidden={state.tab !== "sessions"}>
          {state.tab === "sessions" ? (
            <SessionBrowser
              sessions={state.sessions}
              selectedWorkspaceLabel={selectedWorkspaceLabel}
              selectedId={state.selectedId}
              detail={state.detail}
              sessionPaneCollapsed={sessionPaneCollapsed}
              sessionPaneWidth={sessionPaneWidth}
              loadingSessions={state.loadingSessions}
              loadingDetail={state.loadingDetail}
              actioning={state.actioning}
              actionLabel={state.actionLabel}
              search={state.search}
              dirtyOnly={state.dirtyOnly}
              showHiddenTranscript={state.showHiddenTranscript}
              error={state.error}
              uiLanguage={uiLanguage}
              onSearchChange={state.setSearch}
              onDirtyOnlyChange={state.setDirtyOnly}
              onToggleShowHiddenTranscript={state.setShowHiddenTranscript}
              onRefresh={() => void state.refreshSessions()}
              onSelectSession={(threadId) => state.setSelectedId(threadId)}
              onToggleSessionPane={toggleSessionPane}
              onSessionPaneWidthChange={adjustSessionPaneWidth}
              onStartSessionResize={startSessionResize}
              onSuggest={() => state.actions.suggest()}
              onApply={() => state.actions.apply()}
              onSetNamingStyle={(style) => state.actions.setNamingStyle(style)}
              onToggleFreeze={() => state.actions.toggleFreeze()}
              onToggleManualOverride={() => state.actions.toggleManualOverride()}
            />
          ) : null}
        </div>

        <div className="app-tab-panel" hidden={state.tab !== "settings"}>
          {showSettingsPanel ? (
            <React.Suspense fallback={<div className="loading-state app-panel-loading">{tt("loading")}</div>}>
              <SettingsPanel
                configView={state.configView}
                overview={state.overview}
                onReload={() => void state.refreshSettings()}
                onSave={(patch) => state.saveConfig(patch)}
                previewApplyCount={previewApplyCount}
                previewSuggestCount={previewSuggestCount}
                providers={state.providers}
                saving={state.savingConfig}
                promptPreview={state.promptPreview}
                promptPreviewRefreshing={state.promptPreviewRefreshing}
                onRefreshPromptPreview={() => void state.refreshPromptPreview()}
              />
            </React.Suspense>
          ) : null}
        </div>

        <div className="app-tab-panel" hidden={state.tab !== "maintenance"}>
          {showMaintenancePanel ? (
            <React.Suspense fallback={<div className="loading-state app-panel-loading">{tt("loading")}</div>}>
              <RenameOpsPanel
                aiRequestLogs={state.aiRequestLogs}
                doctor={state.doctor}
                onRefreshPreview={(options) => state.refreshPreview(options)}
                overview={state.overview}
                preview={state.preview}
                previewRefreshing={state.previewRefreshing}
                uiLanguage={uiLanguage}
              />
            </React.Suspense>
          ) : null}
        </div>
      </main>
    </div>
  );
}
