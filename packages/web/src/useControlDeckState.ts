import { startTransition, useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

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

type DataResource =
  | "sessions"
  | "config"
  | "providers"
  | "overview"
  | "doctor"
  | "ai-request-logs"
  | "preview"
  | "prompt-preview";

const ALL_WORKSPACES_ID = "__all_workspaces__";
const SESSION_FILTERS_ENABLED = false;

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

  if (!SESSION_FILTERS_ENABLED || !state.search) {
    params.delete("q");
  } else {
    params.set("q", state.search);
  }

  if (!SESSION_FILTERS_ENABLED || state.dirtyOnly) {
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

export function panelResourcesForTab(tab: TabId): DataResource[] {
  if (tab === "settings") {
    return ["config", "providers", "overview", "prompt-preview"];
  }
  if (tab === "maintenance") {
    return ["overview", "doctor", "ai-request-logs", "preview"];
  }
  return [];
}

export function liveRefreshResourcesForTab(
  tab: TabId,
  options?: {
    includePromptPreview?: boolean;
  }
): DataResource[] {
  const resources: DataResource[] = ["sessions", "preview"];
  if (tab === "settings") {
    resources.push("overview");
    if (options?.includePromptPreview) {
      resources.push("prompt-preview");
    }
    return resources;
  }
  if (tab === "maintenance") {
    resources.push("overview", "doctor", "ai-request-logs");
  }
  return resources;
}

function mergeResources(...resourceGroups: readonly DataResource[][]): DataResource[] {
  const merged = new Set<DataResource>();
  for (const group of resourceGroups) {
    for (const resource of group) {
      merged.add(resource);
    }
  }
  return [...merged];
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
    tab,
    deferredSearch,
    dirtyOnly,
    selectedWorkspaceId,
    selectedId
  });
  const sessionsRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const configRequestIdRef = useRef(0);
  const providersRequestIdRef = useRef(0);
  const overviewRequestIdRef = useRef(0);
  const doctorRequestIdRef = useRef(0);
  const aiRequestLogsRequestIdRef = useRef(0);
  const previewRequestIdRef = useRef(0);
  const promptPreviewRequestIdRef = useRef(0);
  const previewUrgentPendingRef = useRef(0);
  const promptPreviewUrgentPendingRef = useRef(0);

  latestUiStateRef.current = {
    tab,
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

  const reloadConfigView = async () => {
    const requestId = ++configRequestIdRef.current;
    const configPayload = await fetchConfig();
    if (requestId !== configRequestIdRef.current) {
      return;
    }
    setConfigView(configPayload);
  };

  const reloadProviders = async () => {
    const requestId = ++providersRequestIdRef.current;
    const providerPayload = await fetchProviders();
    if (requestId !== providersRequestIdRef.current) {
      return;
    }
    setProviders(providerPayload);
  };

  const reloadOverview = async () => {
    const requestId = ++overviewRequestIdRef.current;
    const overviewPayload = await fetchOverview();
    if (requestId !== overviewRequestIdRef.current) {
      return;
    }
    setOverview(overviewPayload);
  };

  const reloadDoctor = async () => {
    const requestId = ++doctorRequestIdRef.current;
    const doctorPayload = await fetchDoctor();
    if (requestId !== doctorRequestIdRef.current) {
      return;
    }
    setDoctor(doctorPayload);
  };

  const reloadAiRequestLogs = async () => {
    const requestId = ++aiRequestLogsRequestIdRef.current;
    const aiRequestLogPayload = await fetchAiRequestLogs();
    if (requestId !== aiRequestLogsRequestIdRef.current) {
      return;
    }
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

  const loadResources = async (
    resources: readonly DataResource[],
    options?: {
      threadId?: string;
      urgentPreview?: boolean;
      urgentPromptPreview?: boolean;
    }
  ) => {
    const tasks: Array<Promise<void>> = [];

    if (resources.includes("sessions")) {
      tasks.push(reloadSessions());
    }
    if (resources.includes("config")) {
      tasks.push(reloadConfigView());
    }
    if (resources.includes("providers")) {
      tasks.push(reloadProviders());
    }
    if (resources.includes("overview")) {
      tasks.push(reloadOverview());
    }
    if (resources.includes("doctor")) {
      tasks.push(reloadDoctor());
    }
    if (resources.includes("ai-request-logs")) {
      tasks.push(reloadAiRequestLogs());
    }
    if (resources.includes("preview")) {
      tasks.push(
        reloadPreview({
          includeCandidateNames: false,
          urgent: options?.urgentPreview
        })
      );
    }
    if (resources.includes("prompt-preview")) {
      tasks.push(
        reloadPromptPreview({
          threadId: options?.threadId,
          urgent: options?.urgentPromptPreview
        })
      );
    }

    if (tasks.length === 0) {
      return;
    }

    await Promise.all(tasks);
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
      const effectiveSearch = SESSION_FILTERS_ENABLED ? nextSearch : "";
      const effectiveDirtyOnly = SESSION_FILTERS_ENABLED ? nextDirtyOnly : false;
      const payload = await fetchSessions({
        search: effectiveSearch,
        dirtyOnly: effectiveDirtyOnly,
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
    void loadResources(["preview"], { urgentPreview: true }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const resources = panelResourcesForTab(tab);
    if (resources.length === 0) {
      return;
    }

    void loadResources(resources, {
      threadId: latestUiStateRef.current.selectedId,
      urgentPreview: tab === "maintenance",
      urgentPromptPreview: tab === "settings"
    }).catch((nextError) => {
      setFailure(nextError);
    });

    if (tab !== "maintenance") {
      return;
    }

    const timer = window.setInterval(() => {
      void loadResources(resources, {
        threadId: latestUiStateRef.current.selectedId
      }).catch(() => undefined);
    }, 5_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [tab]);

  useEffect(() => {
    if (tab !== "settings") {
      return;
    }
    void reloadPromptPreview({
      threadId: selectedId,
      urgent: false
    });
  }, [configView?.effectiveConfig, selectedId, tab]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void reloadDetail(selectedId);
  }, [selectedId]);

  useEffect(() => {
    let active = true;
    void loadResources(["config"])
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

  const refreshCurrentView = useEffectEvent(
    (
      options?: {
        threadId?: string;
        includePromptPreview?: boolean;
      }
    ) => {
      const nextTab = latestUiStateRef.current.tab;
      const resources = liveRefreshResourcesForTab(nextTab, {
        includePromptPreview: options?.includePromptPreview
      });
      void loadResources(resources, {
        threadId: options?.threadId ?? latestUiStateRef.current.selectedId
      }).catch(() => undefined);
    }
  );

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

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchEvents(eventCursorRef.current)
        .then((payload: ApiEventsResponse) => {
          eventCursorRef.current = payload.nextCursor;
          if (payload.items.length === 0) {
            return;
          }

          refreshCurrentView();
        })
        .catch(() => {
          void loadResources(["sessions"]).catch(() => undefined);
        });
    }, 5_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshCurrentView]);

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
      await loadResources(
        mergeResources(["config", "sessions", "preview"], panelResourcesForTab(latestUiStateRef.current.tab)),
        {
          threadId: latestUiStateRef.current.selectedId,
          urgentPreview: true,
          urgentPromptPreview: latestUiStateRef.current.tab === "settings"
        }
      );
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
    refreshSettings: () =>
      loadResources(panelResourcesForTab("settings"), {
        threadId: latestUiStateRef.current.selectedId,
        urgentPromptPreview: true
      }),
    refreshMaintenance: () =>
      loadResources(panelResourcesForTab("maintenance"), {
        threadId: latestUiStateRef.current.selectedId,
        urgentPreview: true
      }),
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
