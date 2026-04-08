import type {
  AiRequestLogDetailResponse,
  AiRequestLogResponse,
  ApiEventsResponse,
  AutoRenamePreviewResponse,
  BatchApplyResponse,
  ConfigDocument,
  ConfigUpdateResponse,
  ConfigView,
  DaemonControlStatus,
  DoctorResponse,
  OverviewResponse,
  ParseCodexProviderResponse,
  PromptPreviewResponse,
  ProviderResponse,
  ProviderTestResponse,
  RenameApplyResponse,
  RenameFreezeResponse,
  RenameReplayResult,
  RenameSuggestResponse,
  SessionDetail,
  SessionTranscriptPage,
  SessionsResponse
} from "./types.js";

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(input, {
    ...init,
    headers
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export class LocalApiClient {
  constructor(private readonly baseUrl: string) {}

  private resolve(pathname: string): string {
    return new URL(pathname, this.baseUrl).toString();
  }

  listSessions(params: { dirtyOnly: boolean; search?: string; limit?: number; workspace?: string }): Promise<SessionsResponse> {
    const url = new URL(this.resolve("/api/v1/sessions"));
    if (params.dirtyOnly) {
      url.searchParams.set("dirty", "true");
    }
    if (params.search) {
      url.searchParams.set("search", params.search);
    }
    if (params.limit) {
      url.searchParams.set("limit", String(params.limit));
    }
    if (params.workspace) {
      url.searchParams.set("workspace", params.workspace);
    }
    return requestJson<SessionsResponse>(url.toString());
  }

  getSession(threadId: string): Promise<SessionDetail> {
    return requestJson<SessionDetail>(this.resolve(`/api/v1/sessions/${threadId}`));
  }

  getSessionTranscript(
    threadId: string,
    params?: {
      page?: number;
      pageSize?: number;
      includeHidden?: boolean;
      role?: "all" | "user" | "assistant" | "tool" | "system";
      query?: string;
    }
  ): Promise<SessionTranscriptPage> {
    const url = new URL(this.resolve(`/api/v1/sessions/${threadId}/transcript`));
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

  suggest(threadId: string): Promise<RenameSuggestResponse> {
    return requestJson<RenameSuggestResponse>(this.resolve(`/api/v1/sessions/${threadId}/suggest`), {
      method: "POST"
    });
  }

  apply(threadId: string): Promise<RenameApplyResponse> {
    return requestJson<RenameApplyResponse>(this.resolve(`/api/v1/sessions/${threadId}/apply`), {
      method: "POST"
    });
  }

  rename(threadId: string, name: string): Promise<unknown> {
    return requestJson(this.resolve(`/api/v1/sessions/${threadId}/rename`), {
      method: "POST",
      body: JSON.stringify({ name })
    });
  }

  freeze(threadId: string, frozen: boolean): Promise<RenameFreezeResponse> {
    return requestJson<RenameFreezeResponse>(this.resolve(`/api/v1/sessions/${threadId}/${frozen ? "freeze" : "unfreeze"}`), {
      method: "POST"
    });
  }

  batchApplyDirty(previewOnly: boolean): Promise<BatchApplyResponse> {
    return requestJson<BatchApplyResponse>(this.resolve("/api/v1/sessions/batch/apply"), {
      method: "POST",
      body: JSON.stringify({
        filter: {
          dirty: true
        },
        previewOnly
      })
    });
  }

  getAutoRenamePreview(params?: {
    includeCandidateNames?: boolean;
    limit?: number;
  }): Promise<AutoRenamePreviewResponse> {
    const url = new URL(this.resolve("/api/v1/auto-rename/preview"));
    if (params?.includeCandidateNames) {
      url.searchParams.set("includeCandidateNames", "true");
    }
    if (params?.limit) {
      url.searchParams.set("limit", String(params.limit));
    }
    return requestJson<AutoRenamePreviewResponse>(url.toString());
  }

  getPromptPreview(threadId?: string, userConfig?: ConfigDocument): Promise<PromptPreviewResponse> {
    if (userConfig) {
      return requestJson<PromptPreviewResponse>(this.resolve("/api/v1/ai/prompt-preview"), {
        method: "POST",
        body: JSON.stringify({
          threadId,
          userConfig
        })
      });
    }
    const url = new URL(this.resolve("/api/v1/ai/prompt-preview"));
    if (threadId) {
      url.searchParams.set("threadId", threadId);
    }
    return requestJson<PromptPreviewResponse>(url.toString());
  }

  getConfig(): Promise<ConfigView> {
    return requestJson<ConfigView>(this.resolve("/api/v1/config"));
  }

  updateConfig(userConfig: ConfigDocument): Promise<ConfigUpdateResponse> {
    return requestJson<ConfigUpdateResponse>(this.resolve("/api/v1/config"), {
      method: "PUT",
      body: JSON.stringify({ userConfig })
    });
  }

  getProviders(): Promise<ProviderResponse> {
    return requestJson<ProviderResponse>(this.resolve("/api/v1/providers"));
  }

  getDoctor(): Promise<DoctorResponse> {
    return requestJson<DoctorResponse>(this.resolve("/api/v1/doctor"));
  }

  getOverview(): Promise<OverviewResponse> {
    return requestJson<OverviewResponse>(this.resolve("/api/v1/overview"));
  }

  getDaemonStatus(): Promise<DaemonControlStatus> {
    return requestJson<DaemonControlStatus>(this.resolve("/api/v1/daemon"));
  }

  startDaemon(intervalSeconds?: number): Promise<DaemonControlStatus> {
    return requestJson<DaemonControlStatus>(this.resolve("/api/v1/daemon/start"), {
      method: "POST",
      body: JSON.stringify(typeof intervalSeconds === "number" ? { intervalSeconds } : {})
    });
  }

  stopDaemon(): Promise<DaemonControlStatus> {
    return requestJson<DaemonControlStatus>(this.resolve("/api/v1/daemon/stop"), {
      method: "POST"
    });
  }

  getAiRequestLogs(params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    project?: string;
    status?: "running" | "succeeded" | "failed";
    transport?: "responses" | "openai-compatible";
  }): Promise<AiRequestLogResponse> {
    const url = new URL(this.resolve("/api/v1/ai/request-logs"));
    const pageSize = params?.pageSize ?? 20;
    if (pageSize > 0) {
      url.searchParams.set("pageSize", String(pageSize));
    }
    if ((params?.page ?? 1) > 1) {
      url.searchParams.set("page", String(params?.page));
    }
    if (params?.search) {
      url.searchParams.set("search", params.search);
    }
    if (params?.project) {
      url.searchParams.set("project", params.project);
    }
    if (params?.status) {
      url.searchParams.set("status", params.status);
    }
    if (params?.transport) {
      url.searchParams.set("transport", params.transport);
    }
    return requestJson<AiRequestLogResponse>(url.toString());
  }

  getAiRequestLogDetail(id: number): Promise<AiRequestLogDetailResponse> {
    return requestJson<AiRequestLogDetailResponse>(this.resolve(`/api/v1/ai/request-logs/${id}`));
  }

  testProvider(userConfig?: ConfigDocument): Promise<ProviderTestResponse> {
    return requestJson<ProviderTestResponse>(this.resolve("/api/v1/providers/test"), {
      method: "POST",
      body: JSON.stringify(userConfig ? { userConfig } : {})
    });
  }

  parseCodexProvider(): Promise<ParseCodexProviderResponse> {
    return requestJson<ParseCodexProviderResponse>(this.resolve("/api/v1/providers/parse-codex"), {
      method: "POST"
    });
  }

  requeueRenamesSince(params: {
    since: string;
    basis: "session-updated-at" | "last-applied-at";
  }): Promise<RenameReplayResult> {
    return requestJson<RenameReplayResult>(this.resolve("/api/v1/maintenance/requeue-renames"), {
      method: "POST",
      body: JSON.stringify(params)
    });
  }

  getEvents(cursor: number): Promise<ApiEventsResponse> {
    const url = new URL(this.resolve("/api/v1/events/since"));
    url.searchParams.set("cursor", String(cursor));
    return requestJson<ApiEventsResponse>(url.toString());
  }
}
