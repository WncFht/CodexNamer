import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  AiBackend,
  AiRequestStatus,
  AiRequestTransport,
  EffectiveConfig,
  MaterializedSession,
  ProviderProfile,
  ProviderWireApi,
  RenameMode,
  RenameSuggestion
} from "@codex-session-manager/shared";

import { resolveNamingStyle, resolveTagDisplayLabel, suggestNameHeuristically } from "./naming.js";
import { buildRenameContext } from "./rename-context.js";
import { stripControl, toUtcIso } from "./util.js";

const execFileAsync = promisify(execFile);

type FetchLike = typeof fetch;

type JsonSuggestionPayload = {
  name?: string;
  kind?: string;
  summary?: string;
  scope?: string;
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
    metadata?: Record<string, string>;
  }): number;
  finish(entry: {
    id: number;
    status: Exclude<AiRequestStatus, "running">;
    finishedAt: string;
    durationMs: number;
    responseChars?: number;
    error?: string;
    metadata?: Record<string, string>;
  }): void;
}

export interface RenameInferenceService {
  suggest(session: MaterializedSession, mode?: RenameMode): Promise<RenameSuggestion>;
}

export interface CodexCommandRunner {
  run(args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<void>;
}

interface ResolvedProvider {
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
  wireApi: ProviderWireApi;
  requiresOpenaiAuth: boolean;
  requestedBackend: "codex" | "openai-compatible";
}

export interface ProviderDiagnostics {
  configuredBackend: AiBackend;
  requestedBackend: AiBackend;
  profileId?: string;
  providerRef?: string;
  baseUrl?: string;
  model?: string;
  wireApi?: ProviderWireApi;
  requiresOpenaiAuth?: boolean;
  credentialKind?: "api-key" | "bearer-token";
  credentialSource?: ResolvedProvider["credentialSource"];
  hasCredential: boolean;
  preferredTransport: "none" | "http" | "codex-exec";
  canDirectHttp: boolean;
  codexFallbackEnabled: boolean;
}

function startRequestLog(
  logger: RenameInferenceRequestLogger | undefined,
  session: MaterializedSession,
  params: {
    backend: Exclude<AiBackend, "none">;
    transport: AiRequestTransport;
    baseUrl?: string;
    model?: string;
    promptChars: number;
    metadata?: Record<string, string>;
  }
): { id?: number; startedAtMs: number; startedAt: string } {
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
      metadata: params.metadata
    }),
    startedAtMs,
    startedAt
  };
}

function finishRequestLog(
  logger: RenameInferenceRequestLogger | undefined,
  context: { id?: number; startedAtMs: number },
  params: {
    status: Exclude<AiRequestStatus, "running">;
    responseChars?: number;
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
    error: params.error,
    metadata: params.metadata
  });
}

