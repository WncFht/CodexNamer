import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import {
  applySession,
  fetchAiRequestLogs,
  fetchConfig,
  fetchAutoRenamePreview,
  fetchDoctor,
  fetchEvents,
  fetchOverview,
  fetchProviders,
  fetchPromptPreview,
  fetchSessionDetail,
  fetchSessions,
  freezeSession,
  suggestSession,
  setSessionNamingStyle,
  toggleManualOverride,
  updateConfig
} from "./api.js";
import type {
  AiRequestLogResponse,
  ApiEventsResponse,
  AutoRenamePreviewResponse,
  ConfigDocument,
  ConfigView,
  DoctorResponse,
  OverviewResponse,
  PromptPreviewResponse,
  ProviderResponse,
  RenameApplyResponse,
  RenameFreezeResponse,
  RenameNamingStyleResponse,
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

type UrlUiState = {
  tab: TabId;
  search: string;
  dirtyOnly: boolean;
  showHiddenTranscript: boolean;
  selectedWorkspaceId: string;
  selectedId?: string;
};

function parseUrlBoolean(value: string | null, fallback: boolean): boolean {
  if (value === null) {
    return fallback;
  }
  return !["0", "false", "no"].includes(value.toLowerCase());
}

function parseUrlTab(value: string | null): TabId {
  if (value === "settings" || value === "maintenance") {
    return value;
  }
  return "sessions";
}

function readUiStateFromUrl(): UrlUiState {
  const params = new URLSearchParams(window.location.search);
  const workspace = params.get("workspace");
  return {
    tab: parseUrlTab(params.get("tab")),
    search: params.get("q") ?? "",
    dirtyOnly: parseUrlBoolean(params.get("dirty"), true),
    showHiddenTranscript: parseUrlBoolean(params.get("hidden"), false),
    selectedWorkspaceId: workspace && workspace !== ALL_WORKSPACES_ID ? workspace : ALL_WORKSPACES_ID,
    selectedId: params.get("session") ?? undefined
  };
}

function writeUiStateToUrl(state: UrlUiState): void {
  const params = new URLSearchParams(window.location.search);

  if (state.tab === "sessions") {
    params.delete("tab");
  } else {
    params.set("tab", state.tab);
  }

  if (!state.search) {
    params.delete("q");
  } else {
    params.set("q", state.search);
  }

  if (state.dirtyOnly) {
    params.delete("dirty");
  } else {
    params.set("dirty", "0");
  }

  if (!state.showHiddenTranscript) {
    params.delete("hidden");
  } else {
    params.set("hidden", "1");
  }

  if (state.selectedWorkspaceId === ALL_WORKSPACES_ID) {
    params.delete("workspace");
  } else {
    params.set("workspace", state.selectedWorkspaceId);
  }

  if (!state.selectedId) {
    params.delete("session");
  } else {
    params.set("session", state.selectedId);
  }

  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(window.history.state, "", nextUrl);
  }
}

