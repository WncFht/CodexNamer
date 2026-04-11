import type { FastifyInstance } from "fastify";

import type { CodexNamer } from "@codexnamer/core";

import type { ApiEventLog } from "../event-log.js";
import { filterAndSortSessions, parseBooleanQuery, parseNumberQuery } from "../lib/query.js";

export function registerSessionRoutes(app: FastifyInstance, manager: CodexNamer, eventLog: ApiEventLog) {
  app.get("/api/v1/sessions", async (request) => {
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const dirtyFilter = parseBooleanQuery(query.dirty);
    const allSessions = await manager.listSessions({
      dirty: dirtyFilter
    });
    const workspaces = await manager.listWorkspaces({
      dirty: dirtyFilter
    });
    const items = await filterAndSortSessions(allSessions, query, {
      loadDetailText: (threadId) => manager.db.getSessionDetail(threadId)
    });

    return {
      items,
      total: items.length,
      workspaces,
      counts: {
        dirty: allSessions.filter((item) => item.dirty).length,
        frozen: allSessions.filter((item) => item.frozen).length
      },
      nextCursor: null
    };
  });

  app.get("/api/v1/workspaces", async (request) => {
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const dirty = parseBooleanQuery(query.dirty);
    return {
      items: await manager.listWorkspaces({
        dirty
      })
    };
  });

  app.get("/api/v1/sessions/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const detail = await manager.getSessionDetail(params.id, {
      includeTranscript: parseBooleanQuery(query.includeTranscript) ?? false
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
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const roleValue = typeof query.role === "string" ? query.role : "all";
    const role = ["all", "user", "assistant", "tool", "system"].includes(roleValue) ? roleValue : "all";

    return manager.getSessionTranscriptPage(params.id, {
      page: parseNumberQuery(query.page),
      pageSize: parseNumberQuery(query.pageSize),
      includeHidden: parseBooleanQuery(query.includeHidden),
      role: role as "all" | "user" | "assistant" | "tool" | "system",
      query: typeof query.query === "string" ? query.query : undefined
    });
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
    const body = (request.body as { name?: string } | undefined) ?? {};
    if (!body.name?.trim()) {
      throw new Error("name is required");
    }
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
    const body = (request.body as { filter?: { dirty?: boolean }; previewOnly?: boolean } | undefined) ?? {};
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
