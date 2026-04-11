import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchSessionDetail, fetchSessions } from "../api.js";
import { ALL_WORKSPACES_ID, areSessionFiltersEnabled, type TabId } from "../control-deck-model.js";
import type { SessionDetail, SessionSummary, SessionsResponse } from "../types.js";

type UseSessionResourceStoreOptions = {
  tab: TabId;
  search: string;
  dirtyOnly: boolean;
  selectedWorkspaceId: string;
  selectedId?: string;
  onSelectSession: (threadId?: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onFailure: (error: unknown) => void;
};

export function useSessionResourceStore(options: UseSessionResourceStoreOptions) {
  const {
    tab,
    search,
    dirtyOnly,
    selectedWorkspaceId,
    selectedId,
    onSelectSession,
    onSelectWorkspace,
    onFailure
  } = options;
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<SessionsResponse["workspaces"]>([]);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const latestUiStateRef = useRef({
    search,
    dirtyOnly,
    selectedWorkspaceId,
    selectedId
  });
  const latestCallbacksRef = useRef({
    onSelectSession,
    onSelectWorkspace,
    onFailure
  });
  const sessionsRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);

  latestUiStateRef.current = {
    search,
    dirtyOnly,
    selectedWorkspaceId,
    selectedId
  };
  latestCallbacksRef.current = {
    onSelectSession,
    onSelectWorkspace,
    onFailure
  };

  const selectedSummary = useMemo(
    () => sessions.find((item) => item.threadId === selectedId),
    [selectedId, sessions]
  );

  const patchSelectedSession = (threadId: string, patch: Partial<SessionSummary & SessionDetail>) => {
    setSessions((previous) =>
      previous.map((item) => (item.threadId === threadId ? ({ ...item, ...patch } as SessionSummary) : item))
    );
    setDetail((previous) =>
      previous?.threadId === threadId ? ({ ...previous, ...patch } as SessionDetail) : previous
    );
  };

  const refreshSessions = useCallback(async () => {
    const {
      dirtyOnly: nextDirtyOnly,
      selectedWorkspaceId: nextWorkspaceId,
      selectedId: nextSelectedId,
      search: nextSearch
    } = latestUiStateRef.current;

    setLoadingSessions(true);
    const requestId = ++sessionsRequestIdRef.current;
    try {
      const filtersEnabled = areSessionFiltersEnabled();
      const effectiveDirtyOnly = filtersEnabled ? nextDirtyOnly : false;
      const payload = await fetchSessions({
        search: nextSearch.trim() || undefined,
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
        latestCallbacksRef.current.onSelectWorkspace(ALL_WORKSPACES_ID);
      }

      if (!nextSelectedId && payload.items[0]) {
        latestCallbacksRef.current.onSelectSession(payload.items[0].threadId);
      } else if (nextSelectedId && !payload.items.some((item) => item.threadId === nextSelectedId)) {
        latestCallbacksRef.current.onSelectSession(payload.items[0]?.threadId);
      }
    } catch (error) {
      if (requestId === sessionsRequestIdRef.current) {
        latestCallbacksRef.current.onFailure(error);
      }
    } finally {
      if (requestId === sessionsRequestIdRef.current) {
        setLoadingSessions(false);
      }
    }
  }, []);

  const refreshDetail = useCallback(async (threadId: string | undefined) => {
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
        latestCallbacksRef.current.onFailure(error);
      }
    } finally {
      if (requestId === detailRequestIdRef.current) {
        setLoadingDetail(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [dirtyOnly, refreshSessions, search, selectedWorkspaceId]);

  useEffect(() => {
    if (tab !== "sessions") {
      setLoadingDetail(false);
      return;
    }
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void refreshDetail(selectedId);
  }, [refreshDetail, selectedId, tab]);

  return {
    sessions,
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
  };
}
