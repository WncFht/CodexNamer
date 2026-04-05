import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import {
  applySession,
  fetchConfig,
  fetchAutoRenamePreview,
  fetchDoctor,
  fetchEvents,
  fetchOverview,
  fetchProviders,
  fetchSessionDetail,
  fetchSessions,
  freezeSession,
  suggestSession,
  toggleManualOverride,
  updateConfig
} from "./api.js";
import type {
  ApiEventsResponse,
  AutoRenamePreviewResponse,
  ConfigDocument,
  ConfigView,
  DoctorResponse,
  OverviewResponse,
  ProviderResponse,
  RenameApplyResponse,
  RenameFreezeResponse,
  RenameManualOverrideResponse,
  RenameSuggestResponse,
  SessionDetail,
  SessionSummary,
  SessionsResponse
} from "./types.js";

export type TabId = "sessions" | "settings" | "maintenance";
export type UiNotice = {
  tone: "info" | "success" | "error";
  text: string;
};

const ALL_WORKSPACES_ID = "__all_workspaces__";

export function useControlDeckState() {
  const [tab, setTab] = useState<TabId>("sessions");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<SessionsResponse["workspaces"]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(ALL_WORKSPACES_ID);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [providers, setProviders] = useState<ProviderResponse | null>(null);
  const [configView, setConfigView] = useState<ConfigView | null>(null);
  const [doctor, setDoctor] = useState<DoctorResponse | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [preview, setPreview] = useState<AutoRenamePreviewResponse | null>(null);
  const [search, setSearch] = useState("");
  const [dirtyOnly, setDirtyOnly] = useState(true);
  const [showHiddenTranscript, setShowHiddenTranscript] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<UiNotice | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [previewRefreshing, setPreviewRefreshing] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const deferredSearch = useDeferredValue(search);
  const eventCursorRef = useRef(0);

  const selectedSummary = useMemo(() => sessions.find((item) => item.threadId === selectedId), [sessions, selectedId]);

  const setFailure = (nextError: unknown) => {
    const message = nextError instanceof Error ? nextError.message : "Unknown error";
    setError(message);
    setNotice({
      tone: "error",
      text: message
    });
  };

  const patchSelectedSession = (threadId: string, patch: Partial<SessionSummary & SessionDetail>) => {
    setSessions((previous) =>
      previous.map((item) => (item.threadId === threadId ? ({ ...item, ...patch } as SessionSummary) : item))
    );
    setDetail((previous) =>
      previous?.threadId === threadId ? ({ ...previous, ...patch } as SessionDetail) : previous
    );
  };

  const reloadSidePanels = async () => {
    const [providerPayload, configPayload, doctorPayload, overviewPayload] = await Promise.all([
      fetchProviders(),
      fetchConfig(),
      fetchDoctor(),
      fetchOverview()
    ]);
    setProviders(providerPayload);
    setConfigView(configPayload);
    setDoctor(doctorPayload);
    setOverview(overviewPayload);
  };

  const reloadPreview = async (options?: { includeCandidateNames?: boolean; urgent?: boolean }) => {
    if (options?.urgent) {
      setPreviewRefreshing(true);
    }
    try {
      const previewPayload = await fetchAutoRenamePreview({
        includeCandidateNames: options?.includeCandidateNames ?? false,
        limit: 50
      });
      setPreview(previewPayload);
    } catch {
      // Keep the last successful preview. Browsing sessions should not block on preview generation.
    } finally {
      if (options?.urgent) {
        setPreviewRefreshing(false);
      }
    }
  };

  const reloadDetail = async (threadId: string | undefined) => {
    if (!threadId) {
      setDetail(null);
      return;
    }

    setLoadingDetail(true);
    setError(null);
    try {
      const payload = await fetchSessionDetail(threadId);
      setDetail(payload);
    } catch (nextError) {
      setFailure(nextError);
    } finally {
      setLoadingDetail(false);
    }
  };

  const reloadSessions = async () => {
    setLoadingSessions(true);
    setError(null);
    try {
      const payload = await fetchSessions({
        search: deferredSearch,
        dirtyOnly,
        workspace: selectedWorkspaceId === ALL_WORKSPACES_ID ? undefined : selectedWorkspaceId
      });

      setSessions(payload.items);
      setWorkspaces(payload.workspaces);
      setLastSyncAt(new Date().toISOString());

      if (
        selectedWorkspaceId !== ALL_WORKSPACES_ID &&
        !payload.workspaces.some((item) => item.workspaceId === selectedWorkspaceId)
      ) {
        setSelectedWorkspaceId(ALL_WORKSPACES_ID);
      }

      if (!selectedId && payload.items[0]) {
        setSelectedId(payload.items[0].threadId);
      } else if (selectedId && !payload.items.some((item) => item.threadId === selectedId)) {
        setSelectedId(payload.items[0]?.threadId);
      }
    } catch (nextError) {
      setFailure(nextError);
    } finally {
      setLoadingSessions(false);
    }
  };

  useEffect(() => {
    void reloadSessions();
  }, [deferredSearch, dirtyOnly, selectedWorkspaceId]);

  useEffect(() => {
    void reloadPreview({ urgent: true });
  }, []);

  useEffect(() => {
    if (tab !== "maintenance") {
      return;
    }
    void reloadPreview({ includeCandidateNames: true, urgent: true });
  }, [tab]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void reloadDetail(selectedId);
  }, [selectedId]);

  useEffect(() => {
    let active = true;
    void reloadSidePanels()
      .then(() => {
        if (active) {
          setLastSyncAt((previous) => previous ?? new Date().toISOString());
        }
      })
      .catch((nextError) => {
        if (active) {
          setFailure(nextError);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!error) {
        return;
      }

      void reloadSessions();
      void reloadSidePanels().catch(() => undefined);
      void reloadPreview().catch(() => undefined);
      if (selectedId) {
        void fetchSessionDetail(selectedId)
          .then(setDetail)
          .catch(() => undefined);
      }
    }, 3_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [error, selectedId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchEvents(eventCursorRef.current)
        .then((payload: ApiEventsResponse) => {
          eventCursorRef.current = payload.nextCursor;
          if (payload.items.length === 0) {
            return;
          }

          void reloadSessions();
          void reloadSidePanels().catch(() => undefined);
          void reloadPreview().catch(() => undefined);
          if (selectedId) {
            void fetchSessionDetail(selectedId)
              .then(setDetail)
              .catch(() => undefined);
          }
        })
        .catch(() => {
          void reloadSessions();
        });
    }, 5_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [selectedId]);

  const refreshAfterAction = (threadId: string) => {
    void reloadSessions();
    void reloadSidePanels().catch(() => undefined);
    void reloadPreview({ includeCandidateNames: tab === "maintenance" }).catch(() => undefined);
    void fetchSessionDetail(threadId)
      .then(setDetail)
      .catch(() => undefined);
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
        patchSelectedSession(options.threadId, success.patch);
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
      setConfigView(result.config);
      await reloadSidePanels();
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

  return {
    tab,
    setTab,
    sessions,
    workspaces,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    selectedId,
    setSelectedId,
    detail,
    providers,
    configView,
    doctor,
    overview,
    preview,
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
    loadingSessions,
    loadingDetail,
    actioning,
    actionLabel,
    error,
    notice,
    setNotice,
    lastSyncAt,
    previewRefreshing,
    savingConfig,
    selectedSummary,
    refreshSessions: reloadSessions,
    refreshPreview: reloadPreview,
    refreshSidePanels: reloadSidePanels,
    saveConfig,
    actions: {
      suggest: () =>
        detail
          ? runAction<RenameSuggestResponse>({
              threadId: detail.threadId,
              actionName: "Suggesting name",
              action: () => suggestSession(detail.threadId),
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
        detail
          ? runAction<RenameApplyResponse>({
              threadId: detail.threadId,
              actionName: "Applying rename",
              action: () => applySession(detail.threadId),
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
        detail
          ? runAction<RenameFreezeResponse>({
              threadId: detail.threadId,
              actionName: detail.frozen ? "Unfreezing session" : "Freezing session",
              action: () => freezeSession(detail.threadId, !detail.frozen),
              onSuccess: (result) => ({
                message: result.frozen ? "Session frozen" : "Session unfrozen",
                patch: {
                  frozen: result.frozen
                }
              })
            })
          : Promise.resolve(),
      toggleManualOverride: () =>
        detail
          ? runAction<RenameManualOverrideResponse>({
              threadId: detail.threadId,
              actionName: detail.manualOverride ? "Clearing manual override" : "Enabling manual override",
              action: () => toggleManualOverride(detail.threadId, !detail.manualOverride),
              onSuccess: (result) => ({
                message: result.manualOverride ? "Manual override enabled" : "Manual override cleared",
                patch: {
                  manualOverride: result.manualOverride
                }
              })
            })
          : Promise.resolve()
    }
  };
}

export { ALL_WORKSPACES_ID };
