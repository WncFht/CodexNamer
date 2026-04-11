import type Database from "better-sqlite3";
import type {
  AiBackend,
  AiRequestLogDetail,
  AiRequestLogRecord,
  AiRequestLogReport,
  AiRequestStatus,
  AiRequestTransport,
  EffectiveConfig,
  RenameSuggestion
} from "@codexnamer/shared";

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : Number.isFinite(Number(value)) ? Number(value) : undefined;
}

export function startAiRequestLog(
  db: Database.Database,
  params: {
    threadId: string;
    projectName?: string;
    backend: Exclude<AiBackend, "none">;
    transport: AiRequestTransport;
    startedAt: string;
    baseUrl?: string;
    model?: string;
    promptChars?: number;
    promptText?: string;
    requestPayload?: Record<string, unknown>;
    metadata?: Record<string, string>;
  }
): number {
  const result = db
    .prepare(
      `INSERT INTO ai_request_logs (
        thread_id, project_name, backend, transport, status, started_at, base_url, model, prompt_chars, prompt_text,
        request_payload_json, metadata_json
      ) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.threadId,
      params.projectName ?? null,
      params.backend,
      params.transport,
      params.startedAt,
      params.baseUrl ?? null,
      params.model ?? null,
      params.promptChars ?? null,
      params.promptText ?? null,
      params.requestPayload ? JSON.stringify(params.requestPayload) : null,
      params.metadata ? JSON.stringify(params.metadata) : null
    );

  return Number(result.lastInsertRowid);
}

export function finishAiRequestLog(
  db: Database.Database,
  params: {
    id: number;
    status: Exclude<AiRequestStatus, "running">;
    finishedAt: string;
    durationMs: number;
    responseChars?: number;
    responseText?: string;
    responsePayload?: Record<string, unknown>;
    result?: {
      parsedModelOutput?: Record<string, unknown>;
      finalSuggestion?: RenameSuggestion;
      composition?: {
        mode: EffectiveConfig["naming"]["compositionMode"];
        builder: EffectiveConfig["naming"]["builder"];
        explicitName?: string;
        tagLabel?: string;
        finalName: string;
      };
    };
    error?: string;
    metadata?: Record<string, string>;
  }
): void {
  const previous = db.prepare(`SELECT metadata_json FROM ai_request_logs WHERE id = ?`).get(params.id) as
    | Record<string, unknown>
    | undefined;
  const previousMetadata =
    typeof previous?.metadata_json === "string" && previous.metadata_json
      ? (JSON.parse(previous.metadata_json) as Record<string, string>)
      : {};
  const mergedMetadata = {
    ...previousMetadata,
    ...(params.metadata ?? {})
  };

  db.prepare(
    `UPDATE ai_request_logs
       SET status = ?, finished_at = ?, duration_ms = ?, response_chars = ?, response_text = ?, response_payload_json = ?,
           result_json = ?, error = ?, metadata_json = ?
     WHERE id = ?`
  ).run(
    params.status,
    params.finishedAt,
    Math.max(0, Math.trunc(params.durationMs)),
    params.responseChars ?? null,
    params.responseText ?? null,
    params.responsePayload ? JSON.stringify(params.responsePayload) : null,
    params.result ? JSON.stringify(params.result) : null,
    params.error ?? null,
    Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null,
    params.id
  );
}

export function getAiRequestLogReport(
  db: Database.Database,
  options?: {
    limit?: number;
    page?: number;
    search?: string;
    project?: string;
    status?: AiRequestStatus;
    transport?: AiRequestTransport;
  }
): AiRequestLogReport {
  const limit = Math.max(1, Math.trunc(options?.limit ?? 40));
  const page = Math.max(1, Math.trunc(options?.page ?? 1));
  const offset = (page - 1) * limit;
  const whereClauses: string[] = [];
  const whereParams: unknown[] = [];
  const facetClauses: string[] = [];
  const facetParams: unknown[] = [];

  const search = options?.search?.trim().toLowerCase();
  if (search) {
    const pattern = `%${search}%`;
    const searchClause = `LOWER(COALESCE(project_name, '') || ' ' || thread_id || ' ' || COALESCE(model, '') || ' ' || backend || ' ' || transport || ' ' || COALESCE(base_url, '') || ' ' || COALESCE(error, '') || ' ' || COALESCE(metadata_json, '')) LIKE ?`;
    whereClauses.push(searchClause);
    whereParams.push(pattern);
    facetClauses.push(searchClause);
    facetParams.push(pattern);
  }

  if (options?.project) {
    if (options.project === "__none__") {
      whereClauses.push(`COALESCE(NULLIF(TRIM(project_name), ''), '__none__') = '__none__'`);
    } else {
      whereClauses.push(`project_name = ?`);
      whereParams.push(options.project);
    }
  }

  if (options?.status) {
    whereClauses.push(`status = ?`);
    whereParams.push(options.status);
    facetClauses.push(`status = ?`);
    facetParams.push(options.status);
  }

  if (options?.transport) {
    whereClauses.push(`transport = ?`);
    whereParams.push(options.transport);
    facetClauses.push(`transport = ?`);
    facetParams.push(options.transport);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const facetWhereSql = facetClauses.length > 0 ? `WHERE ${facetClauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT id, thread_id, project_name, backend, transport, status, started_at, finished_at, duration_ms,
              base_url, model, prompt_chars, response_chars, result_json, error, metadata_json
       FROM ai_request_logs
       ${whereSql}
       ORDER BY started_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...whereParams, limit, offset) as Array<Record<string, unknown>>;
  const total = Number(
    ((db.prepare(`SELECT COUNT(*) AS count FROM ai_request_logs ${whereSql}`).get(...whereParams) as Record<string, unknown>).count ?? 0)
  );
  const statusCountsRow = db
    .prepare(
      `SELECT
          SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
          SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM ai_request_logs
       ${whereSql}`
    )
    .get(...whereParams) as Record<string, unknown>;
  const projectRows = db
    .prepare(
      `SELECT DISTINCT COALESCE(NULLIF(TRIM(project_name), ''), '') AS project_name
       FROM ai_request_logs
       ${facetWhereSql}
       ORDER BY project_name COLLATE NOCASE ASC`
    )
    .all(...facetParams) as Array<Record<string, unknown>>;
  const activeCount = Number((db.prepare(`SELECT COUNT(*) AS count FROM ai_request_logs WHERE status = 'running'`).get() as Record<string, unknown>).count ?? 0);
  const lastFinishedAt = (
    db.prepare(`SELECT finished_at FROM ai_request_logs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, id DESC LIMIT 1`).get() as
      | Record<string, unknown>
      | undefined
  )?.finished_at as string | undefined;

  return {
    activeCount,
    lastFinishedAt,
    total,
    page,
    pageSize: limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    statusCounts: {
      running: Number(statusCountsRow.running ?? 0),
      succeeded: Number(statusCountsRow.succeeded ?? 0),
      failed: Number(statusCountsRow.failed ?? 0)
    },
    projects: projectRows.map((row) => ((row.project_name as string | null) ?? "")),
    items: rows.map((row) => ({
      id: Number(row.id ?? 0),
      threadId: (row.thread_id as string | null) ?? "",
      projectName: (row.project_name as string | null) ?? undefined,
      backend: row.backend as AiRequestLogRecord["backend"],
      transport: row.transport as AiRequestTransport,
      status: row.status as AiRequestStatus,
      startedAt: (row.started_at as string | null) ?? "",
      finishedAt: (row.finished_at as string | null) ?? undefined,
      durationMs: toOptionalNumber(row.duration_ms),
      baseUrl: (row.base_url as string | null) ?? undefined,
      model: (row.model as string | null) ?? undefined,
      promptChars: toOptionalNumber(row.prompt_chars),
      responseChars: toOptionalNumber(row.response_chars),
      finalName:
        typeof row.result_json === "string" && row.result_json
          ? (((JSON.parse(row.result_json) as AiRequestLogDetail["result"])?.composition?.finalName as string | undefined) ?? undefined)
          : undefined,
      error: (row.error as string | null) ?? undefined,
      metadata:
        typeof row.metadata_json === "string" && row.metadata_json
          ? (JSON.parse(row.metadata_json) as Record<string, string>)
          : undefined
    }))
  };
}

export function getAiRequestLogDetail(db: Database.Database, id: number): AiRequestLogDetail | undefined {
  const row = db
    .prepare(
      `SELECT id, thread_id, project_name, backend, transport, status, started_at, finished_at, duration_ms,
              base_url, model, prompt_chars, prompt_text, request_payload_json, response_chars, response_text,
              response_payload_json, result_json, error, metadata_json
       FROM ai_request_logs
       WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) {
    return undefined;
  }

  const result =
    typeof row.result_json === "string" && row.result_json
      ? (JSON.parse(row.result_json) as AiRequestLogDetail["result"])
      : undefined;

  return {
    id: Number(row.id ?? 0),
    threadId: (row.thread_id as string | null) ?? "",
    projectName: (row.project_name as string | null) ?? undefined,
    backend: row.backend as AiRequestLogRecord["backend"],
    transport: row.transport as AiRequestTransport,
    status: row.status as AiRequestStatus,
    startedAt: (row.started_at as string | null) ?? "",
    finishedAt: (row.finished_at as string | null) ?? undefined,
    durationMs: toOptionalNumber(row.duration_ms),
    baseUrl: (row.base_url as string | null) ?? undefined,
    model: (row.model as string | null) ?? undefined,
    promptChars: toOptionalNumber(row.prompt_chars),
    promptText: (row.prompt_text as string | null) ?? undefined,
    requestPayload:
      typeof row.request_payload_json === "string" && row.request_payload_json
        ? (JSON.parse(row.request_payload_json) as Record<string, unknown>)
        : undefined,
    responseChars: toOptionalNumber(row.response_chars),
    finalName: result?.composition?.finalName ?? undefined,
    responseText: (row.response_text as string | null) ?? undefined,
    responsePayload:
      typeof row.response_payload_json === "string" && row.response_payload_json
        ? (JSON.parse(row.response_payload_json) as Record<string, unknown>)
        : undefined,
    result,
    error: (row.error as string | null) ?? undefined,
    metadata:
      typeof row.metadata_json === "string" && row.metadata_json
        ? (JSON.parse(row.metadata_json) as Record<string, string>)
        : undefined
  };
}
