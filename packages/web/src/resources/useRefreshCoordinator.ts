import { useEffect, useRef } from "react";

import { fetchEvents } from "../api.js";
import type { TabId } from "../control-deck-model.js";
import type { ApiEventsResponse } from "../types.js";

const DEFAULT_EVENT_INTERVAL_MS = 5_000;
const DEFAULT_STALE_REFRESH_MS = 15_000;

export function useRefreshCoordinator(params: {
  tab: TabId;
  eventCursorRef: { current: number };
  refreshCurrentView: () => void;
  refreshFallback: () => void;
  eventIntervalMs?: number;
  staleRefreshMs?: number;
}) {
  const {
    tab,
    eventCursorRef,
    refreshCurrentView,
    refreshFallback,
    eventIntervalMs = DEFAULT_EVENT_INTERVAL_MS,
    staleRefreshMs = DEFAULT_STALE_REFRESH_MS
  } = params;
  const lastTriggeredRefreshAtRef = useRef(Date.now());

  useEffect(() => {
    lastTriggeredRefreshAtRef.current = Date.now();
  }, [tab]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const visible = document.visibilityState !== "hidden";
      void fetchEvents(eventCursorRef.current)
        .then((payload: ApiEventsResponse) => {
          eventCursorRef.current = payload.nextCursor;
          if (payload.items.length > 0) {
            lastTriggeredRefreshAtRef.current = Date.now();
            refreshCurrentView();
            return;
          }

          if (!visible || Date.now() - lastTriggeredRefreshAtRef.current < staleRefreshMs) {
            return;
          }

          lastTriggeredRefreshAtRef.current = Date.now();
          refreshCurrentView();
        })
        .catch(() => {
          if (!visible || Date.now() - lastTriggeredRefreshAtRef.current < staleRefreshMs) {
            return;
          }

          lastTriggeredRefreshAtRef.current = Date.now();
          refreshFallback();
        });
    }, eventIntervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [eventCursorRef, eventIntervalMs, refreshCurrentView, refreshFallback, staleRefreshMs]);
}
