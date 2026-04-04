import Fastify, { type FastifyInstance } from "fastify";

import { CodexSessionManager } from "@codex-session-manager/core";

const API_VERSION = "0.1.0";

function parseBooleanQuery(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }

  return undefined;
}

function toErrorPayload(error: unknown): { statusCode: number; body: Record<string, unknown> } {
  if (error instanceof Error) {
    if (error.message.startsWith("Unknown session:")) {
      return {
        statusCode: 404,
        body: {
          error: "not_found",
          message: error.message
        }
      };
    }

    return {
      statusCode: 400,
      body: {
        error: "request_failed",
        message: error.message
      }
    };
  }

  return {
    statusCode: 500,
    body: {
      error: "internal_error",
      message: "Unknown error"
    }
  };
}

export async function buildApiServer(options?: {
  manager?: CodexSessionManager;
  operator?: string;
}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false
  });

  const ownedManager = options?.manager
    ? undefined
    : await CodexSessionManager.create({ operator: options?.operator ?? "api" });
  const manager = options?.manager ?? ownedManager!;

  if (ownedManager) {
    app.addHook("onClose", async () => {
      await ownedManager.close();
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    const payload = toErrorPayload(error);
    void reply.status(payload.statusCode).send(payload.body);
  });

  app.get("/api/v1/health", async () => ({
    ok: true,
    version: API_VERSION,
    time: new Date().toISOString()
  }));

  app.get("/api/v1/sessions", async (request) => {
    const dirty = parseBooleanQuery((request.query as Record<string, unknown> | undefined)?.dirty);
    const allSessions = await manager.listSessions();
    const items = dirty === undefined ? allSessions : allSessions.filter((item) => item.dirty === dirty);

    return {
      items,
      total: items.length,
      counts: {
        dirty: allSessions.filter((item) => item.dirty).length,
        frozen: allSessions.filter((item) => item.frozen).length,
        manualOverride: allSessions.filter((item) => item.manualOverride).length
      },
      nextCursor: null
    };
  });

  app.get("/api/v1/sessions/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const detail = await manager.getSessionDetail(params.id);
    if (!detail) {
      return reply.status(404).send({
        error: "not_found",
        message: `Unknown session: ${params.id}`
      });
    }
    return detail;
  });

  app.get("/api/v1/sessions/:id/history", async (request) => {
    const params = request.params as { id: string };
    return manager.getRenameHistory(params.id);
  });

  app.post("/api/v1/sessions/:id/suggest", async (request) => {
    const params = request.params as { id: string };
    return manager.suggest(params.id);
  });

  app.post("/api/v1/sessions/:id/apply", async (request) => {
    const params = request.params as { id: string };
    return manager.apply(params.id);
  });

  app.post("/api/v1/sessions/:id/rename", async (request) => {
    const params = request.params as { id: string };
    const body = (request.body as { name?: string } | undefined) ?? {};
    if (!body.name?.trim()) {
      throw new Error("name is required");
    }
    return manager.rename(params.id, body.name);
  });

  app.post("/api/v1/sessions/:id/freeze", async (request) => {
    const params = request.params as { id: string };
    await manager.freeze(params.id);
    return { threadId: params.id, frozen: true };
  });

  app.post("/api/v1/sessions/:id/unfreeze", async (request) => {
    const params = request.params as { id: string };
    await manager.unfreeze(params.id);
    return { threadId: params.id, frozen: false };
  });

  app.post("/api/v1/sessions/:id/manual-override", async (request) => {
    const params = request.params as { id: string };
    await manager.setManualOverride(params.id);
    return { threadId: params.id, manualOverride: true };
  });

  app.post("/api/v1/sessions/:id/clear-manual-override", async (request) => {
    const params = request.params as { id: string };
    await manager.clearManualOverride(params.id);
    return { threadId: params.id, manualOverride: false };
  });

  app.post("/api/v1/sessions/batch/suggest", async () => ({
    items: await manager.batchApplyDirty({ previewOnly: true })
  }));

  app.post("/api/v1/sessions/batch/apply", async (request) => {
    const body = (request.body as { filter?: { dirty?: boolean }; previewOnly?: boolean } | undefined) ?? {};
    if (body.filter?.dirty === false) {
      throw new Error("Only dirty batch processing is supported in v1.");
    }
    return {
      items: await manager.batchApplyDirty({ previewOnly: body.previewOnly ?? false })
    };
  });

  app.post("/api/v1/scan", async () => manager.scan());

  app.get("/api/v1/providers", async () => {
    const config = await manager.printConfig();
    return {
      ai: config.ai,
      providerProfiles: config.providerProfiles,
      inheritedCodex: config.inheritedCodex,
      resolvedProvider: config.resolvedProvider
    };
  });

  app.post("/api/v1/providers/test", async (request) => {
    const body = (request.body as { threadId?: string } | undefined) ?? {};
    return manager.testProvider({ threadId: body.threadId });
  });

  app.get("/api/v1/config", async () => manager.printConfig());

  app.get("/api/v1/doctor", async () => manager.doctor());

  app.get("/api/v1/maintenance/stats", async () => manager.doctor());

  app.post("/api/v1/maintenance/compact-index", async (request) => {
    const body = (request.body as { dryRun?: boolean } | undefined) ?? {};
    return manager.compactIndex({ dryRun: body.dryRun ?? true });
  });

  return app;
}
