import type { BatchApplyResponse, SessionDetail, SessionsResponse } from "./types.js";

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
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
}
