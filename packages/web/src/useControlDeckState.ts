import { startTransition, useEffect, useRef, useState } from "react";

import {
  applySession,
  freezeSession,
  requeueRenamesSince,
  setSessionNamingStyle,
  suggestSession,
  toggleManualOverride,
  updateConfig
} from "./api.js";
import {
  ALL_WORKSPACES_ID,
  liveRefreshResourcesForTab,
  panelResourcesForTab,
  readUiStateFromUrl,
  writeUiStateToUrl,
  type TabId,
  type UiNotice
} from "./control-deck-model.js";
import { useControlDeckResources } from "./useControlDeckResources.js";
import type {
  ConfigDocument,
  RenameApplyResponse,
  RenameFreezeResponse,
  RenameNamingStyleResponse,
  RenameManualOverrideResponse,
  RenameSuggestResponse,
  SessionDetail,
  SessionSummary
} from "./types.js";

export function useControlDeckState() {
  const initialUiStateRef = useRef<ReturnType<typeof readUiStateFromUrl> | null>(null);
  if (!initialUiStateRef.current) {
    initialUiStateRef.current = readUiStateFromUrl();
  }
  const initialUiState = initialUiStateRef.current;

  const [tab, setTab] = useState<TabId>(initialUiState.tab);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(initialUiState.selectedWorkspaceId);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialUiState.selectedId);
  const [search, setSearch] = useState(initialUiState.search);
  const [dirtyOnly, setDirtyOnly] = useState(initialUiState.dirtyOnly);
  const [showHiddenTranscript, setShowHiddenTranscript] = useState(initialUiState.showHiddenTranscript);
  const [actioning, setActioning] = useState(false);
  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<UiNotice | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  const setFailure = (nextError: unknown) => {
    const message = nextError instanceof Error ? nextError.message : "Unknown error";
    setError(message);
    setNotice({
      tone: "error",
      text: message
    });
  };

  const resources = useControlDeckResources({
    tab,
    search,
    dirtyOnly,
    selectedWorkspaceId,
    selectedId,
    onSelectSession: setSelectedId,
    onSelectWorkspace: setSelectedWorkspaceId,
    onFailure: setFailure
  });
  const refreshCurrentView = resources.refreshCurrentView;

  useEffect(() => {
    writeUiStateToUrl({
      tab,
      search,
      dirtyOnly,
      showHiddenTranscript,
      selectedWorkspaceId,
      selectedId
    });
  }, [dirtyOnly, search, selectedId, selectedWorkspaceId, showHiddenTranscript, tab]);

  useEffect(() => {
    setError(null);
  }, [tab]);

  useEffect(() => {
    const handlePopState = () => {
      const nextState = readUiStateFromUrl();
      setTab(nextState.tab);
      setSelectedWorkspaceId(nextState.selectedWorkspaceId);
      setSelectedId(nextState.selectedId);
      setDirtyOnly(nextState.dirtyOnly);
      setShowHiddenTranscript(nextState.showHiddenTranscript);
      startTransition(() => {
        setSearch(nextState.search);
      });
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (!notice || notice.tone === "error") {
      return;
    }

    const timer = window.setTimeout(() => {
      setNotice((current) => (current === notice ? null : current));
    }, 4_000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  useEffect(() => {
    if (!error) {
      return;
    }

    const timer = window.setInterval(() => {
      refreshCurrentView();
    }, 3_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [error, refreshCurrentView]);

  const refreshAfterAction = (threadId: string) => {
    refreshCurrentView({
      threadId,
      includePromptPreview: true
    });
  };

  const runAction = async <T>(options: {
    threadId: string;
    actionName: string;
    action: () => Promise<T>;
    onSuccess: (result: T) => {
      message: string;
      patch?: Partial<SessionSummary & SessionDetail>;
    };
  }) => {
    setActioning(true);
    setActionLabel(options.actionName);
    setError(null);
    setNotice({
      tone: "info",
      text: `${options.actionName}...`
    });
    try {
      const result = await options.action();
      const success = options.onSuccess(result);
      if (success.patch) {
        resources.patchSelectedSession(options.threadId, success.patch);
      }
      setNotice({
        tone: "success",
        text: success.message
      });
      refreshAfterAction(options.threadId);
    } catch (nextError) {
      setFailure(nextError);
    } finally {
      setActioning(false);
      setActionLabel(null);
    }
  };

  const saveConfig = async (userConfig: ConfigDocument) => {
    setSavingConfig(true);
    setError(null);
    setNotice({
      tone: "info",
      text: "Saving settings..."
    });
    try {
      const result = await updateConfig(userConfig);
      resources.setConfigView(result.config);
      await resources.loadResources(resources.mergeCurrentTabResources(["config", "sessions", "preview"]), {
        threadId: selectedId,
        urgentPreview: true,
        urgentPromptPreview: tab === "settings"
      });
      setNotice({
        tone: "success",
        text: result.restartRequired
          ? `Saved to ${result.writtenTo}. Restart required for some changes.`
          : `Saved to ${result.writtenTo}.`
      });
    } catch (nextError) {
      setFailure(nextError);
    } finally {
      setSavingConfig(false);
    }
  };

  const replayRenamesSince = async (params: {
    since: string;
    basis: "session-updated-at" | "last-applied-at";
  }) => {
    setError(null);
    setNotice({
      tone: "info",
      text: "Re-queueing rename backlog..."
    });
    try {
      const result = await requeueRenamesSince(params);
      await resources.loadResources(resources.mergeCurrentTabResources(["sessions", "overview", "preview"]), {
        threadId: selectedId,
        urgentPreview: true,
        urgentPromptPreview: tab === "settings"
      });
      setNotice({
        tone: "success",
        text: `Queued ${result.queued} sessions for rename replay.`
      });
      return result;
    } catch (nextError) {
      setFailure(nextError);
      throw nextError;
    }
  };

  return {
    tab,
    setTab,
    sessions: resources.sessions,
    workspaces: resources.workspaces,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    selectedId,
    setSelectedId,
    detail: resources.detail,
    providers: resources.providers,
    configView: resources.configView,
    doctor: resources.doctor,
    overview: resources.overview,
    aiRequestLogs: resources.aiRequestLogs,
    preview: resources.preview,
    search,
    setSearch: (value: string) => {
      startTransition(() => {
        setSearch(value);
      });
    },
    dirtyOnly,
    setDirtyOnly,
    showHiddenTranscript,
    setShowHiddenTranscript,
    loadingSessions: resources.loadingSessions,
    loadingDetail: resources.loadingDetail,
    actioning,
    actionLabel,
    error,
    notice,
    setNotice,
    lastSyncAt: resources.lastSyncAt,
    previewRefreshing: resources.previewRefreshing,
    promptPreview: resources.promptPreview,
    promptPreviewRefreshing: resources.promptPreviewRefreshing,
    savingConfig,
    selectedSummary: resources.selectedSummary,
    refreshSessions: resources.refreshSessions,
    refreshPreview: resources.refreshPreview,
    refreshPromptPreview: resources.refreshPromptPreview,
    refreshSettings: resources.refreshSettings,
    refreshMaintenance: resources.refreshMaintenance,
    saveConfig,
    replayRenamesSince,
    actions: {
      suggest: () =>
        resources.detail
          ? runAction<RenameSuggestResponse>({
              threadId: resources.detail.threadId,
              actionName: "Suggesting name",
              action: () => suggestSession(resources.detail!.threadId),
              onSuccess: (result) => ({
                message: `Suggested: ${result.name}`,
                patch: {
                  candidateName: result.name,
                  dirty: true
                }
              })
            })
          : Promise.resolve(),
      apply: () =>
        resources.detail
          ? runAction<RenameApplyResponse>({
              threadId: resources.detail.threadId,
              actionName: "Applying rename",
              action: () => applySession(resources.detail!.threadId),
              onSuccess: (result) => ({
                message: result.written ? `Applied: ${result.name}` : `Already up to date: ${result.name}`,
                patch: {
                  officialName: result.name,
                  candidateName: result.name,
                  dirty: false
                }
              })
            })
          : Promise.resolve(),
      toggleFreeze: () =>
        resources.detail
          ? runAction<RenameFreezeResponse>({
              threadId: resources.detail.threadId,
              actionName: resources.detail.frozen ? "Unfreezing session" : "Freezing session",
              action: () => freezeSession(resources.detail!.threadId, !resources.detail!.frozen),
              onSuccess: (result) => ({
                message: result.frozen ? "Session frozen" : "Session unfrozen",
                patch: {
                  frozen: result.frozen
                }
              })
            })
          : Promise.resolve(),
      toggleManualOverride: () =>
        resources.detail
          ? runAction<RenameManualOverrideResponse>({
              threadId: resources.detail.threadId,
              actionName: resources.detail.manualOverride ? "Clearing manual override" : "Enabling manual override",
              action: () => toggleManualOverride(resources.detail!.threadId, !resources.detail!.manualOverride),
              onSuccess: (result) => ({
                message: result.manualOverride ? "Manual override enabled" : "Manual override cleared",
                patch: {
                  manualOverride: result.manualOverride
                }
              })
            })
          : Promise.resolve(),
      setNamingStyle: (style: "brief" | "detailed" | "default") =>
        resources.detail
          ? runAction<RenameNamingStyleResponse>({
              threadId: resources.detail.threadId,
              actionName: "Updating naming style",
              action: () => setSessionNamingStyle(resources.detail!.threadId, style),
              onSuccess: (result) => ({
                message:
                  style === "default"
                    ? "Session now follows the default naming style"
                    : `Session naming style set to ${result.effectiveStyle}`,
                patch: {
                  preferredNamingStyle: result.preferredStyle,
                  effectiveNamingStyle: result.effectiveStyle,
                  candidateName:
                    resources.detail?.candidateNamingStyle &&
                    resources.detail.candidateNamingStyle !== result.effectiveStyle
                      ? undefined
                      : resources.detail?.candidateName
                }
              })
            })
          : Promise.resolve()
    }
  };
}

export { ALL_WORKSPACES_ID, liveRefreshResourcesForTab, panelResourcesForTab };
