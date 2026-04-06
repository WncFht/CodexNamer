import { useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import {
  fetchAiRequestLogs,
  fetchAutoRenamePreview,
  fetchConfig,
  fetchDoctor,
  fetchEvents,
  fetchOverview,
  fetchPromptPreview,
  fetchProviders,
  fetchSessionDetail,
  fetchSessions
} from "./api.js";
import {
  ALL_WORKSPACES_ID,
  areSessionFiltersEnabled,
  liveRefreshResourcesForTab,
  mergeResources,
  panelResourcesForTab,
  type DataResource,
  type TabId
} from "./control-deck-model.js";
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
  SessionDetail,
  SessionSummary,
  SessionsResponse
} from "./types.js";

type UseControlDeckResourcesOptions = {
  tab: TabId;
  search: string;
  dirtyOnly: boolean;
  selectedWorkspaceId: string;
  selectedId?: string;
  onSelectSession: (threadId?: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onFailure: (error: unknown) => void;
};

export function useControlDeckResources(options: UseControlDeckResourcesOptions) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<SessionsResponse["workspaces"]>([]);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [providers, setProviders] = useState<ProviderResponse | null>(null);
  const [configView, setConfigView] = useState<ConfigView | null>(null);
  const [doctor, setDoctor] = useState<DoctorResponse | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [aiRequestLogs, setAiRequestLogs] = useState<AiRequestLogResponse | null>(null);
  const [preview, setPreview] = useState<AutoRenamePreviewResponse | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [previewRefreshing, setPreviewRefreshing] = useState(false);
  const [promptPreview, setPromptPreview] = useState<PromptPreviewResponse | null>(null);
  const [promptPreviewRefreshing, setPromptPreviewRefreshing] = useState(false);
  const deferredSearch = useDeferredValue(options.search);
  const eventCursorRef = useRef(0);
  const latestUiStateRef = useRef({
    tab: options.tab,
    deferredSearch,
    dirtyOnly: options.dirtyOnly,
    selectedWorkspaceId: options.selectedWorkspaceId,
    selectedId: options.selectedId
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
    tab: options.tab,
    deferredSearch,
    dirtyOnly: options.dirtyOnly,
    selectedWorkspaceId: options.selectedWorkspaceId,
    selectedId: options.selectedId
  };

  const selectedSummary = useMemo(
    () => sessions.find((item) => item.threadId === options.selectedId),
    [options.selectedId, sessions]
  );

  const reportFailure = useEffectEvent((error: unknown) => {
    options.onFailure(error);
  });

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

  const reloadPromptPreview = async (request?: {
    threadId?: string;
    urgent?: boolean;
    userConfig?: ConfigDocument;
  }) => {
    if (request?.urgent) {
      promptPreviewUrgentPendingRef.current += 1;
      setPromptPreviewRefreshing(true);
    }
    const requestId = ++promptPreviewRequestIdRef.current;
    try {
      const payload = await fetchPromptPreview(
        request?.threadId ?? latestUiStateRef.current.selectedId,
        request?.userConfig
      );
      if (requestId !== promptPreviewRequestIdRef.current) {
        return;
      }
      setPromptPreview(payload);
    } finally {
      if (request?.urgent) {
        promptPreviewUrgentPendingRef.current = Math.max(0, promptPreviewUrgentPendingRef.current - 1);
        if (promptPreviewUrgentPendingRef.current === 0) {
          setPromptPreviewRefreshing(false);
        }
      }
    }
  };

  const loadResources = async (
    resources: readonly DataResource[],
    resourceOptions?: {
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
          urgent: resourceOptions?.urgentPreview
        })
      );
    }
    if (resources.includes("prompt-preview")) {
      tasks.push(
        reloadPromptPreview({
          threadId: resourceOptions?.threadId,
          urgent: resourceOptions?.urgentPromptPreview
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
    try {
      const payload = await fetchSessionDetail(threadId);
      if (requestId !== detailRequestIdRef.current) {
        return;
      }
      setDetail(payload);
    } catch (error) {
      if (requestId === detailRequestIdRef.current) {
        reportFailure(error);
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
    const requestId = ++sessionsRequestIdRef.current;
    try {
      const filtersEnabled = areSessionFiltersEnabled();
      const effectiveSearch = filtersEnabled ? nextSearch : "";
      const effectiveDirtyOnly = filtersEnabled ? nextDirtyOnly : false;
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
        options.onSelectWorkspace(ALL_WORKSPACES_ID);
      }

      if (!nextSelectedId && payload.items[0]) {
        options.onSelectSession(payload.items[0].threadId);
      } else if (nextSelectedId && !payload.items.some((item) => item.threadId === nextSelectedId)) {
        options.onSelectSession(payload.items[0]?.threadId);
      }
    } catch (error) {
      if (requestId === sessionsRequestIdRef.current) {
        reportFailure(error);
      }
    } finally {
      if (requestId === sessionsRequestIdRef.current) {
        setLoadingSessions(false);
      }
    }
  };

  useEffect(() => {
    void reloadSessions();
  }, [deferredSearch, options.dirtyOnly, options.selectedWorkspaceId]);

  useEffect(() => {
    void loadResources(["preview"]).catch(() => undefined);
  }, []);

  useEffect(() => {
    const resources = panelResourcesForTab(options.tab);
    if (resources.length === 0) {
      return;
    }

    void loadResources(resources, {
      threadId: latestUiStateRef.current.selectedId,
      urgentPromptPreview: options.tab === "settings"
    }).catch((error) => {
      reportFailure(error);
    });

    if (options.tab !== "maintenance") {
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
  }, [options.tab, reportFailure]);

  useEffect(() => {
    if (options.tab !== "settings") {
      return;
    }
    void reloadPromptPreview({
      threadId: options.selectedId,
      urgent: false
    });
  }, [configView?.effectiveConfig, options.selectedId, options.tab]);

  useEffect(() => {
    if (options.tab !== "sessions") {
      setLoadingDetail(false);
      return;
    }
    if (!options.selectedId) {
      setDetail(null);
      return;
    }
    void reloadDetail(options.selectedId);
  }, [options.selectedId, options.tab]);

  useEffect(() => {
    let active = true;
    void loadResources(["config"])
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
  }, [reportFailure]);

  const refreshCurrentView = useEffectEvent(
    (
      refreshOptions?: {
        threadId?: string;
        includePromptPreview?: boolean;
      }
    ) => {
      const nextTab = latestUiStateRef.current.tab;
      const resources = liveRefreshResourcesForTab(nextTab, {
        includePromptPreview: refreshOptions?.includePromptPreview
      });
      void loadResources(resources, {
        threadId: refreshOptions?.threadId ?? latestUiStateRef.current.selectedId
      }).catch(() => undefined);
    }
  );

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

  return {
    sessions,
    setSessions,
    workspaces,
    detail,
    setDetail,
    providers,
    configView,
    setConfigView,
    doctor,
    overview,
    aiRequestLogs,
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
    refreshSessions: reloadSessions,
    refreshPreview: reloadPreview,
    refreshPromptPreview: (userConfig?: ConfigDocument, refreshOptions?: { urgent?: boolean }) =>
      reloadPromptPreview({
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
    loadResources,
    mergeCurrentTabResources: (...groups: readonly DataResource[][]) =>
      mergeResources(...groups, panelResourcesForTab(latestUiStateRef.current.tab))
  };
}