function normalizePromptField(value: string | undefined, maxLength: number): string {
  if (!value) {
    return "";
  }

  const compact = (stripControl(value) ?? "").replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function buildRenamePrompt(session: MaterializedSession, config: EffectiveConfig): string {
  const renameContext = session.renameContext ?? buildRenameContext(session, config);
  const style = resolveNamingStyle(session, config);
  const componentSummary = config.naming.components.join(", ") || "(none)";
  const structuredGuidance =
    "Structured naming mode is active. Build the final name by following the configured component order exactly, skipping only components that have no meaningful value.";
  const promptOverrideDetails = config.naming.customPrompt?.trim()
    ? [
        "Custom prompt override is active. Treat the override below as the highest-priority naming policy, while still obeying the JSON-only response contract and max length.",
        "Custom naming override:",
        config.naming.customPrompt.trim()
      ]
    : [
        "Prompt override mode is active, but no custom override text was configured. Fall back to the structured component policy."
      ];
  const tagLines = config.naming.tags.map((tag) => {
    const label = resolveTagDisplayLabel(tag, config.naming.language);
    const descriptor =
      normalizePromptField(tag.description, 120) ||
      normalizePromptField(tag.promptHint, 120) ||
      "";
    return descriptor ? `- ${tag.id} => ${label} | ${descriptor}` : `- ${tag.id} => ${label}`;
  });
  const styleGuidance =
    style === "detailed"
      ? "Preferred naming style: detailed. Use more of the available length budget, and include one concrete secondary focus when it materially distinguishes the session."
      : "Preferred naming style: brief. Keep the name short and list-safe while still preserving the main subsystem and action.";
  const parts = [
    "You generate a concise session rename suggestion for Codex Session Manager.",
    "Return only a JSON object with keys: name, kind, summary, scope.",
    "Do not inspect files, do not run shell commands, and do not rely on repository context.",
    "Use only the session context provided below.",
    `Target language: ${config.naming.language}.`,
    `Max final name length: ${config.naming.maxLength}.`,
    styleGuidance,
    "Prefer a short but specific summary suitable for a session list.",
    "Make the rename concrete: capture the main subsystem plus the actual action, issue, or review focus.",
    "If the session has two tightly related goals, use one short secondary fragment rather than a generic umbrella noun.",
    config.naming.compositionMode === "structured" ? structuredGuidance : promptOverrideDetails[0],
    "Allowed kind values: feat, fix, debug, refactor, docs, research, review, design, migration, test, chore, ops.",
    "",
    "Session context:",
    `threadId: ${session.threadId}`,
    `project: ${session.projectName ?? ""}`,
    `cwd: ${session.cwd ?? ""}`,
    `modelProvider: ${session.modelProvider ?? ""}`,
    `model: ${session.model ?? ""}`,
    `requestedContextStrategy: ${renameContext.requestedStrategy}`,
    `resolvedContextStrategy: ${renameContext.strategy}`,
    `contextTruncated: ${String(renameContext.truncated)}`,
    `contextChars: ${renameContext.selectedChars}/${renameContext.maxChars}`,
    `contextFallbackReason: ${renameContext.fallbackReason ?? ""}`,
    `namingStyle: ${style}`,
    `namingCompositionMode: ${config.naming.compositionMode}`,
    `namingComponents: ${componentSummary}`,
    `componentSeparator: ${JSON.stringify(config.naming.componentSeparator)}`,
    `firstUserMessage: ${normalizePromptField(session.firstUserMessage, 600)}`,
    `lastUserMessage: ${normalizePromptField(session.lastUserMessage, 600)}`,
    `lastAgentMessage: ${normalizePromptField(session.lastAgentMessage, 900)}`,
    `taskCompleteCount: ${session.taskCompleteCount}`,
    `tokenTotal: ${session.tokenTotal}`,
    "",
    "Rename context:",
    normalizePromptField(renameContext.text, renameContext.maxChars),
    "",
    "Structured naming tags:",
    ...(tagLines.length > 0 ? tagLines : ["(none)"]),
    "",
    ...(config.naming.compositionMode === "prompt-override" ? [...promptOverrideDetails.slice(1), ""] : []),
    "Legacy template reference:",
    config.naming.template
  ];

  return parts.join("\n");
}

function extractFirstJsonObject(text: string): JsonSuggestionPayload | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const direct = tryParseJson(trimmed);
  if (direct) {
    return direct;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return tryParseJson(trimmed.slice(start, end + 1));
  }

  return undefined;
}

function tryParseJson(text: string): JsonSuggestionPayload | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      kind: typeof parsed.kind === "string" ? parsed.kind : undefined,
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
      scope: typeof parsed.scope === "string" ? parsed.scope : undefined
    };
  } catch {
    return undefined;
  }
}

