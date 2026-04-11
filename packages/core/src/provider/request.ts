import type { EffectiveConfig, MaterializedSession } from "@codexnamer/shared";

import { toUtcIso } from "../util.js";
import type {
  FetchLike,
  RenameInferenceRequestLogger,
  RequestLogContext,
  RequestLogResult,
  ResolvedProvider
} from "./shared.js";

function startRequestLog(
  logger: RenameInferenceRequestLogger | undefined,
  session: MaterializedSession,
  params: {
    backend: ResolvedProvider["requestedBackend"];
    transport: "responses" | "openai-compatible";
    baseUrl?: string;
    model?: string;
    promptChars: number;
    promptText?: string;
    requestPayload?: Record<string, unknown>;
    metadata?: Record<string, string>;
  }
): RequestLogContext {
  const startedAtMs = Date.now();
  const startedAt = toUtcIso(new Date(startedAtMs));
  return {
    id: logger?.start({
      threadId: session.threadId,
      projectName: session.projectName,
      backend: params.backend,
      transport: params.transport,
      startedAt,
      baseUrl: params.baseUrl,
      model: params.model,
      promptChars: params.promptChars,
      promptText: params.promptText,
      requestPayload: params.requestPayload,
      metadata: params.metadata
    }),
    startedAtMs
  };
}

export function finishRequestLog(
  logger: RenameInferenceRequestLogger | undefined,
  context: RequestLogContext,
  params: {
    status: "succeeded" | "failed";
    responseChars?: number;
    responseText?: string;
    responsePayload?: Record<string, unknown>;
    result?: RequestLogResult;
    error?: string;
    metadata?: Record<string, string>;
  }
): void {
  if (!logger || !context.id) {
    return;
  }

  const finishedAtMs = Date.now();
  logger.finish({
    id: context.id,
    status: params.status,
    finishedAt: toUtcIso(new Date(finishedAtMs)),
    durationMs: finishedAtMs - context.startedAtMs,
    responseChars: params.responseChars,
    responseText: params.responseText,
    responsePayload: params.responsePayload,
    result: params.result,
    error: params.error,
    metadata: params.metadata
  });
}

function buildResponsesUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/responses`;
}

function buildChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function extractResponsesText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const output = payload.output;
  if (!Array.isArray(output)) {
    return "";
  }

  const texts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const blockRecord = block as Record<string, unknown>;
      if (typeof blockRecord.text === "string") {
        texts.push(blockRecord.text);
      } else if (typeof blockRecord.output_text === "string") {
        texts.push(blockRecord.output_text);
      }
    }
  }

  return texts.join("\n").trim();
}

function extractChatCompletionText(payload: Record<string, unknown>): string {
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return "";
  }

  const message = (choices[0] as Record<string, unknown>).message;
  if (!message || typeof message !== "object") {
    return "";
  }

  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) =>
        item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string"
          ? ((item as Record<string, unknown>).text as string)
          : ""
      )
      .join("\n")
      .trim();
  }

  return "";
}

async function parseJsonResponse(response: Response): Promise<{
  status: number;
  text: string;
  payload: Record<string, unknown>;
}> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
  }

  try {
    return {
      status: response.status,
      text,
      payload: JSON.parse(text) as Record<string, unknown>
    };
  } catch {
    throw new Error(`Invalid JSON response: ${text.slice(0, 400)}`);
  }
}

function buildProviderAuthHeaders(provider: ResolvedProvider): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...provider.headers
  };
  if (provider.credentialValue) {
    headers.Authorization = `Bearer ${provider.credentialValue}`;
    if (provider.credentialKind === "api-key") {
      headers["x-api-key"] = provider.credentialValue;
    }
  }
  return headers;
}

function extractSseDataLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6).trim())
    .filter((line) => line.length > 0 && line !== "[DONE]");
}

function extractResponsesStreamText(raw: string): string {
  let completedText = "";
  let deltaText = "";

  for (const line of extractSseDataLines(raw)) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === "response.output_text.done" && typeof event.text === "string") {
        completedText = event.text;
        continue;
      }
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        deltaText += event.delta;
        continue;
      }
      if (event.type === "response.content_part.done") {
        const part = event.part;
        if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
          completedText = (part as Record<string, unknown>).text as string;
        }
      }
    } catch {
      continue;
    }
  }

  return completedText.trim() || deltaText.trim();
}

function extractChatCompletionStreamText(raw: string): string {
  let content = "";
  for (const line of extractSseDataLines(raw)) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const choices = event.choices;
      if (!Array.isArray(choices) || choices.length === 0) {
        continue;
      }
      const delta = (choices[0] as Record<string, unknown>).delta;
      if (delta && typeof delta === "object" && typeof (delta as Record<string, unknown>).content === "string") {
        content += (delta as Record<string, unknown>).content as string;
      }
    } catch {
      continue;
    }
  }
  return content.trim();
}

export async function callResponsesApi(
  fetchImpl: FetchLike,
  provider: ResolvedProvider,
  config: EffectiveConfig,
  prompt: string,
  session: MaterializedSession,
  logger?: RenameInferenceRequestLogger
): Promise<{ text: string; payload: Record<string, unknown>; logContext: RequestLogContext }> {
  const requestPayload = {
    model: provider.model,
    temperature: config.ai.temperature,
    input: prompt
  };
  const logContext = startRequestLog(logger, session, {
    backend: provider.requestedBackend,
    transport: "responses",
    baseUrl: provider.baseUrl,
    model: provider.model,
    promptChars: prompt.length,
    promptText: prompt,
    requestPayload,
    metadata: {
      profile: provider.profileId,
      providerRef: provider.providerRef ?? "",
      requestedBackend: provider.requestedBackend
    }
  });

  try {
    const response = await fetchImpl(buildResponsesUrl(provider.baseUrl!), {
      method: "POST",
      headers: buildProviderAuthHeaders(provider),
      signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
      body: JSON.stringify(requestPayload)
    });

    const parsed = await parseJsonResponse(response);
    const text = extractResponsesText(parsed.payload);
    return {
      text,
      payload: parsed.payload,
      logContext
    };
  } catch (error) {
    finishRequestLog(logger, logContext, {
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown"
    });
    throw error;
  }
}

export async function callChatCompletionsApi(
  fetchImpl: FetchLike,
  provider: ResolvedProvider,
  config: EffectiveConfig,
  prompt: string,
  session: MaterializedSession,
  logger?: RenameInferenceRequestLogger
): Promise<{ text: string; payload: Record<string, unknown>; logContext: RequestLogContext }> {
  const requestPayload = {
    model: provider.model,
    temperature: config.ai.temperature,
    messages: [
      {
        role: "system",
        content:
          "You generate concise but specific session names. Return JSON only with keys: name, kind, summary, scope, tagId."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  };
  const logContext = startRequestLog(logger, session, {
    backend: provider.requestedBackend,
    transport: "openai-compatible",
    baseUrl: provider.baseUrl,
    model: provider.model,
    promptChars: prompt.length,
    promptText: prompt,
    requestPayload,
    metadata: {
      profile: provider.profileId,
      providerRef: provider.providerRef ?? "",
      requestedBackend: provider.requestedBackend
    }
  });

  try {
    const response = await fetchImpl(buildChatCompletionsUrl(provider.baseUrl!), {
      method: "POST",
      headers: buildProviderAuthHeaders(provider),
      signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
      body: JSON.stringify(requestPayload)
    });

    const parsed = await parseJsonResponse(response);
    const text = extractChatCompletionText(parsed.payload);
    return {
      text,
      payload: parsed.payload,
      logContext
    };
  } catch (error) {
    finishRequestLog(logger, logContext, {
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown"
    });
    throw error;
  }
}

export async function executeProviderRequest(
  fetchImpl: FetchLike,
  provider: ResolvedProvider,
  config: EffectiveConfig,
  prompt: string,
  session: MaterializedSession,
  logger?: RenameInferenceRequestLogger
): Promise<{ text: string; payload?: Record<string, unknown>; logContext: RequestLogContext }> {
  if (provider.requestType === "responses") {
    return callResponsesApi(fetchImpl, provider, config, prompt, session, logger);
  }
  return callChatCompletionsApi(fetchImpl, provider, config, prompt, session, logger);
}

export async function callStreamingResponsesApi(
  fetchImpl: FetchLike,
  provider: ResolvedProvider,
  config: EffectiveConfig,
  prompt: string,
  session: MaterializedSession,
  logger?: RenameInferenceRequestLogger
): Promise<{ text: string; logContext: RequestLogContext }> {
  const requestPayload = {
    model: provider.model,
    temperature: config.ai.temperature,
    input: prompt,
    stream: true
  };
  const logContext = startRequestLog(logger, session, {
    backend: provider.requestedBackend,
    transport: "responses",
    baseUrl: provider.baseUrl,
    model: provider.model,
    promptChars: prompt.length,
    promptText: prompt,
    requestPayload,
    metadata: {
      profile: provider.profileId,
      providerRef: provider.providerRef ?? "",
      requestedBackend: provider.requestedBackend
    }
  });

  try {
    const response = await fetchImpl(buildResponsesUrl(provider.baseUrl!), {
      method: "POST",
      headers: buildProviderAuthHeaders(provider),
      signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
      body: JSON.stringify(requestPayload)
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${raw.slice(0, 400)}`);
    }
    return {
      text: extractResponsesStreamText(raw),
      logContext
    };
  } catch (error) {
    finishRequestLog(logger, logContext, {
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown"
    });
    throw error;
  }
}

