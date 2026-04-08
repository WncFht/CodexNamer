import type {
  AiBackend,
  AiRequestStatus,
  AiRequestTransport,
  EffectiveConfig,
  MaterializedSession,
  ProviderWireApi,
  RenameContext,
  RenameMode,
  RenameSuggestion
} from "@codex-session-manager/shared";

import {
  composeConfiguredSuggestionName,
  describeNamingBuilderItem,
  getEffectiveNamingBuilder,
  resolveTagDisplayLabel,
  resolveNamingTag
} from "./naming.js";
import { buildRenameContext } from "./rename-context.js";
import { stripControl, toUtcIso } from "./util.js";

type FetchLike = typeof fetch;

type JsonSuggestionPayload = {
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
  suggest(session: MaterializedSession, mode?: RenameMode): Promise<RenameSuggestion>;
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
      | "unsupported-backend"
  ) {
    super(message);
    this.name = "RenameInferenceError";
  }
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

function startRequestLog(
  logger: RenameInferenceRequestLogger | undefined,
  session: MaterializedSession,
  params: {
    backend: Exclude<AiBackend, "none">;
    transport: AiRequestTransport;
    baseUrl?: string;
    model?: string;
    promptChars: number;
    promptText?: string;
    requestPayload?: Record<string, unknown>;
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
      promptText: params.promptText,
      requestPayload: params.requestPayload,
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

function formatPromptSection(title: string, lines: string[], fence = "text"): string {
  return [title, `\`\`\`${fence}`, ...(lines.length > 0 ? lines : ["(none)"]), "```"].join("\n");
}

function formatPairedRenameContextLines(renameContext: RenameContext): string[] {
  const lines: string[] = [];
  let turn = 0;

  for (let index = 0; index < renameContext.segments.length; index += 1) {
    const segment = renameContext.segments[index];
    if (!segment) {
      continue;
    }

    if (segment.source === "paired_previous_assistant") {
      turn += 1;
      lines.push(`turn ${turn}`);
      lines.push("assistant_context");
      lines.push(segment.content);

      const next = renameContext.segments[index + 1];
      if (next?.source === "paired_user_turn") {
        lines.push("");
        lines.push("user");
        lines.push(next.content);
        index += 1;
      }

      if (index < renameContext.segments.length - 1) {
        lines.push("");
      }
      continue;
    }

    if (segment.source === "transcript_seed" || segment.source === "paired_user_turn") {
      turn += 1;
      lines.push(`turn ${turn}`);
      lines.push("user");
      lines.push(segment.content);
      if (index < renameContext.segments.length - 1) {
        lines.push("");
      }
      continue;
    }

    lines.push(`${segment.role} [${segment.source}${segment.timestamp ? ` @ ${segment.timestamp}` : ""}]`);
    lines.push(segment.content);
    if (index < renameContext.segments.length - 1) {
      lines.push("");
    }
  }

  return lines;
}

function formatRenameContextLines(renameContext: RenameContext): string[] {
  if (renameContext.segments.length === 0) {
    return ["(none)"];
  }

  if (renameContext.strategy === "paired-user-turns") {
    return formatPairedRenameContextLines(renameContext);
  }

  return renameContext.segments.flatMap((segment, index) => {
    const header = `${segment.role} [${segment.source}${segment.timestamp ? ` @ ${segment.timestamp}` : ""}]`;
    return index === renameContext.segments.length - 1
      ? [header, segment.content]
      : [header, segment.content, ""];
  });
}

export function buildRenamePrompt(session: MaterializedSession, config: EffectiveConfig): string {
  const renameContext = session.renameContext ?? buildRenameContext(session, config);
  const promptLanguage = /^zh\b/i.test(config.general.uiLanguage) ? "zh-CN" : "en-US";
  const promptInChinese = promptLanguage === "zh-CN";
  const builderSummary = getEffectiveNamingBuilder(config)
    .map((item, index) => `${index + 1}. ${describeNamingBuilderItem(item, promptLanguage)}`)
    .join("\n");
  const tagLines = config.naming.tags.map((tag) => {
    const label = resolveTagDisplayLabel(tag, promptLanguage);
    const descriptor =
      normalizePromptField(tag.description, 120) ||
      normalizePromptField(tag.promptHint, 120) ||
      "";
    return descriptor ? `- ${tag.id} => ${label} | ${descriptor}` : `- ${tag.id} => ${label}`;
  });
  if (promptInChinese) {
    const promptOverrideDetails = config.naming.customPrompt?.trim()
      ? [
          "当前启用了 Prompt 覆写模式。请把下面这段覆写文本视为最高优先级命名规则，同时仍然遵守只返回 JSON、最大长度和结构化字段约束。",
          "自定义命名覆写：",
          config.naming.customPrompt.trim()
        ]
      : ["当前启用了 Prompt 覆写模式，但没有配置覆写文本；请回退到结构化命名规则。"];
    const structuredGuidance =
      "当前启用结构化命名模式。请返回结构化字段，调用方会根据命名构建器组装最终标题。如果某个 tag 预设明显匹配，就把 tagId 设为对应 id；否则留空。";

    const builderSection = formatPromptSection("## 命名构建器", builderSummary ? builderSummary.split("\n") : []);
    const sessionSection = formatPromptSection(
      "## 会话元信息",
      [
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
        `namingCompositionMode: ${config.naming.compositionMode}`,
        `tagIds: ${config.naming.tags.map((tag) => tag.id).join(", ") || "(none)"}`,
        `firstUserMessage: ${normalizePromptField(session.firstUserMessage, 600)}`,
        `lastUserMessage: ${normalizePromptField(session.lastUserMessage, 600)}`,
        `lastAgentMessage: ${normalizePromptField(session.lastAgentMessage, 900)}`,
        `taskCompleteCount: ${session.taskCompleteCount}`,
        `tokenTotal: ${session.tokenTotal}`
      ]
    );
    const contextSection = formatPromptSection("## Rename context", formatRenameContextLines(renameContext), "conversation");
    const tagSection = formatPromptSection("## Tag 预设", tagLines);
    const overrideSection =
      config.naming.compositionMode === "prompt-override"
        ? formatPromptSection("## 自定义命名覆写", promptOverrideDetails.slice(1))
        : "";

    return [
      "你要为 Codex Session Manager 生成一个用于会话列表的命名建议。",
      "只返回一个 JSON 对象，键包括：name, kind, summary, scope, tagId。",
      "不要查看文件，不要运行命令，也不要依赖仓库外部信息。",
      "只能使用下面给出的会话上下文。",
      `Prompt 语言：中文。`,
      `标题目标语言：${config.naming.language}。`,
      `最终标题最大长度：${config.naming.maxLength}。`,
      "标题要具体，能体现主子系统以及实际动作、问题或评审焦点。",
      "如果会话有两个紧密相关的目标，可以补一个很短的次级片段，但不要退化成空泛大类词。",
      config.naming.compositionMode === "structured" ? structuredGuidance : promptOverrideDetails[0],
      "允许的 kind 值：feat, fix, debug, refactor, docs, research, review, design, migration, test, chore, ops。",
      "",
      builderSection,
      "",
      sessionSection,
      "",
      contextSection,
      "",
      tagSection,
      ...(overrideSection ? ["", overrideSection] : [])
    ].join("\n");
  }

  const promptOverrideDetails = config.naming.customPrompt?.trim()
    ? [
        "Custom prompt override mode is active. Treat the override below as the highest-priority naming policy while still obeying the JSON-only response contract, max length, and structured fields.",
        "Custom naming override:",
        config.naming.customPrompt.trim()
      ]
    : ["Prompt override mode is active, but no custom override text is configured. Fall back to the structured naming policy."];
  const structuredGuidance =
    "Structured naming mode is active. Return structured fields that the caller can assemble into the final title from the naming builder. When one configured tag preset clearly fits, set tagId to the matching preset id; otherwise leave tagId empty.";

  const builderSection = formatPromptSection("## Naming builder", builderSummary ? builderSummary.split("\n") : []);
  const sessionSection = formatPromptSection(
    "## Session metadata",
    [
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
      `namingCompositionMode: ${config.naming.compositionMode}`,
      `tagIds: ${config.naming.tags.map((tag) => tag.id).join(", ") || "(none)"}`,
      `firstUserMessage: ${normalizePromptField(session.firstUserMessage, 600)}`,
      `lastUserMessage: ${normalizePromptField(session.lastUserMessage, 600)}`,
      `lastAgentMessage: ${normalizePromptField(session.lastAgentMessage, 900)}`,
      `taskCompleteCount: ${session.taskCompleteCount}`,
      `tokenTotal: ${session.tokenTotal}`
    ]
  );
  const contextSection = formatPromptSection("## Rename context", formatRenameContextLines(renameContext), "conversation");
  const tagSection = formatPromptSection("## Tag presets", tagLines);
  const overrideSection =
    config.naming.compositionMode === "prompt-override"
      ? formatPromptSection("## Custom naming override", promptOverrideDetails.slice(1))
      : "";

  return [
    "You generate a session rename suggestion for Codex Session Manager.",
    "Return only a JSON object with keys: name, kind, summary, scope, tagId.",
    "Do not inspect files, do not run shell commands, and do not rely on repository context.",
    "Use only the session context provided below.",
    "Prompt language: English.",
    `Target title language: ${config.naming.language}.`,
    `Max final name length: ${config.naming.maxLength}.`,
    "Prefer a short but specific summary suitable for a session list.",
    "Make the rename concrete: capture the main subsystem plus the actual action, issue, or review focus.",
    "If the session has two tightly related goals, use one short secondary fragment rather than a generic umbrella noun.",
    config.naming.compositionMode === "structured" ? structuredGuidance : promptOverrideDetails[0],
    "Allowed kind values: feat, fix, debug, refactor, docs, research, review, design, migration, test, chore, ops.",
    "",
    builderSection,
    "",
    sessionSection,
    "",
    contextSection,
    "",
    tagSection,
    ...(overrideSection ? ["", overrideSection] : [])
  ].join("\n");
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
      scope: typeof parsed.scope === "string" ? parsed.scope : undefined,
      tagId: typeof parsed.tagId === "string" ? parsed.tagId : undefined
    };
  } catch {
    return undefined;
  }
}

