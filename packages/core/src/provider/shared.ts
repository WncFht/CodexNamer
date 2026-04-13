import type {
  AiBackend,
  AiRequestStatus,
  AiRequestTransport,
  EffectiveConfig,
  MaterializedSession,
  ProviderWireApi,
  RenameSuggestion,
} from "@codexnamer/shared";

export type FetchLike = typeof fetch;

export type JsonSuggestionPayload = {
  name?: string;
  kind?: string;
  summary?: string;
  scope?: string;
  tagId?: string;
};

export interface RenameInferenceRequestLogger {
  start(entry: {
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
  }): number;
  finish(entry: {
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
  }): void;
}

export interface RenameInferenceService {
  suggest(session: MaterializedSession): Promise<RenameSuggestion>;
}

export class RenameInferenceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "provider-misconfigured"
      | "missing-auth"
      | "request-failed"
      | "empty-response"
      | "invalid-json"
      | "missing-fields"
      | "unsupported-backend",
  ) {
    super(message);
    this.name = "RenameInferenceError";
  }
}

export interface ResolvedProvider {
  profileId: string;
  baseUrl?: string;
  model?: string;
  credentialValue?: string;
  credentialKind?: "api-key" | "bearer-token";
  credentialSource?:
    | "explicit-api-key"
    | "explicit-env-ref"
    | "inherited-provider-env"
    | "codex-auth-json-api-key"
    | "env-openai-api-key"
    | "codex-auth-token";
  headers: Record<string, string>;
  providerRef?: string;
  requestType: ProviderWireApi;
  requiresOpenaiAuth: boolean;
  requestedBackend: Exclude<AiBackend, "none">;
}

export interface ProviderDiagnostics {
  configuredBackend: AiBackend;
  requestedBackend: AiBackend;
  profileId?: string;
  providerRef?: string;
  baseUrl?: string;
  model?: string;
  requestType?: ProviderWireApi;
  requiresOpenaiAuth?: boolean;
  credentialKind?: "api-key" | "bearer-token";
  credentialSource?: ResolvedProvider["credentialSource"];
  hasCredential: boolean;
  preferredTransport: "none" | "http";
  canDirectHttp: boolean;
}

export type RequestLogContext = { id?: number; startedAtMs: number };

export type RequestLogResult = {
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
