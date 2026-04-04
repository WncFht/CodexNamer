import Fastify, { type FastifyInstance } from "fastify";

import { CodexSessionManager } from "@codex-session-manager/core";
import type { SessionSummary } from "@codex-session-manager/shared";

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

function parseNumberQuery(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeSearchValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

async function filterAndSortSessions(
  sessions: SessionSummary[],
  query: Record<string, unknown> | undefined,
  options?: {
    loadDetailText?: (threadId: string) => {
      firstUserMessage?: string;
      lastUserMessage?: string;
      lastAgentMessage?: string;
    } | undefined;
  }
): Promise<SessionSummary[]> {
  const dirty = parseBooleanQuery(query?.dirty);
  const frozen = parseBooleanQuery(query?.frozen);
  const manualOverride = parseBooleanQuery(query?.manualOverride);
  const status = typeof query?.status === "string" ? query.status : undefined;
  const project = normalizeSearchValue(typeof query?.project === "string" ? query.project : undefined);
  const provider = normalizeSearchValue(typeof query?.provider === "string" ? query.provider : undefined);
  const search = normalizeSearchValue(typeof query?.search === "string" ? query.search : undefined);
  const sort = typeof query?.sort === "string" ? query.sort : "updatedAt";
  const order = query?.order === "asc" ? "asc" : "desc";
  const limit = parseNumberQuery(query?.limit);

  const filtered: SessionSummary[] = [];
  for (const item of sessions) {
    if (dirty !== undefined && item.dirty !== dirty) {
      continue;
    }
    if (frozen !== undefined && item.frozen !== frozen) {
      continue;
    }
    if (manualOverride !== undefined && item.manualOverride !== manualOverride) {
      continue;
    }
    if (status && item.statusEstimate !== status) {
      continue;
    }
    if (project && !item.projectName?.toLowerCase().includes(project)) {
      continue;
    }
    if (provider && !item.provider?.toLowerCase().includes(provider)) {
      continue;
    }
    if (search) {
      const detail = options?.loadDetailText?.(item.threadId);
      const haystack = [
        item.threadId,
        item.projectName,
        item.officialName,
        item.candidateName,
        item.provider,
        item.model,
        item.statusEstimate,
        detail?.firstUserMessage,
        detail?.lastUserMessage,
        detail?.lastAgentMessage
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) {
        continue;
      }
    }
    filtered.push(item);
  }

  const sorted = filtered.sort((left, right) => {
    const leftValue =
      sort === "project"
        ? left.projectName ?? ""
        : sort === "officialName"
          ? left.officialName ?? ""
          : left.updatedAt ?? "";
    const rightValue =
      sort === "project"
        ? right.projectName ?? ""
        : sort === "officialName"
          ? right.officialName ?? ""
          : right.updatedAt ?? "";

    const compare = String(leftValue).localeCompare(String(rightValue));
    return order === "asc" ? compare : -compare;
  });

  return limit && limit > 0 ? sorted.slice(0, limit) : sorted;
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
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const allSessions = await manager.listSessions();
    const items = await filterAndSortSessions(allSessions, query, {
      loadDetailText: (threadId) => manager.db.getSessionDetail(threadId)
    });

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

  app.get("/api/v1/auto-rename/preview", async () => ({
    items: await manager.previewAutoRename()
  }));

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
