import Fastify, { type FastifyInstance } from "fastify";

import { CodexNamer } from "@codexnamer/core";
import type { ConfigDocument, SessionSummary } from "@codexnamer/shared";

import { DaemonProcessController } from "./daemon-controller.js";
import { ApiEventLog } from "./event-log.js";

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
  const status = typeof query?.status === "string" ? query.status : undefined;
  const project = normalizeSearchValue(typeof query?.project === "string" ? query.project : undefined);
  const provider = normalizeSearchValue(typeof query?.provider === "string" ? query.provider : undefined);
  const workspace = normalizeSearchValue(typeof query?.workspace === "string" ? query.workspace : undefined);
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
    if (status && item.statusEstimate !== status) {
      continue;
    }
    if (project && !item.projectName?.toLowerCase().includes(project)) {
      continue;
    }
    if (provider && !item.provider?.toLowerCase().includes(provider)) {
      continue;
    }
    if (workspace) {
      const workspaceHaystack = [item.workspaceId, item.workspaceLabel, item.cwd]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!workspaceHaystack.includes(workspace)) {
        continue;
      }
    }
    if (search) {
      const detail = options?.loadDetailText?.(item.threadId);
      const haystack = [
        item.threadId,
        item.projectName,
        item.workspaceLabel,
        item.workspaceId,
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
  manager?: CodexNamer;
  operator?: string;
}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false
  });

  const ownedManager = options?.manager
    ? undefined
    : await CodexNamer.create({ operator: options?.operator ?? "api" });
  const manager = options?.manager ?? ownedManager!;
  const eventLog = new ApiEventLog();
  const daemonController = new DaemonProcessController({
    defaultIntervalSeconds: () => manager.config.watch.scanIntervalSeconds
  });

  app.addHook("onClose", async () => {
    await daemonController.dispose();
    if (ownedManager) {
      await ownedManager.close();
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const payload = toErrorPayload(error);
    void reply.status(payload.statusCode).send(payload.body);
  });

  app.get("/api/v1/health", async () => ({
    ok: true,
    version: API_VERSION,
    time: new Date().toISOString()
  }));

  app.get("/api/v1/events/since", async (request) => {
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    return eventLog.listSince(parseNumberQuery(query.cursor) ?? 0, parseNumberQuery(query.limit));
  });

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

  app.get("/api/v1/auto-rename/preview", async (request) => {
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const includeCandidateNames = parseBooleanQuery(query.includeCandidateNames) ?? false;
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

  app.get("/api/v1/overview", async () => manager.overview());

  app.get("/api/v1/daemon", async () => daemonController.getStatus());

  app.post("/api/v1/daemon/start", async (request) => {
    const body = (request.body as { intervalSeconds?: number } | undefined) ?? {};
    return daemonController.start(body.intervalSeconds);
  });

  app.post("/api/v1/daemon/stop", async () => daemonController.stop());

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

  app.post("/api/v1/scan", async () => {
    const report = await manager.scan();
    eventLog.publish("scan.completed", report as unknown as Record<string, unknown>);
    return report;
  });

  app.get("/api/v1/providers", async () => {
    const config = await manager.printConfig();
    return {
      ai: config.ai,
      providerProfiles: config.providerProfiles,
      inheritedCodex: config.inheritedCodex,
      resolvedProvider: config.resolvedProvider,
      lastProviderTest: config.lastProviderTest
    };
  });

  app.post("/api/v1/providers/test", async (request) => {
    const body = (request.body as { userConfig?: ConfigDocument } | undefined) ?? {};
    return manager.testProvider({ userConfig: body.userConfig });
  });

  app.post("/api/v1/providers/parse-codex", async () => manager.parseCodexProviderConfig());

  app.get("/api/v1/config", async () => manager.getConfigView());

  app.put("/api/v1/config", async (request) => {
    const body = (request.body as (ConfigDocument & { userConfig?: ConfigDocument }) | undefined) ?? {};
    const patch = body.userConfig ?? body;
    const result = await manager.updateConfig(patch);
    eventLog.publish("config.updated", {
      writtenTo: result.writtenTo,
      restartRequired: result.restartRequired
    });
    return result;
  });

  app.get("/api/v1/doctor", async () => manager.doctor());

  app.get("/api/v1/maintenance/stats", async () => manager.doctor());

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

  return app;
}
