import type { CodexNamer } from "@codexnamer/core";
import { renameReplayRequestSchema } from "@codexnamer/shared";
import type { FastifyInstance } from "fastify";

import type { ApiEventLog } from "../event-log.js";

export function registerMaintenanceRoutes(
  app: FastifyInstance,
  manager: CodexNamer,
  eventLog: ApiEventLog,
) {
  app.post("/api/v1/maintenance/compact-index", async (request) => {
    const body = ((request.body as { dryRun?: boolean } | undefined) ?? {}) as { dryRun?: boolean };
    const result = await manager.compactIndex({ dryRun: body.dryRun ?? true });
    eventLog.publish("maintenance.compact.completed", {
      dryRun: result.dryRun,
      originalLines: result.originalLines,
      compactedLines: result.compactedLines,
      originalSizeBytes: result.originalSizeBytes,
      compactedSizeBytes: result.compactedSizeBytes,
    });
    return result;
  });

  app.post("/api/v1/maintenance/requeue-renames", async (request) => {
    const body = renameReplayRequestSchema.parse(
      (request.body as Record<string, unknown> | undefined) ?? {},
    );
    const result = await manager.requeueRenamesSince(body);
    eventLog.publish("maintenance.rename_requeued", {
      since: result.since,
      basis: result.basis,
      queued: result.queued,
      skipped: result.skipped,
    });
    return result;
  });

  app.post("/api/v1/maintenance/requeue-preview", async (request) => {
    const body = renameReplayRequestSchema.parse(
      (request.body as Record<string, unknown> | undefined) ?? {},
    );
    return manager.previewRequeueRenamesSince(body);
  });
}
