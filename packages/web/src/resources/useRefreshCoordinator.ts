import type { ApiEventRecord } from "@codexnamer/shared";
import { useEffect, useRef } from "react";

import { fetchEvents } from "../api.js";
import type { TabId } from "../control-deck-model.js";
import type { ApiEventsResponse } from "../types.js";

const DEFAULT_EVENT_INTERVAL_MS = 5_000;
const DEFAULT_STALE_REFRESH_MS = 15_000;

export function useRefreshCoordinator(params: {
  tab: TabId;
  eventCursorRef: { current: number };
  refreshForEvents: (events: ApiEventRecord[]) => void;
  refreshFallback: () => void;
  eventIntervalMs?: number;
  staleRefreshMs?: number;
}) {
  const {
    tab,
    eventCursorRef,
    refreshForEvents,
    refreshFallback,
    eventIntervalMs = DEFAULT_EVENT_INTERVAL_MS,
    staleRefreshMs = DEFAULT_STALE_REFRESH_MS,
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
            refreshForEvents(payload.items);
            return;
          }

          if (!visible || Date.now() - lastTriggeredRefreshAtRef.current < staleRefreshMs) {
            return;
          }

          lastTriggeredRefreshAtRef.current = Date.now();
          refreshFallback();
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
  }, [eventCursorRef, eventIntervalMs, refreshFallback, refreshForEvents, staleRefreshMs]);
}