export function useControlDeckState() {
  const initialUiStateRef = useRef<UrlUiState | null>(null);
  if (!initialUiStateRef.current) {
    initialUiStateRef.current = readUiStateFromUrl();
  }
  const initialUiState = initialUiStateRef.current;
  const [tab, setTab] = useState<TabId>(initialUiState.tab);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<SessionsResponse["workspaces"]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(initialUiState.selectedWorkspaceId);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialUiState.selectedId);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [providers, setProviders] = useState<ProviderResponse | null>(null);
  const [configView, setConfigView] = useState<ConfigView | null>(null);
  const [doctor, setDoctor] = useState<DoctorResponse | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [aiRequestLogs, setAiRequestLogs] = useState<AiRequestLogResponse | null>(null);
  const [preview, setPreview] = useState<AutoRenamePreviewResponse | null>(null);
  const [search, setSearch] = useState(initialUiState.search);
  const [dirtyOnly, setDirtyOnly] = useState(initialUiState.dirtyOnly);
  const [showHiddenTranscript, setShowHiddenTranscript] = useState(initialUiState.showHiddenTranscript);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<UiNotice | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [previewRefreshing, setPreviewRefreshing] = useState(false);
  const [promptPreview, setPromptPreview] = useState<PromptPreviewResponse | null>(null);
  const [promptPreviewRefreshing, setPromptPreviewRefreshing] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const deferredSearch = useDeferredValue(search);
  const eventCursorRef = useRef(0);
  const latestUiStateRef = useRef({
    deferredSearch,
    dirtyOnly,
    selectedWorkspaceId,
    selectedId
  });
  const sessionsRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const sidePanelsRequestIdRef = useRef(0);
  const previewRequestIdRef = useRef(0);
  const promptPreviewRequestIdRef = useRef(0);
  const previewUrgentPendingRef = useRef(0);
  const promptPreviewUrgentPendingRef = useRef(0);

  latestUiStateRef.current = {
    deferredSearch,
    dirtyOnly,
    selectedWorkspaceId,
    selectedId
  };

  const selectedSummary = useMemo(() => sessions.find((item) => item.threadId === selectedId), [sessions, selectedId]);

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
    const requestId = ++sidePanelsRequestIdRef.current;
    const [providerPayload, configPayload, doctorPayload, overviewPayload, aiRequestLogPayload] = await Promise.all([
      fetchProviders(),
      fetchConfig(),
      fetchDoctor(),
      fetchOverview(),
      fetchAiRequestLogs()
    ]);
    if (requestId !== sidePanelsRequestIdRef.current) {
      return;
    }
    setProviders(providerPayload);
    setConfigView(configPayload);
    setDoctor(doctorPayload);
    setOverview(overviewPayload);
    setAiRequestLogs(aiRequestLogPayload);
  };

  const reloadPreview = async (options?: { includeCandidateNames?: boolean; urgent?: boolean }) => {
    if (options?.urgent) {
      previewUrgentPendingRef.current += 1;
      setPreviewRefreshing(true);
    }
    const requestId = ++previewRequestIdRef.current;
    try {
      const previewPayload = await fetchAutoRenamePreview({
        includeCandidateNames: options?.includeCandidateNames ?? false,
        limit: 50
      });
      if (requestId !== previewRequestIdRef.current) {
        return;
      }
      setPreview(previewPayload);
    } catch {
      // Keep the last successful preview. Browsing sessions should not block on preview generation.
    } finally {
      if (options?.urgent) {
        previewUrgentPendingRef.current = Math.max(0, previewUrgentPendingRef.current - 1);
        if (previewUrgentPendingRef.current === 0) {
          setPreviewRefreshing(false);
        }
      }
    }
  };

  const reloadPromptPreview = async (options?: { threadId?: string; urgent?: boolean }) => {
    if (options?.urgent) {
      promptPreviewUrgentPendingRef.current += 1;
      setPromptPreviewRefreshing(true);
    }
    const requestId = ++promptPreviewRequestIdRef.current;
    try {
      const payload = await fetchPromptPreview(options?.threadId ?? latestUiStateRef.current.selectedId);
      if (requestId !== promptPreviewRequestIdRef.current) {
        return;
      }
      setPromptPreview(payload);
    } finally {
      if (options?.urgent) {
        promptPreviewUrgentPendingRef.current = Math.max(0, promptPreviewUrgentPendingRef.current - 1);
        if (promptPreviewUrgentPendingRef.current === 0) {
          setPromptPreviewRefreshing(false);
        }
      }
    }
  };

  const reloadDetail = async (threadId: string | undefined) => {
    const requestId = ++detailRequestIdRef.current;

    if (!threadId) {
      if (requestId === detailRequestIdRef.current) {
        setLoadingDetail(false);
      }
      setDetail(null);
      return;
    }

    setLoadingDetail(true);
    setError(null);
    try {
      const payload = await fetchSessionDetail(threadId);
      if (requestId !== detailRequestIdRef.current) {
        return;
      }
      setDetail(payload);
    } catch (nextError) {
      if (requestId === detailRequestIdRef.current) {
        setFailure(nextError);
      }
    } finally {
      if (requestId === detailRequestIdRef.current) {
        setLoadingDetail(false);
      }
    }
  };

  const reloadSessions = async () => {
    const {
      deferredSearch: nextSearch,
      dirtyOnly: nextDirtyOnly,
      selectedWorkspaceId: nextWorkspaceId,
      selectedId: nextSelectedId
    } = latestUiStateRef.current;

    setLoadingSessions(true);
    setError(null);
    const requestId = ++sessionsRequestIdRef.current;
    try {
      const payload = await fetchSessions({
        search: nextSearch,
        dirtyOnly: nextDirtyOnly,
        workspace: nextWorkspaceId === ALL_WORKSPACES_ID ? undefined : nextWorkspaceId
      });
      if (requestId !== sessionsRequestIdRef.current) {
        return;
      }

      setSessions(payload.items);
      setWorkspaces(payload.workspaces);
      setLastSyncAt(new Date().toISOString());

      if (
        nextWorkspaceId !== ALL_WORKSPACES_ID &&
        !payload.workspaces.some((item) => item.workspaceId === nextWorkspaceId)
      ) {
        setSelectedWorkspaceId(ALL_WORKSPACES_ID);
      }

      if (!nextSelectedId && payload.items[0]) {
        setSelectedId(payload.items[0].threadId);
      } else if (nextSelectedId && !payload.items.some((item) => item.threadId === nextSelectedId)) {
        setSelectedId(payload.items[0]?.threadId);
      }
    } catch (nextError) {
      if (requestId === sessionsRequestIdRef.current) {
        setFailure(nextError);
      }
    } finally {
      if (requestId === sessionsRequestIdRef.current) {
        setLoadingSessions(false);
      }
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

    void reloadSidePanels().catch(() => undefined);
    void reloadPreview({ includeCandidateNames: false, urgent: true }).catch(() => undefined);

    const timer = window.setInterval(() => {
      void reloadSidePanels().catch(() => undefined);
      void reloadPreview({ includeCandidateNames: false }).catch(() => undefined);
    }, 5_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [tab]);

  useEffect(() => {
    void reloadPromptPreview({
      threadId: selectedId,
      urgent: false
    });
  }, [selectedId, configView?.effectiveConfig]);

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

  const refreshVisibleState = (
    threadId = latestUiStateRef.current.selectedId,
    options?: {
      promptPreview?: boolean;
    }
  ) => {
    void reloadSessions();
    void reloadSidePanels().catch(() => undefined);
    void reloadPreview({ includeCandidateNames: false }).catch(() => undefined);
    if (options?.promptPreview) {
      void reloadPromptPreview({ threadId }).catch(() => undefined);
    }
  };

  useEffect(() => {
    if (!error) {
      return;
    }

    const timer = window.setInterval(() => {
      refreshVisibleState();
    }, 3_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [error]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchEvents(eventCursorRef.current)
        .then((payload: ApiEventsResponse) => {
          eventCursorRef.current = payload.nextCursor;
          if (payload.items.length === 0) {
            return;
          }

          refreshVisibleState();
        })
        .catch(() => {
          void reloadSessions();
        });
    }, 5_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const refreshAfterAction = (threadId: string) => {
    refreshVisibleState(threadId);
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
      await reloadPromptPreview({ threadId: latestUiStateRef.current.selectedId });
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
    aiRequestLogs,
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
    promptPreview,
    promptPreviewRefreshing,
    savingConfig,
    selectedSummary,
    refreshSessions: reloadSessions,
    refreshPreview: reloadPreview,
    refreshPromptPreview: () => reloadPromptPreview({ threadId: latestUiStateRef.current.selectedId, urgent: true }),
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
          : Promise.resolve(),
      setNamingStyle: (style: "brief" | "detailed" | "default") =>
        detail
          ? runAction<RenameNamingStyleResponse>({
              threadId: detail.threadId,
              actionName: "Updating naming style",
              action: () => setSessionNamingStyle(detail.threadId, style),
              onSuccess: (result) => ({
                message:
                  style === "default"
                    ? "Session now follows the default naming style"
                    : `Session naming style set to ${result.effectiveStyle}`,
                patch: {
                  preferredNamingStyle: result.preferredStyle,
                  effectiveNamingStyle: result.effectiveStyle,
                  candidateName:
                    detail.candidateNamingStyle && detail.candidateNamingStyle !== result.effectiveStyle
                      ? undefined
                      : detail.candidateName
                }
              })
            })
          : Promise.resolve()
    }
  };
}

export { ALL_WORKSPACES_ID };
