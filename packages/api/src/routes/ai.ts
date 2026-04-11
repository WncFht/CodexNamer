import type { FastifyInstance } from "fastify";

import { CodexNamer } from "@codexnamer/core";
import type { ConfigDocument } from "@codexnamer/shared";

import { parseNumberQuery } from "../lib/query.js";

export function registerAiRoutes(app: FastifyInstance, manager: CodexNamer) {
  app.get("/api/v1/auto-rename/preview", async (request) => {
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const includeCandidateNames = query.includeCandidateNames === "true" || query.includeCandidateNames === true;
    const limit = parseNumberQuery(query.limit);
    return {
      items: await manager.previewAutoRename({
        includeCandidateNames,
        limit
      })
    };
  });

  app.get("/api/v1/ai/prompt-preview", async (request) => {
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    return manager.buildPromptPreview({
      threadId: typeof query.threadId === "string" ? query.threadId : undefined
    });
  });

  app.post("/api/v1/ai/prompt-preview", async (request) => {
    const body = (request.body as { threadId?: string; userConfig?: ConfigDocument } | undefined) ?? {};
    return manager.buildPromptPreview({
      threadId: typeof body.threadId === "string" ? body.threadId : undefined,
      userConfig: body.userConfig
    });
  });

  app.get("/api/v1/ai/request-logs", async (request) => {
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    return manager.getAiRequestLogReport({
      limit: parseNumberQuery(query.pageSize ?? query.limit),
      page: parseNumberQuery(query.page),
      search: typeof query.search === "string" ? query.search : undefined,
      project: typeof query.project === "string" ? query.project : undefined,
      status:
        query.status === "running" || query.status === "succeeded" || query.status === "failed"
          ? query.status
          : undefined,
      transport:
        query.transport === "responses" || query.transport === "openai-compatible"
          ? query.transport
          : undefined
    });
  });

  app.get("/api/v1/ai/request-logs/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const detail = manager.getAiRequestLogDetail(Number(params.id));
    if (!detail) {
      return reply.status(404).send({
        error: "not_found",
        message: `Unknown request log: ${params.id}`
      });
    }
    return detail;
  });
}