function sanitizeSuggestion(
  payload: JsonSuggestionPayload | undefined,
  fallback: RenameSuggestion,
  maxLength: number,
  metadata: Record<string, string>
): RenameSuggestion {
  const name = stripControl(payload?.name) ?? fallback.name;
  const kind = stripControl(payload?.kind) ?? fallback.kind;
  const summary = stripControl(payload?.summary) ?? fallback.summary;
  const scope = stripControl(payload?.scope) ?? fallback.scope;

  return {
    threadId: fallback.threadId,
    name: name.slice(0, Math.max(1, maxLength)).trim(),
    source: "ai",
    style: fallback.style,
    kind,
    summary,
    scope,
    generatedAt: toUtcIso(),
    metadata
  };
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

function resolveProfile(config: EffectiveConfig): ResolvedProvider | undefined {
  const requestedProfileId = config.ai.profile;
  const explicit =
    config.providerProfiles.find((item) => item.profileId === requestedProfileId) ??
    config.providerProfiles.find((item) => item.isDefault) ??
    config.providerProfiles[0];

  if (!explicit) {
    return undefined;
  }

  const inheritedProviderRef =
    explicit.providerRef ??
    (config.ai.providerSource !== "explicit" ? config.inheritedCodex.modelProvider : undefined);
  const inherited =
    inheritedProviderRef && config.inheritedCodex.providers[inheritedProviderRef]
      ? config.inheritedCodex.providers[inheritedProviderRef]
      : undefined;

  const explicitApiKey = explicit.apiKey?.trim() || undefined;
  const explicitApiKeyRef = explicit.apiKeyRef ? process.env[explicit.apiKeyRef]?.trim() : undefined;
  const inheritedEnvApiKey = inherited?.apiKeyEnv ? process.env[inherited.apiKeyEnv]?.trim() : undefined;
  const inheritedAuthApiKey = config.inheritedCodex.auth?.openaiApiKey?.trim() || undefined;
  const envOpenAiApiKey = process.env.OPENAI_API_KEY?.trim() || undefined;
  const inheritedAccessToken = config.inheritedCodex.auth?.accessToken?.trim() || undefined;

  const credentialValue =
    explicitApiKey ||
    explicitApiKeyRef ||
    inheritedEnvApiKey ||
    inheritedAuthApiKey ||
    envOpenAiApiKey ||
    inheritedAccessToken;
  const credentialKind =
    explicitApiKey ||
    explicitApiKeyRef ||
    inheritedEnvApiKey ||
    inheritedAuthApiKey ||
    envOpenAiApiKey
      ? "api-key"
      : inheritedAccessToken
        ? "bearer-token"
        : undefined;
  const credentialSource = explicitApiKey
    ? "explicit-api-key"
    : explicitApiKeyRef
      ? "explicit-env-ref"
      : inheritedEnvApiKey
        ? "inherited-provider-env"
        : inheritedAuthApiKey
          ? "codex-auth-json-api-key"
          : envOpenAiApiKey
            ? "env-openai-api-key"
            : inheritedAccessToken
              ? "codex-auth-token"
              : undefined;

  return {
    profileId: explicit.profileId,
    baseUrl: explicit.baseUrl ?? inherited?.baseUrl,
    model: explicit.model ?? config.inheritedCodex.model,
    credentialValue,
    credentialKind,
    credentialSource,
    headers: {
      ...(inherited?.headers ?? {}),
      ...(explicit.headers ?? {})
    },
    providerRef: inheritedProviderRef,
    wireApi: explicit.wireApi ?? inherited?.wireApi ?? "auto",
    requiresOpenaiAuth: inherited?.requiresOpenaiAuth ?? false,
    requestedBackend:
      config.ai.backend === "codex" || explicit.backendKind === "codex"
        ? "codex"
      : "openai-compatible"
  };
}

export function inspectRenameProvider(config: EffectiveConfig): ProviderDiagnostics {
  if (config.ai.backend === "none") {
    return {
      configuredBackend: "none",
      requestedBackend: "none",
      hasCredential: false,
      preferredTransport: "none",
      canDirectHttp: false,
      codexFallbackEnabled: false
    };
  }

  const provider = resolveProfile(config);
  if (!provider) {
    return {
      configuredBackend: config.ai.backend,
      requestedBackend: config.ai.backend,
      hasCredential: false,
      preferredTransport: config.ai.backend === "codex" ? "codex-exec" : "http",
      canDirectHttp: false,
      codexFallbackEnabled: config.ai.backend === "codex"
    };
  }

  const canDirectHttp = Boolean(provider.baseUrl && provider.model && provider.credentialValue);
  return {
    configuredBackend: config.ai.backend,
    requestedBackend: provider.requestedBackend,
    profileId: provider.profileId,
    providerRef: provider.providerRef,
    baseUrl: provider.baseUrl,
    model: provider.model,
    wireApi: provider.wireApi,
    requiresOpenaiAuth: provider.requiresOpenaiAuth,
    credentialKind: provider.credentialKind,
    credentialSource: provider.credentialSource,
    hasCredential: Boolean(provider.credentialValue),
    preferredTransport:
      provider.requestedBackend === "codex"
        ? canDirectHttp
          ? "http"
          : "codex-exec"
        : canDirectHttp
          ? "http"
          : "none",
    canDirectHttp,
    codexFallbackEnabled: provider.requestedBackend === "codex"
  };
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

async function callResponsesApi(
  fetchImpl: FetchLike,
  provider: ResolvedProvider,
  config: EffectiveConfig,
  prompt: string,
  session: MaterializedSession,
  logger?: RenameInferenceRequestLogger
): Promise<string> {
  const logContext = startRequestLog(logger, session, {
    backend: provider.requestedBackend,
    transport: "responses",
    baseUrl: provider.baseUrl,
    model: provider.model,
    promptChars: prompt.length,
    metadata: {
      profile: provider.profileId,
      providerRef: provider.providerRef ?? "",
      requestedBackend: provider.requestedBackend
    }
  });
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

  try {
    const response = await fetchImpl(buildResponsesUrl(provider.baseUrl!), {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
      body: JSON.stringify({
        model: provider.model,
        temperature: config.ai.temperature,
        input: prompt
      })
    });

    const parsed = await parseJsonResponse(response);
    const text = extractResponsesText(parsed.payload);
    finishRequestLog(logger, logContext, {
      status: "succeeded",
      responseChars: text.length
    });
    return text;
  } catch (error) {
    finishRequestLog(logger, logContext, {
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown"
    });
    throw error;
  }
}

async function callChatCompletionsApi(
  fetchImpl: FetchLike,
  provider: ResolvedProvider,
  config: EffectiveConfig,
  prompt: string,
  session: MaterializedSession,
  logger?: RenameInferenceRequestLogger
): Promise<string> {
  const logContext = startRequestLog(logger, session, {
    backend: provider.requestedBackend,
    transport: "chat_completions",
    baseUrl: provider.baseUrl,
    model: provider.model,
    promptChars: prompt.length,
    metadata: {
      profile: provider.profileId,
      providerRef: provider.providerRef ?? "",
      requestedBackend: provider.requestedBackend
    }
  });
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

  try {
    const response = await fetchImpl(buildChatCompletionsUrl(provider.baseUrl!), {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
      body: JSON.stringify({
        model: provider.model,
        temperature: config.ai.temperature,
        messages: [
          {
            role: "system",
            content:
              "You generate concise but specific session names. Return JSON only with keys: name, kind, summary, scope."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    const parsed = await parseJsonResponse(response);
    const text = extractChatCompletionText(parsed.payload);
    finishRequestLog(logger, logContext, {
      status: "succeeded",
      responseChars: text.length
    });
    return text;
  } catch (error) {
    finishRequestLog(logger, logContext, {
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown"
    });
    throw error;
  }
}

export class NoneRenameInferenceService implements RenameInferenceService {
  constructor(protected readonly config: EffectiveConfig) {}

  async suggest(session: MaterializedSession, _mode?: RenameMode): Promise<RenameSuggestion> {
    return suggestNameHeuristically(session, this.config);
  }
}

export class OpenAICompatibleRenameInferenceService extends NoneRenameInferenceService {
  constructor(
    config: EffectiveConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly requestLogger?: RenameInferenceRequestLogger
  ) {
    super(config);
  }

  override async suggest(session: MaterializedSession, _mode?: RenameMode): Promise<RenameSuggestion> {
    const fallback = suggestNameHeuristically(session, this.config);
    const provider = resolveProfile(this.config);
    if (!provider || !provider.baseUrl || !provider.model) {
      return {
        ...fallback,
        metadata: {
          backend: "openai-compatible",
          fallback: "provider-misconfigured"
        }
      };
    }
    if (!provider.credentialValue) {
      return {
        ...fallback,
        metadata: {
          backend: "openai-compatible",
          fallback: "missing-auth"
        }
      };
    }

    const prompt = buildRenamePrompt(session, this.config);
    try {
      let text = "";
      if (provider.wireApi === "responses") {
        text = await callResponsesApi(this.fetchImpl, provider, this.config, prompt, session, this.requestLogger);
      } else if (provider.wireApi === "chat_completions") {
        text = await callChatCompletionsApi(this.fetchImpl, provider, this.config, prompt, session, this.requestLogger);
      } else {
        try {
          text = await callResponsesApi(this.fetchImpl, provider, this.config, prompt, session, this.requestLogger);
        } catch {
          text = await callChatCompletionsApi(this.fetchImpl, provider, this.config, prompt, session, this.requestLogger);
        }
      }

      return sanitizeSuggestion(extractFirstJsonObject(text), fallback, this.config.naming.maxLength, {
        backend: "openai-compatible",
        profile: provider.profileId,
        providerRef: provider.providerRef ?? "",
        authKind: provider.credentialKind ?? "",
        authSource: provider.credentialSource ?? "",
        requestedBackend: provider.requestedBackend
      });
    } catch (error) {
      return {
        ...fallback,
        metadata: {
          backend: "openai-compatible",
          fallback: "request-failed",
          error: error instanceof Error ? error.message.slice(0, 200) : "unknown"
        }
      };
    }
  }
}

class PreferredCodexRenameInferenceService implements RenameInferenceService {
  constructor(
    private readonly directService: OpenAICompatibleRenameInferenceService,
    private readonly fallbackService: CodexRenameInferenceService
  ) {}

  async suggest(session: MaterializedSession, mode?: RenameMode): Promise<RenameSuggestion> {
    const directResult = await this.directService.suggest(session, mode);
    if (directResult.source === "ai") {
      return {
        ...directResult,
        metadata: {
          ...(directResult.metadata ?? {}),
          requestedBackend: "codex",
          transport: "http"
        }
      };
    }

    const fallbackResult = await this.fallbackService.suggest(session, mode);
    if (fallbackResult.source === "ai") {
      return {
        ...fallbackResult,
        metadata: {
          ...(fallbackResult.metadata ?? {}),
          requestedBackend: "codex",
          transport: "codex-exec",
          directFallback: directResult.metadata?.fallback ?? "unknown"
        }
      };
    }

    return {
      ...fallbackResult,
      metadata: {
        ...(fallbackResult.metadata ?? {}),
        requestedBackend: "codex",
        directFallback: directResult.metadata?.fallback ?? "unknown"
      }
    };
  }
}

class DefaultCodexCommandRunner implements CodexCommandRunner {
  async run(args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<void> {
    try {
      await execFileAsync("codex", args, {
        cwd: options.cwd,
        env: options.env
      });
    } catch (error) {
      const execError = error as Error & { stderr?: string; stdout?: string };
      const stderr = execError.stderr?.trim();
      const stdout = execError.stdout?.trim();
      throw new Error(
        [execError.message, stderr, stdout].filter(Boolean).join(" | ").slice(0, 600)
      );
    }
  }
}

export class CodexRenameInferenceService extends NoneRenameInferenceService {
  constructor(
    config: EffectiveConfig,
    private readonly runner: CodexCommandRunner = new DefaultCodexCommandRunner(),
    private readonly requestLogger?: RenameInferenceRequestLogger
  ) {
    super(config);
  }

  override async suggest(session: MaterializedSession, _mode?: RenameMode): Promise<RenameSuggestion> {
    const fallback = suggestNameHeuristically(session, this.config);
    const provider = resolveProfile(this.config);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "csm-codex-"));
    const outputPath = path.join(tempDir, "rename-output.json");
    const schemaPath = path.join(tempDir, "schema.json");

    await fs.writeFile(
      schemaPath,
      JSON.stringify(
        {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            kind: { type: "string" },
            summary: { type: "string" },
            scope: { type: "string" }
          },
          required: ["name", "kind", "summary", "scope"]
        },
        null,
        2
      ),
      "utf8"
    );

    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "-s",
      "read-only",
      "-c",
      'model_reasoning_effort="minimal"',
      "-c",
      'model_reasoning_summary="none"',
      "-C",
      tempDir,
      "--output-schema",
      schemaPath,
      "-o",
      outputPath
    ];

    if (provider?.providerRef) {
      args.push("-c", `model_provider="${provider.providerRef}"`);
    }
    if (provider?.model) {
      args.push("-m", provider.model);
    }

    args.push(buildRenamePrompt(session, this.config));
    const prompt = args[args.length - 1] ?? "";
    const logContext = startRequestLog(this.requestLogger, session, {
      backend: "codex",
      transport: "codex-exec",
      model: provider?.model,
      promptChars: prompt.length,
      metadata: {
        profile: provider?.profileId ?? "default",
        providerRef: provider?.providerRef ?? ""
      }
    });

    try {
      await this.runner.run(args, {
        cwd: tempDir,
        env: process.env
      });
      const output = await fs.readFile(outputPath, "utf8");
      finishRequestLog(this.requestLogger, logContext, {
        status: "succeeded",
        responseChars: output.length
      });
      return sanitizeSuggestion(extractFirstJsonObject(output), fallback, this.config.naming.maxLength, {
        backend: "codex",
        profile: provider?.profileId ?? "default",
        providerRef: provider?.providerRef ?? ""
      });
    } catch (error) {
      finishRequestLog(this.requestLogger, logContext, {
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 300) : "unknown"
      });
      return {
        ...fallback,
        metadata: {
          backend: "codex",
          fallback: "exec-failed",
          error: error instanceof Error ? error.message.slice(0, 200) : "unknown"
        }
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

export function createRenameInferenceService(
  config: EffectiveConfig,
  options?: {
    fetchImpl?: FetchLike;
    codexRunner?: CodexCommandRunner;
    requestLogger?: RenameInferenceRequestLogger;
  }
): RenameInferenceService {
  if (config.ai.backend === "codex") {
    return new PreferredCodexRenameInferenceService(
      new OpenAICompatibleRenameInferenceService(config, options?.fetchImpl, options?.requestLogger),
      new CodexRenameInferenceService(config, options?.codexRunner, options?.requestLogger)
    );
  }
  if (config.ai.backend === "openai-compatible") {
    return new OpenAICompatibleRenameInferenceService(config, options?.fetchImpl, options?.requestLogger);
  }

  return new NoneRenameInferenceService(config);
}
