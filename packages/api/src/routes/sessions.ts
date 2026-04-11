import type { FastifyInstance } from "fastify";

import type { CodexNamer } from "@codexnamer/core";
import {
  batchApplyRequestSchema,
  renameRequestSchema,
  sessionDetailQuerySchema,
  sessionListQuerySchema,
  sessionTranscriptQuerySchema
} from "@codexnamer/shared";

import type { ApiEventLog } from "../event-log.js";

export function registerSessionRoutes(app: FastifyInstance, manager: CodexNamer, eventLog: ApiEventLog) {
  app.get("/api/v1/sessions", async (request) => {
    const query = sessionListQuerySchema.parse((request.query as Record<string, unknown> | undefined) ?? {});
    return manager.querySessions(query);
  });

  app.get("/api/v1/workspaces", async (request) => {
    const query = sessionListQuerySchema.parse((request.query as Record<string, unknown> | undefined) ?? {});
    return {
      items: await manager.listWorkspaces({
        dirty: query.dirty
      })
    };
  });

  app.get("/api/v1/sessions/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const query = sessionDetailQuerySchema.parse((request.query as Record<string, unknown> | undefined) ?? {});
    const detail = await manager.getSessionDetail(params.id, {
      includeTranscript: query.includeTranscript ?? false
    });
    if (!detail) {
      return reply.status(404).send({
        error: "not_found",
        message: `Unknown session: ${params.id}`
      });
    }
    return detail;
  });

  app.get("/api/v1/sessions/:id/transcript", async (request) => {
    const params = request.params as { id: string };
    const query = sessionTranscriptQuerySchema.parse((request.query as Record<string, unknown> | undefined) ?? {});

    return manager.getSessionTranscriptPage(params.id, query);
  });

  app.get("/api/v1/sessions/:id/history", async (request) => {
    const params = request.params as { id: string };
    return manager.getRenameHistory(params.id);
  });

  app.post("/api/v1/sessions/:id/suggest", async (request) => {
    const params = request.params as { id: string };
    const suggestion = await manager.suggest(params.id);
    eventLog.publish("session.suggested", {
      threadId: params.id,
      name: suggestion.name,
      source: suggestion.source
    });
    return suggestion;
  });

  app.post("/api/v1/sessions/:id/apply", async (request) => {
    const params = request.params as { id: string };
    const result = await manager.apply(params.id);
    eventLog.publish("session.applied", {
      threadId: params.id,
      name: result.name,
      written: result.written
    });
    return result;
  });

  app.post("/api/v1/sessions/:id/rename", async (request) => {
    const params = request.params as { id: string };
    const body = renameRequestSchema.parse((request.body as Record<string, unknown> | undefined) ?? {});
    const result = await manager.rename(params.id, body.name);
    eventLog.publish("session.renamed", {
      threadId: params.id,
      name: result.name,
      written: result.written
    });
    return result;
  });

  app.post("/api/v1/sessions/:id/freeze", async (request) => {
    const params = request.params as { id: string };
    await manager.freeze(params.id);
    eventLog.publish("session.freeze.changed", {
      threadId: params.id,
      frozen: true
    });
    return { threadId: params.id, frozen: true };
  });

  app.post("/api/v1/sessions/:id/unfreeze", async (request) => {
    const params = request.params as { id: string };
    await manager.unfreeze(params.id);
    eventLog.publish("session.freeze.changed", {
      threadId: params.id,
      frozen: false
    });
    return { threadId: params.id, frozen: false };
  });

  app.post("/api/v1/sessions/batch/suggest", async () => ({
    items: await manager.batchApplyDirty({ previewOnly: true })
  }));

  app.post("/api/v1/sessions/batch/apply", async (request) => {
    const body = batchApplyRequestSchema.parse((request.body as Record<string, unknown> | undefined) ?? {});
    if (body.filter?.dirty === false) {
      throw new Error("Only dirty batch processing is supported in v1.");
    }
    const items = await manager.batchApplyDirty({ previewOnly: body.previewOnly ?? false });
    eventLog.publish("batch.apply.completed", {
      previewOnly: body.previewOnly ?? false,
      appliedCount: items.filter((item) => item.action === "applied").length,
      skippedCount: items.filter((item) => item.action === "skipped").length,
      previewCount: items.filter((item) => item.action === "preview").length
    });
    return {
      items
    };
  });
}