function composeAiSuggestion(
  payload: JsonSuggestionPayload,
  session: MaterializedSession,
  config: EffectiveConfig,
  metadata: Record<string, string>
): {
  suggestion: RenameSuggestion;
  result: NonNullable<Parameters<NonNullable<RenameInferenceRequestLogger>["finish"]>[0]["result"]>;
} {
  const kind = stripControl(payload.kind)?.trim();
  const summary = stripControl(payload.summary)?.trim();
  if (!kind || !summary) {
    throw new RenameInferenceError("Model output is missing required `kind` or `summary` fields.", "missing-fields");
  }

  const scope = stripControl(payload.scope)?.trim() || undefined;
  const explicitName = stripControl(payload.name)?.trim() || undefined;
  const resolvedTag = resolveNamingTag(config.naming.tags, payload.tagId, config.naming.language);
  const rawName = composeConfiguredSuggestionName(session, config, {
    kind,
    summary,
    scope,
    tagId: resolvedTag?.id,
    explicitName
  });
  const name = rawName.slice(0, Math.max(1, config.naming.maxLength)).trim();
  const suggestion: RenameSuggestion = {
    threadId: session.threadId,
    name,
    source: "ai",
    style: "detailed",
    kind,
    summary,
    scope,
    tagId: resolvedTag?.id,
    generatedAt: toUtcIso(),
    metadata
  };

  return {
    suggestion,
    result: {
      parsedModelOutput: {
        name: explicitName,
        kind,
        summary,
        scope,
        tagId: resolvedTag?.id ?? payload.tagId
      },
      finalSuggestion: suggestion,
      composition: {
        mode: config.naming.compositionMode,
        builder: getEffectiveNamingBuilder(config),
        explicitName,
        tagLabel: resolvedTag ? resolveTagDisplayLabel(resolvedTag, config.naming.language) : undefined,
        finalName: name
      }
    }
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
  const useManualConfig = config.ai.providerSource === "manual";

  const inheritedProviderRef =
    config.inheritedCodex.modelProvider;
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
    useManualConfig
      ? explicitApiKey || explicitApiKeyRef
      : inheritedEnvApiKey || inheritedAuthApiKey || envOpenAiApiKey || inheritedAccessToken;
  const credentialKind =
    useManualConfig
      ? explicitApiKey || explicitApiKeyRef
        ? "api-key"
        : undefined
      : inheritedEnvApiKey || inheritedAuthApiKey || envOpenAiApiKey
        ? "api-key"
        : inheritedAccessToken
          ? "bearer-token"
          : undefined;
  const credentialSource = useManualConfig
    ? explicitApiKey
      ? "explicit-api-key"
      : explicitApiKeyRef
        ? "explicit-env-ref"
        : undefined
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
    baseUrl: useManualConfig ? explicit.baseUrl : inherited?.baseUrl,
    model: useManualConfig ? explicit.model : config.inheritedCodex.model,
    credentialValue,
    credentialKind,
    credentialSource,
    headers: useManualConfig ? { ...(explicit.headers ?? {}) } : { ...(inherited?.headers ?? {}) },
    providerRef: useManualConfig ? explicit.providerRef : inheritedProviderRef,
    requestType:
      useManualConfig
        ? explicit.requestType ?? (config.ai.backend === "none" ? "responses" : config.ai.backend)
        : inherited?.wireApi ?? (config.ai.backend === "none" ? "responses" : config.ai.backend),
    requiresOpenaiAuth: inherited?.requiresOpenaiAuth ?? false,
    requestedBackend:
      useManualConfig
        ? explicit.requestType ?? (config.ai.backend === "none" ? "responses" : config.ai.backend)
        : inherited?.wireApi ?? (config.ai.backend === "none" ? "responses" : config.ai.backend)
  };
}

