import type {
  AiRequestLogResponse,
  AutoRenamePreviewResponse,
  ApiEventsResponse,
  ConfigDocument,
  ConfigUpdateResponse,
  ConfigView,
  DoctorResponse,
  OverviewResponse,
  PromptPreviewResponse,
  ProviderResponse,
  RenameApplyResponse,
  RenameFreezeResponse,
  RenameNamingStyleResponse,
  RenameManualOverrideResponse,
  RenameReplayResult,
  RenameSuggestResponse,
  SessionDetail,
  SessionTranscriptPage,
  SessionsResponse
} from "./types.js";

const inflightJsonRequests = new Map<string, Promise<unknown>>();

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const url = typeof input === "string" ? input : input.url;
  const dedupeKey = method === "GET" ? `${method}:${url}` : null;

  if (dedupeKey) {
    const existing = inflightJsonRequests.get(dedupeKey) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }
  }

  const requestPromise = (async () => {
    const headers = new Headers(init?.headers);
    if (init?.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(input, {
      ...init,
      headers,
      cache: init?.cache ?? "no-store"
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  })();

  if (!dedupeKey) {
    return requestPromise;
  }

  const trackedPromise = requestPromise.finally(() => {
    if (inflightJsonRequests.get(dedupeKey) === trackedPromise) {
      inflightJsonRequests.delete(dedupeKey);
    }
  });
  inflightJsonRequests.set(dedupeKey, trackedPromise);
  return trackedPromise as Promise<T>;
}

export async function fetchSessions(params: {
  search?: string;
  dirtyOnly?: boolean;
  workspace?: string;
}): Promise<SessionsResponse> {
  const url = new URL("/api/v1/sessions", window.location.origin);
  if (params.search) {
    url.searchParams.set("search", params.search);
  }
  if (params.dirtyOnly) {
    url.searchParams.set("dirty", "true");
  }
  if (params.workspace) {
    url.searchParams.set("workspace", params.workspace);
  }
  return requestJson<SessionsResponse>(url.toString());
}

export async function fetchSessionDetail(threadId: string): Promise<SessionDetail> {
  return requestJson<SessionDetail>(`/api/v1/sessions/${threadId}`);
}

export async function fetchSessionTranscript(
  threadId: string,
  params?: {
    page?: number;
    pageSize?: number;
    includeHidden?: boolean;
    role?: "all" | "user" | "assistant" | "tool" | "system";
    query?: string;
  }
): Promise<SessionTranscriptPage> {
  const url = new URL(`/api/v1/sessions/${threadId}/transcript`, window.location.origin);
  if (params?.page) {
    url.searchParams.set("page", String(params.page));
  }
  if (params?.pageSize) {
    url.searchParams.set("pageSize", String(params.pageSize));
  }
  if (params?.includeHidden) {
    url.searchParams.set("includeHidden", "true");
  }
  if (params?.role && params.role !== "all") {
    url.searchParams.set("role", params.role);
  }
  if (params?.query) {
    url.searchParams.set("query", params.query);
  }
  return requestJson<SessionTranscriptPage>(url.toString());
}

export async function suggestSession(threadId: string): Promise<RenameSuggestResponse> {
  return requestJson<RenameSuggestResponse>(`/api/v1/sessions/${threadId}/suggest`, {
    method: "POST"
  });
}

export async function applySession(threadId: string): Promise<RenameApplyResponse> {
  return requestJson<RenameApplyResponse>(`/api/v1/sessions/${threadId}/apply`, {
    method: "POST"
  });
}

export async function setSessionNamingStyle(
  threadId: string,
  style: "brief" | "detailed" | "default"
): Promise<RenameNamingStyleResponse> {
  return requestJson<RenameNamingStyleResponse>(`/api/v1/sessions/${threadId}/naming-style`, {
    method: "POST",
    body: JSON.stringify({
      style: style === "default" ? null : style
    })
  });
}

export async function freezeSession(threadId: string, frozen: boolean): Promise<RenameFreezeResponse> {
  return requestJson<RenameFreezeResponse>(`/api/v1/sessions/${threadId}/${frozen ? "freeze" : "unfreeze"}`, {
    method: "POST"
  });
}

export async function toggleManualOverride(
  threadId: string,
  enabled: boolean
): Promise<RenameManualOverrideResponse> {
  return requestJson<RenameManualOverrideResponse>(
    `/api/v1/sessions/${threadId}/${enabled ? "manual-override" : "clear-manual-override"}`,
    {
      method: "POST"
    }
  );
}

export async function fetchProviders(): Promise<ProviderResponse> {
  return requestJson<ProviderResponse>("/api/v1/providers");
}

export async function fetchConfig(): Promise<ConfigView> {
  return requestJson<ConfigView>("/api/v1/config");
}

export async function updateConfig(userConfig: ConfigDocument): Promise<ConfigUpdateResponse> {
  return requestJson<ConfigUpdateResponse>("/api/v1/config", {
    method: "PUT",
    body: JSON.stringify({ userConfig })
  });
}

export async function fetchDoctor(): Promise<DoctorResponse> {
  return requestJson<DoctorResponse>("/api/v1/doctor");
}

export async function fetchOverview(): Promise<OverviewResponse> {
  return requestJson<OverviewResponse>("/api/v1/overview");
}

export async function fetchAutoRenamePreview(params?: {
  includeCandidateNames?: boolean;
  limit?: number;
}): Promise<AutoRenamePreviewResponse> {
  const url = new URL("/api/v1/auto-rename/preview", window.location.origin);
  if (params?.includeCandidateNames) {
    url.searchParams.set("includeCandidateNames", "true");
  }
  if (params?.limit && params.limit > 0) {
    url.searchParams.set("limit", String(params.limit));
  }
  return requestJson<AutoRenamePreviewResponse>(url.toString());
}

export async function fetchPromptPreview(threadId?: string): Promise<PromptPreviewResponse> {
  const url = new URL("/api/v1/ai/prompt-preview", window.location.origin);
  if (threadId) {
    url.searchParams.set("threadId", threadId);
  }
  return requestJson<PromptPreviewResponse>(url.toString());
}

export async function fetchAiRequestLogs(limit = 40): Promise<AiRequestLogResponse> {
  const url = new URL("/api/v1/ai/request-logs", window.location.origin);
  if (limit > 0) {
    url.searchParams.set("limit", String(limit));
  }
  return requestJson<AiRequestLogResponse>(url.toString());
}

export async function requeueRenamesSince(params: {
  since: string;
  basis: "session-updated-at" | "last-applied-at";
}): Promise<RenameReplayResult> {
  return requestJson<RenameReplayResult>("/api/v1/maintenance/requeue-renames", {
    method: "POST",
    body: JSON.stringify(params)
  });
}

export async function fetchEvents(cursor: number): Promise<ApiEventsResponse> {
  const url = new URL("/api/v1/events/since", window.location.origin);
  url.searchParams.set("cursor", String(cursor));
  return requestJson<ApiEventsResponse>(url.toString());
}
