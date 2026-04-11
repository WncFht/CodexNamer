import type { FastifyInstance } from "fastify";

import { ApiEventLog } from "../event-log.js";
import { parseNumberQuery } from "../lib/query.js";

export function registerEventRoutes(app: FastifyInstance, eventLog: ApiEventLog) {
  app.get("/api/v1/health", async () => ({
    ok: true,
    version: "0.1.0",
    time: new Date().toISOString()
  }));

  app.get("/api/v1/events/since", async (request) => {
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    return eventLog.listSince(parseNumberQuery(query.cursor) ?? 0, parseNumberQuery(query.limit));
  });
}
