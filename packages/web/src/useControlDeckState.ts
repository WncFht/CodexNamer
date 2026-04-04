import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import {
  applySession,
  fetchAutoRenamePreview,
  fetchDoctor,
  fetchEvents,
  fetchProviders,
  fetchSessionDetail,
  fetchSessions,
  freezeSession,
  suggestSession,
  toggleManualOverride
} from "./api.js";
import type {
  ApiEventsResponse,
  AutoRenamePreviewResponse,
  DoctorResponse,
  ProviderResponse,
  SessionDetail,
  SessionSummary,
  SessionsResponse
} from "./types.js";

export type TabId = "sessions" | "providers" | "maintenance";

const ALL_WORKSPACES_ID = "__all_workspaces__";

export function useControlDeckState() {
  const [tab, setTab] = useState<TabId>("sessions");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<SessionsResponse["workspaces"]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(ALL_WORKSPACES_ID);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [providers, setProviders] = useState<ProviderResponse | null>(null);
  const [doctor, setDoctor] = useState<DoctorResponse | null>(null);
  const [preview, setPreview] = useState<AutoRenamePreviewResponse | null>(null);
  const [search, setSearch] = useState("");
  const [dirtyOnly, setDirtyOnly] = useState(true);
  const [showHiddenTranscript, setShowHiddenTranscript] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [previewRefreshing, setPreviewRefreshing] = useState(false);
  const deferredSearch = useDeferredValue(search);
  const eventCursorRef = useRef(0);

  const selectedSummary = useMemo(() => sessions.find((item) => item.threadId === selectedId), [sessions, selectedId]);

  const reloadSidePanels = async () => {
    const [providerPayload, doctorPayload] = await Promise.all([fetchProviders(), fetchDoctor()]);
    setProviders(providerPayload);
    setDoctor(doctorPayload);
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
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
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
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
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
          setError(nextError instanceof Error ? nextError.message : "Unknown error");
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

  const runAction = async (action: () => Promise<void>) => {
    if (!selectedId) {
      return;
    }
    setActioning(true);
    setError(null);
    try {
      await action();
      await Promise.all([reloadSessions(), fetchSessionDetail(selectedId).then(setDetail), reloadSidePanels()]);
      void reloadPreview({ includeCandidateNames: tab === "maintenance" });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setActioning(false);
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
    doctor,
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
    error,
    lastSyncAt,
    previewRefreshing,
    selectedSummary,
    refreshSessions: reloadSessions,
    refreshPreview: reloadPreview,
    runAction,
    actions: {
      suggest: () =>
        detail ? runAction(() => suggestSession(detail.threadId)) : Promise.resolve(),
      apply: () => (detail ? runAction(() => applySession(detail.threadId)) : Promise.resolve()),
      toggleFreeze: () =>
        detail ? runAction(() => freezeSession(detail.threadId, !detail.frozen)) : Promise.resolve(),
      toggleManualOverride: () =>
        detail
          ? runAction(() => toggleManualOverride(detail.threadId, !detail.manualOverride))
          : Promise.resolve()
    }
  };
}

export { ALL_WORKSPACES_ID };
