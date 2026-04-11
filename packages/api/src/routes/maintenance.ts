import type { FastifyInstance } from "fastify";

import { CodexNamer } from "@codexnamer/core";

import { ApiEventLog } from "../event-log.js";

export function registerMaintenanceRoutes(app: FastifyInstance, manager: CodexNamer, eventLog: ApiEventLog) {
  app.post("/api/v1/maintenance/compact-index", async (request) => {
    const body = (request.body as { dryRun?: boolean } | undefined) ?? {};
    const result = await manager.compactIndex({ dryRun: body.dryRun ?? true });
    eventLog.publish("maintenance.compact.completed", {
      dryRun: result.dryRun,
      originalLines: result.originalLines,
      compactedLines: result.compactedLines,
      originalSizeBytes: result.originalSizeBytes,
      compactedSizeBytes: result.compactedSizeBytes
    });
    return result;
  });

  app.post("/api/v1/maintenance/requeue-renames", async (request) => {
    const body =
      (request.body as { since?: string; basis?: "session-updated-at" | "last-applied-at" } | undefined) ?? {};
    if (!body.since?.trim()) {
      throw new Error("since is required");
    }
    const result = await manager.requeueRenamesSince({
      since: body.since,
      basis: body.basis ?? "session-updated-at"
    });
    eventLog.publish("maintenance.rename_requeued", {
      since: result.since,
      basis: result.basis,
      queued: result.queued,
      skipped: result.skipped
    });
    return result;
  });

  app.post("/api/v1/maintenance/requeue-preview", async (request) => {
    const body =
      (request.body as { since?: string; basis?: "session-updated-at" | "last-applied-at" } | undefined) ?? {};
    if (!body.since?.trim()) {
      throw new Error("since is required");
    }
    return manager.previewRequeueRenamesSince({
      since: body.since,
      basis: body.basis ?? "session-updated-at"
    });
  });
}
