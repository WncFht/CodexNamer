import * as React from "react";

import { formatWhen } from "./browser-utils.js";
import { copyTextToClipboard } from "./clipboard.js";
import { SidebarRail } from "./app-shell/SidebarRail.js";
import { TopNoticeBanner } from "./app-shell/TopNoticeBanner.js";
import { usePaneLayoutState } from "./app-shell/usePaneLayoutState.js";
import { normalizeUiLanguage, t } from "./i18n.js";
import { SessionBrowser } from "./SessionBrowser.js";
import { ALL_WORKSPACES_ID, useControlDeckState } from "./useControlDeckState.js";
import { addAppTransitionType, AppViewTransition } from "./view-transitions.js";

const WORKSPACE_PANE_MIN_WIDTH = 220;
const WORKSPACE_PANE_MAX_WIDTH = 420;
const SettingsPanel = React.lazy(() =>
  import("./SettingsPanel.js").then((module) => ({ default: module.SettingsPanel }))
);
const RenameOpsPanel = React.lazy(() =>
  import("./RenameOpsPanel.js").then((module) => ({ default: module.RenameOpsPanel }))
);
const RequeuePanel = React.lazy(() =>
  import("./RequeuePanel.js").then((module) => ({ default: module.RequeuePanel }))
);
const DaemonPanel = React.lazy(() =>
  import("./DaemonPanel.js").then((module) => ({ default: module.DaemonPanel }))
);

function LazyTabShell(props: {
  active: boolean;
  loaded: boolean;
  children: React.ReactNode;
  loadingLabel: string;
}) {
  return (
    <div className="app-tab-panel" hidden={!props.active}>
      {props.loaded ? (
        <React.Suspense
          fallback={
            <AppViewTransition exit="slide-down">
              <div className="loading-state app-panel-loading">{props.loadingLabel}</div>
            </AppViewTransition>
          }
        >
          <AppViewTransition default="none" enter="slide-up">
            {props.children}
          </AppViewTransition>
        </React.Suspense>
      ) : null}
    </div>
  );
}

