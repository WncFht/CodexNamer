import { useEffect } from "react";

import { useControlDeckActions } from "./actions/useControlDeckActions.js";
import {
  ALL_WORKSPACES_ID,
  liveRefreshResourcesForTab,
  panelResourcesForTab,
} from "./control-deck-model.js";
import { useControlDeckUiState } from "./state/useControlDeckUiState.js";
import { useControlDeckResources } from "./useControlDeckResources.js";

export function useControlDeckState() {
  const ui = useControlDeckUiState();

  const setFailure = (nextError: unknown) => {
    const message = nextError instanceof Error ? nextError.message : "Unknown error";
    ui.setError(message);
    ui.setNotice({
      tone: "error",
      text: message,
    });
  };

  const resources = useControlDeckResources({
    tab: ui.tab,
    search: ui.search,
    selectedWorkspaceId: ui.selectedWorkspaceId,
    selectedId: ui.selectedId,
    selectedRequestLogId: ui.selectedRequestLogId,
    onSelectSession: ui.setSelectedId,
    onSelectWorkspace: ui.setSelectedWorkspaceId,
    onFailure: setFailure,
  });
  const refreshCurrentView = resources.refreshCurrentView;

  useEffect(() => {
    if (!ui.error) {
      return;
    }

    const timer = window.setInterval(() => {
      refreshCurrentView();
    }, 3_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshCurrentView, ui.error]);

  const actionState = useControlDeckActions({
    resources: {
      detail: resources.detail,
      patchSelectedSession: resources.patchSelectedSession,
      setConfigView: resources.setConfigView,
      loadResources: resources.loadResources,
      mergeCurrentTabResources: resources.mergeCurrentTabResources,
      refreshCurrentView: resources.refreshCurrentView,
    },
    ui: {
      tab: ui.tab,
      selectedId: ui.selectedId,
      setError: ui.setError,
      setNotice: ui.setNotice,
    },
  });

  return {
    tab: ui.tab,
    setTab: ui.setTab,
    sessions: resources.sessions,
    workspaces: resources.workspaces,
    selectedWorkspaceId: ui.selectedWorkspaceId,
    setSelectedWorkspaceId: ui.setSelectedWorkspaceId,
    selectedId: ui.selectedId,
    setSelectedId: ui.setSelectedId,
    selectedRequestLogId: ui.selectedRequestLogId,
    setSelectedRequestLogId: ui.setSelectedRequestLogId,
    detail: resources.detail,
    providers: resources.providers,
    configView: resources.configView,
    doctor: resources.doctor,
    overview: resources.overview,
    daemon: resources.daemon,
    aiRequestLogs: resources.aiRequestLogs,
    aiRequestLogDetail: resources.aiRequestLogDetail,
    preview: resources.preview,
    search: ui.search,
    setSearch: ui.setSearch,
    showHiddenTranscript: ui.showHiddenTranscript,
    setShowHiddenTranscript: ui.setShowHiddenTranscript,
    loadingSessions: resources.loadingSessions,
    loadingDetail: resources.loadingDetail,
    actioning: actionState.actioning,
    actionLabel: actionState.actionLabel,
    error: ui.error,
    notice: ui.notice,
    setNotice: ui.setNotice,
    lastSyncAt: resources.lastSyncAt,
    previewRefreshing: resources.previewRefreshing,
    promptPreview: resources.promptPreview,
    promptPreviewRefreshing: resources.promptPreviewRefreshing,
    savingConfig: actionState.savingConfig,
    daemonActioning: actionState.daemonActioning,
    selectedSummary: resources.selectedSummary,
    refreshSessions: resources.refreshSessions,
    refreshPreview: resources.refreshPreview,
    refreshPromptPreview: resources.refreshPromptPreview,
    refreshSettings: resources.refreshSettings,
    refreshMaintenance: resources.refreshMaintenance,
    refreshRequeue: resources.refreshRequeue,
    refreshDaemon: resources.refreshDaemon,
    saveConfig: actionState.saveConfig,
    replayRenamesSince: actionState.replayRenamesSince,
    startDaemon: actionState.startDaemon,
    stopDaemon: actionState.stopDaemon,
    actions: actionState.actions,
  };
}

export { ALL_WORKSPACES_ID, liveRefreshResourcesForTab, panelResourcesForTab };