export function resolveRenameProvider(config: EffectiveConfig): Omit<ResolvedProvider, "credentialValue"> & {
  credentialValue?: string;
} | undefined {
  const provider = resolveProfile(config);
  return provider ? { ...provider } : undefined;
}

export function inspectRenameProvider(config: EffectiveConfig): ProviderDiagnostics {
  const configuredBackend = config.ai.backend;
  if (configuredBackend === "none") {
    return {
      configuredBackend: "none",
      requestedBackend: "none",
      hasCredential: false,
      preferredTransport: "none",
      canDirectHttp: false
      };
  }

  const provider = resolveProfile(config);
  if (!provider) {
    return {
      configuredBackend,
      requestedBackend: configuredBackend,
      hasCredential: false,
      preferredTransport: "http",
      canDirectHttp: false
    };
  }

  const canDirectHttp = Boolean(provider.baseUrl && provider.model && provider.credentialValue);
  return {
    configuredBackend,
    requestedBackend: provider.requestedBackend,
    profileId: provider.profileId,
    providerRef: provider.providerRef,
    baseUrl: provider.baseUrl,
    model: provider.model,
    requestType: provider.requestType,
    requiresOpenaiAuth: provider.requiresOpenaiAuth,
    credentialKind: provider.credentialKind,
    credentialSource: provider.credentialSource,
    hasCredential: Boolean(provider.credentialValue),
    preferredTransport: canDirectHttp ? "http" : "none",
    canDirectHttp
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
): Promise<{ text: string; payload: Record<string, unknown>; logContext: { id?: number; startedAtMs: number } }> {
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

async function callChatCompletionsApi(
  fetchImpl: FetchLike,
  provider: ResolvedProvider,
  config: EffectiveConfig,
  prompt: string,
  session: MaterializedSession,
  logger?: RenameInferenceRequestLogger
): Promise<{ text: string; payload: Record<string, unknown>; logContext: { id?: number; startedAtMs: number } }> {
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

async function executeProviderRequest(
  fetchImpl: FetchLike,
  provider: ResolvedProvider,
  config: EffectiveConfig,
  prompt: string,
  session: MaterializedSession,
  logger?: RenameInferenceRequestLogger
): Promise<{ text: string; payload: Record<string, unknown>; logContext: { id?: number; startedAtMs: number } }> {
  if (provider.requestType === "responses") {
    return callResponsesApi(fetchImpl, provider, config, prompt, session, logger);
  }
  return callChatCompletionsApi(fetchImpl, provider, config, prompt, session, logger);
}

function buildProviderProbeSession(testedAt: string, config: EffectiveConfig): MaterializedSession {
  return {
    threadId: "provider-test",
    rolloutPath: "<provider-test>",
    cwd: process.cwd(),
    projectName: "provider-test",
    createdAt: testedAt,
    updatedAt: testedAt,
    modelProvider: config.inheritedCodex.modelProvider,
    model: config.inheritedCodex.model,
    firstUserMessage: "为当前会话生成一个简短、清晰的中文标题。",
    lastUserMessage: "请测试当前 AI rename provider 是否可用，并按结构化字段返回结果。",
    lastAgentMessage: "这是 provider test 的 synthetic rename 会话。",
    taskCompleteCount: 1,
    tokenTotal: 128
  };
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

async function executeStreamingProviderRequest(
  fetchImpl: FetchLike,
  provider: ResolvedProvider,
  config: EffectiveConfig,
  prompt: string
): Promise<string> {
  const headers = buildProviderAuthHeaders(provider);

  if (provider.requestType === "responses") {
    const response = await fetchImpl(buildResponsesUrl(provider.baseUrl!), {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(config.ai.timeoutSeconds * 1000),
      body: JSON.stringify({
        model: provider.model,
        temperature: config.ai.temperature,
        input: prompt,
        stream: true
      })
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${raw.slice(0, 400)}`);
    }
    return extractResponsesStreamText(raw);
  }

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
            "You generate concise but specific session names. Return JSON only with keys: name, kind, summary, scope, tagId."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      stream: true
    })
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${raw.slice(0, 400)}`);
  }
  return extractChatCompletionStreamText(raw);
}

export async function probeRenameProvider(
  config: EffectiveConfig,
  options?: {
    fetchImpl?: FetchLike;
  }
): Promise<{
  ok: boolean;
  testedAt: string;
  latencyMs?: number;
  diagnostics: ProviderDiagnostics;
  responseText?: string;
  error?: string;
}> {
  const diagnostics = inspectRenameProvider(config);
  const testedAt = toUtcIso();
  if (config.ai.backend === "none") {
    return {
      ok: false,
      testedAt,
      diagnostics,
      error: "AI rename is disabled."
    };
  }

  const provider = resolveProfile(config);
  if (!provider || !provider.baseUrl || !provider.model) {
    return {
      ok: false,
      testedAt,
      diagnostics,
      error: "Provider is missing base URL or model."
    };
  }
  if (!provider.credentialValue) {
    return {
      ok: false,
      testedAt,
      diagnostics,
      error: "Provider is missing an API key or bearer token."
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
      responseText: suggestion.name
    };
  } catch (error) {
    if (
      error instanceof RenameInferenceError &&
      (error.code === "empty-response" || error.code === "invalid-json")
    ) {
      try {
        const prompt = buildRenamePrompt(probeSession, config);
        const streamText = await executeStreamingProviderRequest(fetchImpl, provider, config, prompt);
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
          authSource: provider.credentialSource ?? ""
        });
        return {
          ok: true,
          testedAt,
          latencyMs: Date.now() - startedAtMs,
          diagnostics,
          responseText: composed.suggestion.name
        };
      } catch (streamError) {
        return {
          ok: false,
          testedAt,
          latencyMs: Date.now() - startedAtMs,
          diagnostics,
          error: streamError instanceof Error ? streamError.message : "Unknown error"
        };
      }
    }
    return {
      ok: false,
      testedAt,
      latencyMs: Date.now() - startedAtMs,
      diagnostics,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

export class OpenAICompatibleRenameInferenceService implements RenameInferenceService {
  constructor(
    private readonly config: EffectiveConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly requestLogger?: RenameInferenceRequestLogger
  ) {}

  async suggest(session: MaterializedSession, _mode?: RenameMode): Promise<RenameSuggestion> {
    if (this.config.ai.backend === "none") {
      throw new RenameInferenceError("AI rename is disabled.", "unsupported-backend");
    }

    const provider = resolveProfile(this.config);
    if (!provider || !provider.baseUrl || !provider.model) {
      throw new RenameInferenceError("Provider is missing base URL or model.", "provider-misconfigured");
    }
    if (!provider.credentialValue) {
      throw new RenameInferenceError("Provider is missing an API key or bearer token.", "missing-auth");
    }

    const prompt = buildRenamePrompt(session, this.config);
    let response:
      | { text: string; payload: Record<string, unknown>; logContext: { id?: number; startedAtMs: number } }
      | undefined;
    try {
      response = await executeProviderRequest(
        this.fetchImpl,
        provider,
        this.config,
        prompt,
        session,
        this.requestLogger
      );
      let responseText = response.text;
      let parsedModelOutput = extractFirstJsonObject(responseText);
      const finishMetadata: Record<string, string> = {};

      if (!responseText.trim() || !parsedModelOutput) {
        const fallbackReason = !responseText.trim() ? "empty-response" : "invalid-json";
        const streamText = await executeStreamingProviderRequest(this.fetchImpl, provider, this.config, prompt);
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

      const composed = composeAiSuggestion(parsedModelOutput, session, this.config, {
        backend: provider.requestedBackend,
        profile: provider.profileId,
        providerRef: provider.providerRef ?? "",
        requestType: provider.requestType,
        authKind: provider.credentialKind ?? "",
        authSource: provider.credentialSource ?? ""
      });
      finishRequestLog(this.requestLogger, response.logContext, {
        status: "succeeded",
        responseChars: responseText.length,
        responseText,
        responsePayload: response.payload,
        result: composed.result,
        metadata: Object.keys(finishMetadata).length > 0 ? finishMetadata : undefined
      });
      return composed.suggestion;
    } catch (error) {
      if (response) {
        const metadata =
          error instanceof RenameInferenceError && (error.code === "empty-response" || error.code === "invalid-json")
            ? {
                responseMode: "sse-fallback-failed",
                sseFallbackReason: error.code
              }
            : undefined;
        finishRequestLog(this.requestLogger, response.logContext, {
          status: "failed",
          responseChars: response.text.length,
          responseText: response.text,
          responsePayload: response.payload,
          error: error instanceof Error ? error.message : "Unknown provider request failure.",
          metadata
        });
      }
      if (error instanceof RenameInferenceError) {
        throw error;
      }
      throw new RenameInferenceError(
        error instanceof Error ? error.message : "Unknown provider request failure.",
        "request-failed"
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
  }
): RenameInferenceService {
  return new OpenAICompatibleRenameInferenceService(config, options?.fetchImpl, options?.requestLogger);
}
