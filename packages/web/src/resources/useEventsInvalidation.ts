import { useEffect } from "react";

import { fetchEvents } from "../api.js";
import type { ApiEventsResponse } from "../types.js";

export function useEventsInvalidation(params: {
  eventCursorRef: { current: number };
  refreshCurrentView: () => void;
  refreshSessionsFallback: () => void;
}) {
  const { eventCursorRef, refreshCurrentView, refreshSessionsFallback } = params;

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
          refreshSessionsFallback();
        });
    }, 5_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [eventCursorRef, refreshCurrentView, refreshSessionsFallback]);
}
