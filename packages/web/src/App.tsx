import * as React from "react";

import { formatWhen } from "./browser-utils.js";
import { autoRenameReasonLabel, autoRenameStatusLabel, formatUiNumber, normalizeUiLanguage, t } from "./i18n.js";
import { RenameOpsPanel } from "./RenameOpsPanel.js";
import { SessionBrowser } from "./SessionBrowser.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { ALL_WORKSPACES_ID, useControlDeckState } from "./useControlDeckState.js";

const SESSION_PANE_MIN_WIDTH = 320;
const SESSION_PANE_MAX_WIDTH = 560;
const SESSION_PANE_AUTO_COLLAPSE_WIDTH = 272;
const SESSION_PANE_RESTORE_WIDTH = 390;

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
    const handlePointerMove = (event: PointerEvent) => {
      if (workspaceDragRef.current) {
        const delta = event.clientX - workspaceDragRef.current.startX;
        setWorkspacePaneWidth(Math.max(220, Math.min(420, workspaceDragRef.current.startWidth + delta)));
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
            <button className="pane-btn" onClick={() => setWorkspacePaneCollapsed((value) => !value)} title={workspacePaneCollapsed ? tt("expandWorkspacePane") : tt("collapseWorkspacePane")} type="button">
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
        onPointerDown={startWorkspaceResize}
        role="separator"
        aria-label="Resize workspace pane"
        aria-orientation="vertical"
      />

      <main id="content">
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
            notice={state.notice}
            uiLanguage={uiLanguage}
            onSearchChange={state.setSearch}
            onDirtyOnlyChange={state.setDirtyOnly}
            onToggleShowHiddenTranscript={state.setShowHiddenTranscript}
            onRefresh={() => void state.refreshSessions()}
            onSelectSession={(threadId) => state.setSelectedId(threadId)}
            onToggleSessionPane={toggleSessionPane}
            onSessionPaneWidthChange={(delta) =>
              setSessionPaneWidth((value) => Math.max(SESSION_PANE_MIN_WIDTH, Math.min(SESSION_PANE_MAX_WIDTH, value + delta)))
            }
            onStartSessionResize={startSessionResize}
            onSuggest={() => state.actions.suggest()}
            onApply={() => state.actions.apply()}
            onToggleFreeze={() => state.actions.toggleFreeze()}
            onToggleManualOverride={() => state.actions.toggleManualOverride()}
          />
        ) : null}

        {state.tab === "settings" ? (
          <SettingsPanel
            configView={state.configView}
            overview={state.overview}
            onReload={() => void state.refreshSidePanels()}
            onSave={(patch) => state.saveConfig(patch)}
            previewApplyCount={previewApplyCount}
            previewSuggestCount={previewSuggestCount}
            providers={state.providers}
            saving={state.savingConfig}
            promptPreview={state.promptPreview}
            promptPreviewRefreshing={state.promptPreviewRefreshing}
            onRefreshPromptPreview={() => void state.refreshPromptPreview()}
          />
        ) : null}

        {state.tab === "maintenance" ? (
          <RenameOpsPanel
            doctor={state.doctor}
            onRefreshPreview={(options) => state.refreshPreview(options)}
            overview={state.overview}
            preview={state.preview}
            previewRefreshing={state.previewRefreshing}
            uiLanguage={uiLanguage}
          />
        ) : null}
      </main>
    </div>
  );
}
