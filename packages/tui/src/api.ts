import type {
  BatchApplyResponse,
  ConfigDocument,
  ConfigUpdateResponse,
  ConfigView,
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

  listSessions(params: { dirtyOnly: boolean; search?: string; limit?: number }): Promise<SessionsResponse> {
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
    return requestJson<SessionTranscriptPage>(url.toString());
  }

  suggest(threadId: string): Promise<unknown> {
    return requestJson(this.resolve(`/api/v1/sessions/${threadId}/suggest`), {
      method: "POST"
    });
  }

  apply(threadId: string): Promise<unknown> {
    return requestJson(this.resolve(`/api/v1/sessions/${threadId}/apply`), {
      method: "POST"
    });
  }

  rename(threadId: string, name: string): Promise<unknown> {
    return requestJson(this.resolve(`/api/v1/sessions/${threadId}/rename`), {
      method: "POST",
      body: JSON.stringify({ name })
    });
  }

  freeze(threadId: string, frozen: boolean): Promise<unknown> {
    return requestJson(this.resolve(`/api/v1/sessions/${threadId}/${frozen ? "freeze" : "unfreeze"}`), {
      method: "POST"
    });
  }

  setManualOverride(threadId: string, enabled: boolean): Promise<unknown> {
    return requestJson(
      this.resolve(
        `/api/v1/sessions/${threadId}/${enabled ? "manual-override" : "clear-manual-override"}`
      ),
      {
        method: "POST"
      }
    );
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

  getConfig(): Promise<ConfigView> {
    return requestJson<ConfigView>(this.resolve("/api/v1/config"));
  }

  updateConfig(userConfig: ConfigDocument): Promise<ConfigUpdateResponse> {
    return requestJson<ConfigUpdateResponse>(this.resolve("/api/v1/config"), {
      method: "PUT",
      body: JSON.stringify({ userConfig })
    });
  }
}
