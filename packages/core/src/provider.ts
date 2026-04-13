import type { EffectiveConfig, MaterializedSession, RenameSuggestion } from "@codexnamer/shared";
import {
  inspectRenameProvider,
  resolveProfile,
  shouldPreferStreamingProviderRequest,
} from "./provider/profile.js";
import {
  buildProviderProbeSession,
  buildRenamePrompt,
  composeAiSuggestion,
  extractFirstJsonObject,
} from "./provider/prompt.js";
import {
  executeProviderRequest,
  executeStreamingProviderRequest,
  finishRequestLog,
} from "./provider/request.js";
import type {
  FetchLike,
  ProviderDiagnostics,
  RenameInferenceRequestLogger,
  RenameInferenceService,
} from "./provider/shared.js";
import { RenameInferenceError } from "./provider/shared.js";

export { inspectRenameProvider, resolveRenameProvider } from "./provider/profile.js";
export { buildRenamePrompt } from "./provider/prompt.js";
export {
  type FetchLike,
  type ProviderDiagnostics,
  RenameInferenceError,
  type RenameInferenceRequestLogger,
  type RenameInferenceService,
} from "./provider/shared.js";

export async function probeRenameProvider(
  config: EffectiveConfig,
  options?: {
    fetchImpl?: FetchLike;
  },
): Promise<{
  ok: boolean;
  testedAt: string;
  latencyMs?: number;
  diagnostics: ProviderDiagnostics;
  responseText?: string;
  error?: string;
}> {
  const diagnostics = inspectRenameProvider(config);
  const testedAt = new Date().toISOString();
  if (config.ai.backend === "none") {
    return {
      ok: false,
      testedAt,
      diagnostics,
      error: "AI rename is disabled.",
    };
  }

  const provider = resolveProfile(config);
  if (!provider || !provider.baseUrl || !provider.model) {
    return {
      ok: false,
      testedAt,
      diagnostics,
      error: "Provider is missing base URL or model.",
    };
  }
  if (!provider.credentialValue) {
    return {
      ok: false,
      testedAt,
      diagnostics,
      error: "Provider is missing an API key or bearer token.",
    };
  }

  const fetchImpl = options?.fetchImpl ?? fetch;
  const probeSession = buildProviderProbeSession(testedAt, config);
  const startedAtMs = Date.now();
  try {
    const service = new OpenAICompatibleRenameInferenceService(config, fetchImpl);
    const suggestion = await service.suggest(probeSession);
    return {
      ok: suggestion.name.trim().length > 0,
      testedAt,
      latencyMs: Date.now() - startedAtMs,
      diagnostics,
      responseText: suggestion.name,
    };
  } catch (error) {
    if (
      error instanceof RenameInferenceError &&
      (error.code === "empty-response" || error.code === "invalid-json")
    ) {
      try {
        const prompt = buildRenamePrompt(probeSession, config);
        const streamResponse = await executeStreamingProviderRequest(
          fetchImpl,
          provider,
          config,
          prompt,
          probeSession,
        );
        const streamText = streamResponse.text;
        if (!streamText.trim()) {
          throw new RenameInferenceError("Model returned an empty response.", "empty-response");
        }
        const parsedModelOutput = extractFirstJsonObject(streamText);
        if (!parsedModelOutput) {
          throw new RenameInferenceError("Model output is not valid JSON.", "invalid-json");
        }
        const composed = composeAiSuggestion(parsedModelOutput, probeSession, config, {
          backend: provider.requestedBackend,
          profile: provider.profileId,
          providerRef: provider.providerRef ?? "",
          requestType: provider.requestType,
          authKind: provider.credentialKind ?? "",
          authSource: provider.credentialSource ?? "",
        });
        return {
          ok: true,
          testedAt,
          latencyMs: Date.now() - startedAtMs,
          diagnostics,
          responseText: composed.suggestion.name,
        };
      } catch (streamError) {
        return {
          ok: false,
          testedAt,
          latencyMs: Date.now() - startedAtMs,
          diagnostics,
          error: streamError instanceof Error ? streamError.message : "Unknown error",
        };
      }
    }
    return {
      ok: false,
      testedAt,
      latencyMs: Date.now() - startedAtMs,
      diagnostics,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export class OpenAICompatibleRenameInferenceService implements RenameInferenceService {
  constructor(
    private readonly config: EffectiveConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly requestLogger?: RenameInferenceRequestLogger,
  ) {}

  async suggest(session: MaterializedSession): Promise<RenameSuggestion> {
    if (this.config.ai.backend === "none") {
      throw new RenameInferenceError("AI rename is disabled.", "unsupported-backend");
    }

    const provider = resolveProfile(this.config);
    if (!provider || !provider.baseUrl || !provider.model) {
      throw new RenameInferenceError(
        "Provider is missing base URL or model.",
        "provider-misconfigured",
      );
    }
    if (!provider.credentialValue) {
      throw new RenameInferenceError(
        "Provider is missing an API key or bearer token.",
        "missing-auth",
      );
    }

    const prompt = buildRenamePrompt(session, this.config);
    const preferStreaming = shouldPreferStreamingProviderRequest(this.config);
    let response:
      | {
          text: string;
          payload?: Record<string, unknown>;
          logContext: { id?: number; startedAtMs: number };
        }
      | undefined;
    try {
      if (preferStreaming) {
        const streamingResponse = await executeStreamingProviderRequest(
          this.fetchImpl,
          provider,
          this.config,
          prompt,
          session,
          this.requestLogger,
        );
        response = {
          text: streamingResponse.text,
          payload: undefined,
          logContext: streamingResponse.logContext,
        };
      } else {
        response = await executeProviderRequest(
          this.fetchImpl,
          provider,
          this.config,
          prompt,
          session,
          this.requestLogger,
        );
      }
      let responseText = response.text;
      let parsedModelOutput = extractFirstJsonObject(responseText);
      const finishMetadata: Record<string, string> = {};

      if (preferStreaming) {
        finishMetadata.responseMode = "sse-primary";
      } else if (!responseText.trim() || !parsedModelOutput) {
        const fallbackReason = !responseText.trim() ? "empty-response" : "invalid-json";
        const streamResponse = await executeStreamingProviderRequest(
          this.fetchImpl,
          provider,
          this.config,
          prompt,
          session,
        );
        const streamText = streamResponse.text;
        if (!streamText.trim()) {
          throw new RenameInferenceError("Model returned an empty response.", "empty-response");
        }
        const streamParsedModelOutput = extractFirstJsonObject(streamText);
        if (!streamParsedModelOutput) {
          throw new RenameInferenceError("Model output is not valid JSON.", "invalid-json");
        }
        responseText = streamText;
        parsedModelOutput = streamParsedModelOutput;
        finishMetadata.responseMode = "sse-fallback";
        finishMetadata.sseFallbackReason = fallbackReason;
      }
      if (!responseText.trim()) {
        throw new RenameInferenceError("Model returned an empty response.", "empty-response");
      }
      if (!parsedModelOutput) {
        throw new RenameInferenceError("Model output is not valid JSON.", "invalid-json");
      }

      const composed = composeAiSuggestion(parsedModelOutput, session, this.config, {
        backend: provider.requestedBackend,
        profile: provider.profileId,
        providerRef: provider.providerRef ?? "",
        requestType: provider.requestType,
        authKind: provider.credentialKind ?? "",
        authSource: provider.credentialSource ?? "",
      });
      finishRequestLog(this.requestLogger, response.logContext, {
        status: "succeeded",
        responseChars: responseText.length,
        responseText,
        responsePayload: response.payload,
        result: composed.result,
        metadata: Object.keys(finishMetadata).length > 0 ? finishMetadata : undefined,
      });
      return composed.suggestion;
    } catch (error) {
      if (response) {
        let metadata: Record<string, string> | undefined;
        if (preferStreaming) {
          metadata = {
            responseMode: "sse-primary",
          };
        } else if (
          error instanceof RenameInferenceError &&
          (error.code === "empty-response" || error.code === "invalid-json")
        ) {
          metadata = {
            responseMode: "sse-fallback-failed",
            sseFallbackReason: error.code,
          };
        }
        finishRequestLog(this.requestLogger, response.logContext, {
          status: "failed",
          responseChars: response.text.length,
          responseText: response.text,
          responsePayload: response.payload,
          error: error instanceof Error ? error.message : "Unknown provider request failure.",
          metadata,
        });
      }
      if (error instanceof RenameInferenceError) {
        throw error;
      }
      throw new RenameInferenceError(
        error instanceof Error ? error.message : "Unknown provider request failure.",
        "request-failed",
      );
    }
  }
}

// Compatibility shim for older imports. The dedicated codex-exec fallback path has been removed.
export class CodexRenameInferenceService extends OpenAICompatibleRenameInferenceService {}

export function createRenameInferenceService(
  config: EffectiveConfig,
  options?: {
    fetchImpl?: FetchLike;
    codexRunner?: unknown;
    requestLogger?: RenameInferenceRequestLogger;
  },
): RenameInferenceService {
  return new OpenAICompatibleRenameInferenceService(
    config,
    options?.fetchImpl,
    options?.requestLogger,
  );
}
