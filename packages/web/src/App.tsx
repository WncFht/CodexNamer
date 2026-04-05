import * as React from "react";

import { formatWhen } from "./browser-utils.js";
import { SessionBrowser } from "./SessionBrowser.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { ALL_WORKSPACES_ID, useControlDeckState } from "./useControlDeckState.js";

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
  const previewApplyCount = state.preview?.items.filter((item) => item.status === "apply").length ?? 0;
  const selectedWorkspace =
    state.selectedWorkspaceId === ALL_WORKSPACES_ID
      ? undefined
      : state.workspaces.find((item) => item.workspaceId === state.selectedWorkspaceId);
  const selectedWorkspaceLabel = selectedWorkspace?.workspaceLabel ?? "All workspaces";

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
    const handlePointerMove = (event: PointerEvent) => {
      if (workspaceDragRef.current) {
        const delta = event.clientX - workspaceDragRef.current.startX;
        setWorkspacePaneWidth(Math.max(220, Math.min(420, workspaceDragRef.current.startWidth + delta)));
      }
      if (sessionDragRef.current) {
        const delta = event.clientX - sessionDragRef.current.startX;
        setSessionPaneWidth(Math.max(320, Math.min(560, sessionDragRef.current.startWidth + delta)));
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
            <h1 className="home-link">Codex Session</h1>
            <p className="subtitle home-link">Manager</p>
            <p className="sidebar-copy">Warm editorial control surface for session naming, history, and maintenance.</p>
          </div>
          <div className="pane-controls">
            <button className="pane-btn" onClick={() => setWorkspacePaneCollapsed((value) => !value)} title={workspacePaneCollapsed ? "Expand workspace pane" : "Collapse workspace pane"} type="button">
              {workspacePaneCollapsed ? "Open" : "Fold"}
            </button>
          </div>
        </div>

        <div className="sidebar-actions">
          {[
            ["sessions", "Sessions"],
            ["settings", "Settings"],
            ["maintenance", "Maintenance"]
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
              <span>Workspaces</span>
              <span className="project-group-count">{state.workspaces.length}</span>
            </div>
            <div className="project-group-items">
              <button
                className={state.selectedWorkspaceId === ALL_WORKSPACES_ID ? "project-item active" : "project-item"}
                onClick={() => state.setSelectedWorkspaceId(ALL_WORKSPACES_ID)}
                type="button"
              >
                <span className="name">All workspaces</span>
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
            <span>Visible</span>
            <strong>{state.sessions.length}</strong>
          </div>
          <div className="sidebar-stat-row">
            <span>Apply queue</span>
            <strong>{state.previewRefreshing && !state.preview ? "..." : previewApplyCount}</strong>
          </div>
          <div className="sidebar-stat-row">
            <span>Selected</span>
            <strong>{selectedWorkspaceLabel}</strong>
          </div>
          <div className="sidebar-stat-row">
            <span>Last Sync</span>
            <strong>{formatWhen(state.lastSyncAt)}</strong>
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
            onSearchChange={state.setSearch}
            onDirtyOnlyChange={state.setDirtyOnly}
            onToggleShowHiddenTranscript={state.setShowHiddenTranscript}
            onRefresh={() => void state.refreshSessions()}
            onSelectSession={(threadId) => state.setSelectedId(threadId)}
            onToggleSessionPane={() => setSessionPaneCollapsed((value) => !value)}
            onSessionPaneWidthChange={(delta) =>
              setSessionPaneWidth((value) => Math.max(320, Math.min(560, value + delta)))
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
            providers={state.providers}
            saving={state.savingConfig}
          />
        ) : null}

        {state.tab === "maintenance" ? (
          <section className="panel-grid">
            <div className="detail-panel">
              <p className="panel-kicker">Health</p>
              <h3>Doctor</h3>
              <pre>{JSON.stringify(state.doctor ?? {}, null, 2)}</pre>
            </div>
            <div className="detail-panel">
              <div className="panel-topline">
                <div>
                  <p className="panel-kicker">Scheduler</p>
                  <h3>Auto rename preview</h3>
                </div>
                <button className="btn-sm" onClick={() => void state.refreshPreview({ includeCandidateNames: true, urgent: true })} type="button">
                  {state.previewRefreshing ? "Refreshing..." : "Refresh Preview"}
                </button>
              </div>
              <pre>{JSON.stringify(state.preview?.items ?? [], null, 2)}</pre>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
