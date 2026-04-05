import { formatWhen } from "./browser-utils.js";
import { SessionBrowser } from "./SessionBrowser.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { ALL_WORKSPACES_ID, useControlDeckState } from "./useControlDeckState.js";

export function App() {
  const state = useControlDeckState();
  const previewApplyCount = state.preview?.items.filter((item) => item.status === "apply").length ?? 0;
  const selectedWorkspace =
    state.selectedWorkspaceId === ALL_WORKSPACES_ID
      ? undefined
      : state.workspaces.find((item) => item.workspaceId === state.selectedWorkspaceId);
  const selectedWorkspaceLabel = selectedWorkspace?.workspaceLabel ?? "All workspaces";

  return (
    <div id="app">
      <aside id="sidebar">
        <div className="sidebar-header">
          <h1 className="home-link">Codex Session</h1>
          <p className="subtitle home-link">Manager</p>
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

      <div className="splitter" />

      <main id="content">
        {state.tab === "sessions" ? (
          <SessionBrowser
            sessions={state.sessions}
            selectedWorkspaceLabel={selectedWorkspaceLabel}
            selectedId={state.selectedId}
            detail={state.detail}
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
            onSuggest={() => state.actions.suggest()}
            onApply={() => state.actions.apply()}
            onToggleFreeze={() => state.actions.toggleFreeze()}
            onToggleManualOverride={() => state.actions.toggleManualOverride()}
          />
        ) : null}

        {state.tab === "settings" ? (
          <SettingsPanel
            configView={state.configView}
            onReload={() => void state.refreshSidePanels()}
            onSave={(patch) => state.saveConfig(patch)}
            providers={state.providers}
            saving={state.savingConfig}
          />
        ) : null}

        {state.tab === "maintenance" ? (
          <section className="panel-grid">
            <div className="detail-panel">
              <h3>Doctor</h3>
              <pre>{JSON.stringify(state.doctor ?? {}, null, 2)}</pre>
            </div>
            <div className="detail-panel">
              <div className="panel-topline">
                <h3>Auto rename preview</h3>
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
