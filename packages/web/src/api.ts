import type {
  AutoRenamePreviewResponse,
  ApiEventsResponse,
  DoctorResponse,
  ProviderResponse,
  SessionDetail,
  SessionsResponse
} from "./types.js";

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
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

export async function fetchSessions(params: {
  search?: string;
  dirtyOnly?: boolean;
}): Promise<SessionsResponse> {
  const url = new URL("/api/v1/sessions", window.location.origin);
  if (params.search) {
    url.searchParams.set("search", params.search);
  }
  if (params.dirtyOnly) {
    url.searchParams.set("dirty", "true");
  }
  return requestJson<SessionsResponse>(url.toString());
}

export async function fetchSessionDetail(threadId: string): Promise<SessionDetail> {
  return requestJson<SessionDetail>(`/api/v1/sessions/${threadId}`);
}

export async function suggestSession(threadId: string): Promise<void> {
  await requestJson(`/api/v1/sessions/${threadId}/suggest`, {
    method: "POST"
  });
}

export async function applySession(threadId: string): Promise<void> {
  await requestJson(`/api/v1/sessions/${threadId}/apply`, {
    method: "POST"
  });
}

export async function freezeSession(threadId: string, frozen: boolean): Promise<void> {
  await requestJson(`/api/v1/sessions/${threadId}/${frozen ? "freeze" : "unfreeze"}`, {
    method: "POST"
  });
}

export async function toggleManualOverride(threadId: string, enabled: boolean): Promise<void> {
  await requestJson(
    `/api/v1/sessions/${threadId}/${enabled ? "manual-override" : "clear-manual-override"}`,
    {
      method: "POST"
    }
  );
}

export async function fetchProviders(): Promise<ProviderResponse> {
  return requestJson<ProviderResponse>("/api/v1/providers");
}

export async function fetchDoctor(): Promise<DoctorResponse> {
  return requestJson<DoctorResponse>("/api/v1/doctor");
}

export async function fetchAutoRenamePreview(): Promise<AutoRenamePreviewResponse> {
  return requestJson<AutoRenamePreviewResponse>("/api/v1/auto-rename/preview");
}

export async function fetchEvents(cursor: number): Promise<ApiEventsResponse> {
  const url = new URL("/api/v1/events/since", window.location.origin);
  url.searchParams.set("cursor", String(cursor));
  return requestJson<ApiEventsResponse>(url.toString());
}