export function App() {
  const state = useControlDeckState();
  const paneLayout = usePaneLayoutState({
    tab: state.tab,
    selectedId: state.selectedId
  });
  const [settingsPanelLoaded, setSettingsPanelLoaded] = React.useState(() => state.tab === "settings");
  const [maintenancePanelLoaded, setMaintenancePanelLoaded] = React.useState(() => state.tab === "maintenance");
  const [requeuePanelLoaded, setRequeuePanelLoaded] = React.useState(() => state.tab === "requeue");
  const [daemonPanelLoaded, setDaemonPanelLoaded] = React.useState(() => state.tab === "daemon");
  const uiLanguage = normalizeUiLanguage(state.configView);
  const tt = (key: Parameters<typeof t>[1]) => t(uiLanguage, key);
  const previewApplyCount = state.preview?.items.filter((item) => item.status === "apply").length ?? 0;
  const previewSuggestCount = state.preview?.items.filter((item) => item.status === "suggest").length ?? 0;
  const totalWorkspaceSessionCount = state.workspaces.reduce((sum, workspace) => sum + workspace.sessionCount, 0);
  const selectedWorkspace =
    state.selectedWorkspaceId === ALL_WORKSPACES_ID
      ? undefined
      : state.workspaces.find((item) => item.workspaceId === state.selectedWorkspaceId);
  const selectedWorkspaceLabel = selectedWorkspace?.workspaceLabel ?? tt("allWorkspaces");

  React.useEffect(() => {
    document.documentElement.lang = uiLanguage;
  }, [uiLanguage]);

  React.useEffect(() => {
    if (state.tab === "settings") {
      setSettingsPanelLoaded(true);
    }
    if (state.tab === "maintenance") {
      setMaintenancePanelLoaded(true);
    }
    if (state.tab === "requeue") {
      setRequeuePanelLoaded(true);
    }
    if (state.tab === "daemon") {
      setDaemonPanelLoaded(true);
    }
  }, [state.tab]);

  const handleCopySessionId = React.useCallback(
    async (threadId: string) => {
      try {
        await copyTextToClipboard(threadId);
        state.setNotice({
          tone: "success",
          text: t(uiLanguage, "copiedSessionId")
        });
      } catch {
        state.setNotice({
          tone: "error",
          text: t(uiLanguage, "copySessionIdFailed")
        });
      }
    },
    [state, uiLanguage]
  );

  return (
    <div
      id="app"
      className={paneLayout.sessionFocusMode ? "session-focus-mode" : undefined}
      style={
        {
          "--sidebar-width": `${paneLayout.workspacePaneCollapsed ? 88 : paneLayout.workspacePaneWidth}px`,
          "--session-list-width": `${paneLayout.sessionPaneCollapsed ? 0 : paneLayout.sessionPaneWidth}px`
        } as React.CSSProperties
      }
    >
      <SidebarRail
        allWorkspacesId={ALL_WORKSPACES_ID}
        formatWhen={(value) => formatWhen(value, uiLanguage)}
        lastSyncAt={state.lastSyncAt}
        onSelectTab={(tab) =>
          React.startTransition(() => {
            addAppTransitionType("nav-lateral");
            state.setTab(tab);
          })
        }
        onSelectWorkspace={state.setSelectedWorkspaceId}
        onToggleCollapsed={() => paneLayout.setWorkspacePaneCollapsed((value) => !value)}
        previewApplyCount={previewApplyCount}
        previewSuggestCount={previewSuggestCount}
        selectedWorkspaceId={state.selectedWorkspaceId}
        selectedWorkspaceLabel={selectedWorkspaceLabel}
        tab={state.tab}
        totalWorkspaceSessionCount={totalWorkspaceSessionCount}
        visibleSessionCount={state.sessions.length}
        tt={tt as (key: string) => string}
        workspacePaneCollapsed={paneLayout.workspacePaneCollapsed}
        workspaces={state.workspaces}
      />

      <div
        className="splitter"
        onKeyDown={paneLayout.handleWorkspaceSplitterKeyDown}
        onPointerDown={paneLayout.startWorkspaceResize}
        role="separator"
        tabIndex={0}
        aria-controls="sidebar"
        aria-label={tt("resizeWorkspacePane")}
        aria-orientation="vertical"
        aria-valuemax={WORKSPACE_PANE_MAX_WIDTH}
        aria-valuemin={WORKSPACE_PANE_MIN_WIDTH}
        aria-valuenow={paneLayout.workspacePaneWidth}
      />

      <main id="content">
        <TopNoticeBanner notice={state.notice} />

        <div className="app-tab-panel" hidden={state.tab !== "sessions"}>
          {state.tab === "sessions" ? (
            <SessionBrowser
              sessions={state.sessions}
              selectedWorkspaceLabel={selectedWorkspaceLabel}
              search={state.search}
              selectedId={state.selectedId}
              detail={state.detail}
              focusMode={paneLayout.sessionFocusMode}
              sessionPaneCollapsed={paneLayout.sessionPaneCollapsed}
              sessionPaneWidth={paneLayout.sessionPaneWidth}
              loadingSessions={state.loadingSessions}
              loadingDetail={state.loadingDetail}
              actioning={state.actioning}
              actionLabel={state.actionLabel}
              showHiddenTranscript={state.showHiddenTranscript}
              error={state.error}
              uiLanguage={uiLanguage}
              onToggleShowHiddenTranscript={state.setShowHiddenTranscript}
              onSearchChange={state.setSearch}
              onRefresh={() => void state.refreshSessions()}
              onSelectSession={(threadId) => state.setSelectedId(threadId)}
              onCopySessionId={(threadId) => void handleCopySessionId(threadId)}
              onEnterFocusMode={() => paneLayout.setSessionFocusMode(true)}
              onExitFocusMode={() => paneLayout.setSessionFocusMode(false)}
              onToggleSessionPane={paneLayout.toggleSessionPane}
              onSessionPaneWidthChange={paneLayout.handleSessionPaneWidthChange}
              onStartSessionResize={paneLayout.startSessionResize}
              onSuggest={() => state.actions.suggest()}
              onApply={() => state.actions.apply()}
              onToggleFreeze={() => state.actions.toggleFreeze()}
            />
          ) : null}
        </div>

        <LazyTabShell active={state.tab === "settings"} loaded={settingsPanelLoaded} loadingLabel={tt("loading")}>
          <SettingsPanel
            configView={state.configView}
            daemon={state.daemon}
            overview={state.overview}
            onReload={() => void state.refreshSettings()}
            onOpenRequeue={() =>
              React.startTransition(() => {
                addAppTransitionType("nav-lateral");
                state.setTab("requeue");
              })
            }
            onSave={(patch) => state.saveConfig(patch)}
            previewApplyCount={previewApplyCount}
            previewSuggestCount={previewSuggestCount}
            providers={state.providers}
            saving={state.savingConfig}
            promptPreview={state.promptPreview}
            promptPreviewRefreshing={state.promptPreviewRefreshing}
            selectedThreadId={state.selectedId}
            onRefreshPromptPreview={(userConfig, options) => void state.refreshPromptPreview(userConfig, options)}
          />
        </LazyTabShell>

        <LazyTabShell active={state.tab === "maintenance"} loaded={maintenancePanelLoaded} loadingLabel={tt("loading")}>
          <RenameOpsPanel
            aiRequestLogs={state.aiRequestLogs}
            aiRequestLogDetail={state.aiRequestLogDetail}
            daemon={state.daemon}
            doctor={state.doctor}
            onOpenRequeue={() =>
              React.startTransition(() => {
                addAppTransitionType("nav-lateral");
                state.setTab("requeue");
              })
            }
            onRefreshRuntime={() => state.refreshMaintenance()}
            onRefreshPreview={(options) => state.refreshPreview(options)}
            onSelectRequestLog={state.setSelectedRequestLogId}
            overview={state.overview}
            preview={state.preview}
            previewRefreshing={state.previewRefreshing}
            selectedRequestLogId={state.selectedRequestLogId}
            uiLanguage={uiLanguage}
          />
        </LazyTabShell>

        <LazyTabShell active={state.tab === "requeue"} loaded={requeuePanelLoaded} loadingLabel={tt("loading")}>
          <RequeuePanel
            onRefresh={() => state.refreshRequeue()}
            onRequeue={(params) => state.replayRenamesSince(params)}
            overview={state.overview}
            uiLanguage={uiLanguage}
          />
        </LazyTabShell>

        <LazyTabShell active={state.tab === "daemon"} loaded={daemonPanelLoaded} loadingLabel={tt("loading")}>
          <DaemonPanel
            actioning={state.daemonActioning}
            daemon={state.daemon}
            onRefresh={() => void state.refreshDaemon()}
            onStart={() => void state.startDaemon()}
            onStop={() => void state.stopDaemon()}
            overview={state.overview}
            preview={state.preview}
            uiLanguage={uiLanguage}
          />
        </LazyTabShell>
      </main>
    </div>
  );
}