export async function callStreamingChatCompletionsApi(
  fetchImpl: FetchLike,
  provider: ResolvedProvider,
  config: EffectiveConfig,
  prompt: string,
  session: MaterializedSession,
  logger?: RenameInferenceRequestLogger
): Promise<{ text: string; logContext: RequestLogContext }> {
  const requestPayload = {
    model: provider.model,
    temperature: config.ai.temperature,
    messages: [
      {
        role: "system",
        content:
          "You generate concise but specific session names. Return JSON only with keys: name, kind, summary, scope, tagId."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    stream: true
  };
  const logContext = startRequestLog(logger, session, {
    backend: provider.requestedBackend,
    transport: "openai-compatible",
    baseUrl: provider.baseUrl,
    model: provider.model,
    promptChars: prompt.length,
    promptText: prompt,
    requestPayload,
    metadata: {
      profile: provider.profileId,
      providerRef: provider.providerRef ?? "",
      requestedBackend: provider.requestedBackend
    }
  });

  try {
    const response = await fetchImpl(buildChatCompletionsUrl(provider.baseUrl!), {
      method: "POST",
      headers: buildProviderAuthHeaders(provider),
      signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
      body: JSON.stringify(requestPayload)
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${raw.slice(0, 400)}`);
    }
    return {
      text: extractChatCompletionStreamText(raw),
      logContext
    };
  } catch (error) {
    finishRequestLog(logger, logContext, {
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown"
    });
    throw error;
  }
}

export async function executeStreamingProviderRequest(
  fetchImpl: FetchLike,
  provider: ResolvedProvider,
  config: EffectiveConfig,
  prompt: string,
  session: MaterializedSession,
  logger?: RenameInferenceRequestLogger
): Promise<{ text: string; logContext: RequestLogContext }> {
  if (provider.requestType === "responses") {
    return callStreamingResponsesApi(fetchImpl, provider, config, prompt, session, logger);
  }
  return callStreamingChatCompletionsApi(fetchImpl, provider, config, prompt, session, logger);
}
