import type { ApiEventBatch, ApiEventRecord, ApiEventType } from "@codex-session-manager/shared";

const DEFAULT_EVENT_LIMIT = 100;
const MAX_EVENT_LIMIT = 500;

export class ApiEventLog {
  private cursor = 0;
  private readonly events: ApiEventRecord[] = [];

  constructor(private readonly capacity: number = 500) {}

  publish(type: ApiEventType, payload: Record<string, unknown>): ApiEventRecord {
    const event: ApiEventRecord = {
      cursor: ++this.cursor,
      type,
      at: new Date().toISOString(),
      payload
    };
    this.events.push(event);
    if (this.events.length > this.capacity) {
      this.events.splice(0, this.events.length - this.capacity);
    }
    return event;
  }

  listSince(cursor: number, limit?: number): ApiEventBatch {
    const boundedLimit =
      typeof limit === "number" && Number.isFinite(limit)
        ? Math.max(1, Math.min(MAX_EVENT_LIMIT, Math.trunc(limit)))
        : DEFAULT_EVENT_LIMIT;
    const items = this.events.filter((event) => event.cursor > cursor).slice(0, boundedLimit);
    return {
      items,
      nextCursor: items.at(-1)?.cursor ?? this.cursor
    };
  }
}
