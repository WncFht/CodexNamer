import type { CodexNamer } from "@codexnamer/core";
import { aiRequestLogQuerySchema, promptPreviewRequestSchema } from "@codexnamer/shared";
import type { FastifyInstance } from "fastify";

import { parseNumberQuery } from "../lib/query.js";

export function registerAiRoutes(app: FastifyInstance, manager: CodexNamer) {
  app.get("/api/v1/auto-rename/preview", async (request) => {
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const includeCandidateNames =
      query.includeCandidateNames === "true" || query.includeCandidateNames === true;
    const limit = parseNumberQuery(query.limit);
    return {
      items: await manager.previewAutoRename({
        includeCandidateNames,
        limit,
      }),
    };
  });

  app.get("/api/v1/ai/prompt-preview", async (request) => {
    const query = promptPreviewRequestSchema.parse(
      (request.query as Record<string, unknown> | undefined) ?? {},
    );
    return manager.buildPromptPreview({
      threadId: query.threadId,
    });
  });

  app.post("/api/v1/ai/prompt-preview", async (request) => {
    const body = promptPreviewRequestSchema.parse(
      (request.body as Record<string, unknown> | undefined) ?? {},
    );
    return manager.buildPromptPreview({
      threadId: body.threadId,
      userConfig: body.userConfig,
    });
  });

  app.get("/api/v1/ai/request-logs", async (request) => {
    const query = aiRequestLogQuerySchema.parse(
      (request.query as Record<string, unknown> | undefined) ?? {},
    );
    return manager.getAiRequestLogReport({
      limit: query.pageSize ?? query.limit,
      page: query.page,
      search: query.search,
      project: query.project,
      status: query.status,
      transport: query.transport,
    });
  });

  app.get("/api/v1/ai/request-logs/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const detail = manager.getAiRequestLogDetail(Number(params.id));
    if (!detail) {
      return reply.status(404).send({
        error: "not_found",
        message: `Unknown request log: ${params.id}`,
      });
    }
    return detail;
  });
}
