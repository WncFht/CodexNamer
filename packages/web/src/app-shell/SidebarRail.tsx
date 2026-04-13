import * as React from "react";

import type { TabId } from "../control-deck-model.js";
import type { WorkspaceSummary } from "../types.js";
import { ThemeToggle } from "./ThemeToggle.js";
import type { ResolvedTheme, ThemeMode } from "./useThemePreference.js";

export function SidebarRail(props: {
  tab: TabId;
  workspacePaneCollapsed: boolean;
  totalWorkspaceSessionCount: number;
  visibleSessionCount: number;
  workspaces: WorkspaceSummary[];
  selectedWorkspaceId: string;
  allWorkspacesId: string;
  previewApplyCount: number;
  previewSuggestCount: number;
  lastSyncAt: string | null;
  tt: (key: string) => string;
  themeLabel: string;
  themeMode: ThemeMode;
  themeResolved: ResolvedTheme;
  formatWhen: (value?: string | null) => string;
  onToggleCollapsed: () => void;
  onCycleTheme: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectTab: (tab: TabId) => void;
}) {
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "sessions", label: props.tt("sessions") },
    { id: "settings", label: props.tt("settings") },
    { id: "maintenance", label: props.tt("renameOps") },
    { id: "requeue", label: props.tt("requeue") },
    { id: "daemon", label: props.tt("daemon") }
  ];
  const renameQueueCount = props.previewApplyCount + props.previewSuggestCount;

  return (
    <aside
      className={props.workspacePaneCollapsed ? "collapsed" : undefined}
      id="sidebar"
      style={{ viewTransitionName: "persistent-nav" } as React.CSSProperties}
    >
      <div className="sidebar-header">
        <div className="sidebar-brand-copy">
          <p className="sidebar-kicker">Session Control</p>
          <h1 className="home-link">CodexNamer</h1>
          <p className="sidebar-copy">{props.tt("sidebarSummary")}</p>
        </div>
        <div className="sidebar-header-actions">
          <ThemeToggle
            label={props.themeLabel}
            mode={props.themeMode}
            onToggle={props.onCycleTheme}
            resolvedTheme={props.themeResolved}
          />
          <button
            aria-controls="sidebar"
            aria-expanded={!props.workspacePaneCollapsed}
            className="pane-btn"
            onClick={props.onToggleCollapsed}
            title={props.workspacePaneCollapsed ? props.tt("expandWorkspacePane") : props.tt("collapseWorkspacePane")}
            type="button"
          >
            {props.workspacePaneCollapsed ? props.tt("open") : props.tt("fold")}
          </button>
        </div>
      </div>

      <div className="sidebar-actions">
        {tabs.map((tab) => (
          <button
            aria-current={props.tab === tab.id ? "page" : undefined}
            className={props.tab === tab.id ? "sidebar-btn active" : "sidebar-btn"}
            key={tab.id}
            onClick={() => props.onSelectTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <nav id="projectList">
        <div className="project-group-wrapper">
          <div className="project-group-header codex">
            <span className="project-group-dot" />
            <span>{props.tt("workspaces")}</span>
          </div>
          <div className="project-group-items">
            <button
              className={props.selectedWorkspaceId === props.allWorkspacesId ? "project-item active" : "project-item"}
              onClick={() => props.onSelectWorkspace(props.allWorkspacesId)}
              type="button"
            >
              <span className="name">{props.tt("allWorkspaces")}</span>
              <span className="count">{props.totalWorkspaceSessionCount}</span>
            </button>
            {props.workspaces.map((workspace) => (
              <button
                className={props.selectedWorkspaceId === workspace.workspaceId ? "project-item active" : "project-item"}
                key={workspace.workspaceId}
                onClick={() => props.onSelectWorkspace(workspace.workspaceId)}
                type="button"
              >
                <span className="name">{workspace.workspaceLabel}</span>
                <span className="count">{workspace.sessionCount}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="sidebar-footer compact">
        <div className="sidebar-stat-row">
          <span>{props.tt("visible")}</span>
          <strong>{props.visibleSessionCount}</strong>
        </div>
        <div className="sidebar-stat-row">
          <span>{props.tt("queueSummary")}</span>
          <strong>{renameQueueCount}</strong>
        </div>
        <div className="sidebar-stat-row muted">
          <span>{props.tt("lastSync")}</span>
          <strong>{props.formatWhen(props.lastSyncAt)}</strong>
        </div>
      </div>
    </aside>
  );
}
