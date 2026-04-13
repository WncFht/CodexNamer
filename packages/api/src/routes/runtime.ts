import type { CodexNamer } from "@codexnamer/core";
import type { FastifyInstance } from "fastify";

import type { ApiEventLog } from "../event-log.js";

export function registerRuntimeRoutes(
  app: FastifyInstance,
  manager: CodexNamer,
  eventLog: ApiEventLog,
) {
  app.get("/api/v1/overview", async () => manager.overview());

  app.post("/api/v1/scan", async () => {
    const report = await manager.scan();
    eventLog.publish("scan.completed", report as unknown as Record<string, unknown>);
    return report;
  });

  app.get("/api/v1/doctor", async () => manager.doctor());

  app.get("/api/v1/maintenance/stats", async () => manager.doctor());
}
