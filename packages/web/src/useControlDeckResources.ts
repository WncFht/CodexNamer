import { useCallback, useEffect, useRef } from "react";

import {
  liveRefreshResourcesForTab,
  mergeResources,
  panelResourcesForTab,
  type DataResource,
  type TabId
} from "./control-deck-model.js";
import type { ConfigDocument } from "./types.js";
import { usePanelResourceStore } from "./resources/usePanelResourceStore.js";
import { useRefreshCoordinator } from "./resources/useRefreshCoordinator.js";
import { useSessionResourceStore } from "./resources/useSessionResourceStore.js";

type UseControlDeckResourcesOptions = {
  tab: TabId;
  search: string;
  dirtyOnly: boolean;
  selectedWorkspaceId: string;
  selectedId?: string;
  selectedRequestLogId?: number;
  onSelectSession: (threadId?: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onFailure: (error: unknown) => void;
};

export function useControlDeckResources(options: UseControlDeckResourcesOptions) {
  const {
    tab,
    search,
    dirtyOnly,
    selectedWorkspaceId,
    selectedId,
    selectedRequestLogId,
    onSelectSession,
    onSelectWorkspace,
    onFailure
  } = options;
  const eventCursorRef = useRef(0);
  const latestUiStateRef = useRef({
    tab,
    selectedId
  });
  const latestCallbacksRef = useRef({
    onFailure
  });

  latestUiStateRef.current = {
    tab,
    selectedId
  };
  latestCallbacksRef.current = {
    onFailure
  };
  const reportFailure = useCallback((error: unknown) => {
    latestCallbacksRef.current.onFailure(error);
  }, []);

  const sessions = useSessionResourceStore({
    tab,
    search,
    dirtyOnly,
    selectedWorkspaceId,
    selectedId,
    onSelectSession,
    onSelectWorkspace,
    onFailure
  });
  const panels = usePanelResourceStore({
    tab,
    selectedId,
    selectedRequestLogId,
    onFailure
  });
  const {
    sessions: sessionItems,
    setSessions,
    workspaces,
    detail,
    setDetail,
    loadingSessions,
    loadingDetail,
    lastSyncAt,
    selectedSummary,
    patchSelectedSession,
    refreshSessions,
    refreshDetail,
    setLastSyncAt
  } = sessions;
  const {
    providers,
    configView,
    setConfigView,
    doctor,
    overview,
    daemon,
    aiRequestLogs,
    aiRequestLogDetail,
    preview,
    previewRefreshing,
    promptPreview,
    promptPreviewRefreshing,
    refreshConfigView,
    refreshProviders,
    refreshOverview,
    refreshDoctor,
    refreshDaemon,
    refreshAiRequestLogs,
    refreshPreview,
    refreshPromptPreview
  } = panels;

  const loadResources = useCallback(
    async (
      resources: readonly DataResource[],
      resourceOptions?: {
        threadId?: string;
        urgentPreview?: boolean;
        urgentPromptPreview?: boolean;
      }
    ) => {
      const tasks: Array<Promise<void>> = [];

      if (resources.includes("sessions")) {
        tasks.push(refreshSessions());
      }
      if (resources.includes("config")) {
        tasks.push(refreshConfigView());
      }
      if (resources.includes("providers")) {
        tasks.push(refreshProviders());
      }
      if (resources.includes("overview")) {
        tasks.push(refreshOverview());
      }
      if (resources.includes("doctor")) {
        tasks.push(refreshDoctor());
      }
      if (resources.includes("daemon")) {
        tasks.push(refreshDaemon());
      }
      if (resources.includes("ai-request-logs")) {
        tasks.push(refreshAiRequestLogs());
      }
      if (resources.includes("preview")) {
        tasks.push(
          refreshPreview({
            includeCandidateNames: false,
            urgent: resourceOptions?.urgentPreview
          })
        );
      }
      if (resources.includes("prompt-preview")) {
        tasks.push(
          refreshPromptPreview({
            threadId: resourceOptions?.threadId,
            urgent: resourceOptions?.urgentPromptPreview
          })
        );
      }

      if (tasks.length === 0) {
        return;
      }

      await Promise.all(tasks);
    },
    [
      refreshAiRequestLogs,
      refreshConfigView,
      refreshDaemon,
      refreshDoctor,
      refreshOverview,
      refreshPreview,
      refreshPromptPreview,
      refreshProviders,
      refreshSessions
    ]
  );

  useEffect(() => {
    void refreshPreview();
  }, [refreshPreview]);

  useEffect(() => {
    const resources = panelResourcesForTab(tab);
    if (resources.length === 0) {
      return;
    }

    void loadResources(resources, {
      threadId: latestUiStateRef.current.selectedId,
      urgentPromptPreview: tab === "settings"
    }).catch((error) => {
      reportFailure(error);
    });
  }, [loadResources, reportFailure, tab]);

  useEffect(() => {
    let active = true;
    void refreshConfigView()
      .then(() => {
        if (active) {
          setLastSyncAt((previous) => previous ?? new Date().toISOString());
        }
      })
      .catch((error) => {
        if (active) {
          reportFailure(error);
        }
      });
    return () => {
      active = false;
    };
  }, [refreshConfigView, reportFailure, setLastSyncAt]);

  const refreshCurrentView = useCallback(
    (
      refreshOptions?: {
        threadId?: string;
        includePromptPreview?: boolean;
      }
    ) => {
      const nextTab = latestUiStateRef.current.tab;
      const nextThreadId = refreshOptions?.threadId ?? latestUiStateRef.current.selectedId;
      const resources = liveRefreshResourcesForTab(nextTab, {
        includePromptPreview: refreshOptions?.includePromptPreview
      });
      const tasks: Array<Promise<unknown>> = [
        loadResources(resources, {
          threadId: nextThreadId
        })
      ];
      if (nextTab === "sessions" && nextThreadId) {
        tasks.push(refreshDetail(nextThreadId));
      }
      void Promise.all(tasks).catch(() => undefined);
    },
    [loadResources, refreshDetail]
  );

  useRefreshCoordinator({
    tab,
    eventCursorRef,
    refreshCurrentView: () => {
      refreshCurrentView();
    },
    refreshFallback: () => {
      refreshCurrentView();
    }
  });

  return {
    sessions: sessionItems,
    setSessions,
    workspaces,
    detail,
    setDetail,
    providers,
    configView,
    setConfigView,
    doctor,
    overview,
    daemon,
    aiRequestLogs,
    aiRequestLogDetail,
    preview,
    loadingSessions,
    loadingDetail,
    lastSyncAt,
    previewRefreshing,
    promptPreview,
    promptPreviewRefreshing,
    selectedSummary,
    patchSelectedSession,
    refreshCurrentView,
    refreshSessions,
    refreshPreview,
    refreshPromptPreview: (userConfig?: ConfigDocument, refreshOptions?: { urgent?: boolean }) =>
      refreshPromptPreview({
        threadId: latestUiStateRef.current.selectedId,
        urgent: refreshOptions?.urgent ?? true,
        userConfig
      }),
    refreshSettings: () =>
      loadResources(panelResourcesForTab("settings"), {
        threadId: latestUiStateRef.current.selectedId,
        urgentPromptPreview: true
      }),
    refreshMaintenance: () =>
      loadResources(panelResourcesForTab("maintenance"), {
        threadId: latestUiStateRef.current.selectedId
      }),
    refreshRequeue: () =>
      loadResources(panelResourcesForTab("requeue"), {
        threadId: latestUiStateRef.current.selectedId
      }),
    refreshDaemon: () =>
      loadResources(panelResourcesForTab("daemon"), {
        threadId: latestUiStateRef.current.selectedId
      }),
    loadResources,
    mergeCurrentTabResources: (...groups: readonly DataResource[][]) =>
      mergeResources(...groups, panelResourcesForTab(latestUiStateRef.current.tab))
  };
}
