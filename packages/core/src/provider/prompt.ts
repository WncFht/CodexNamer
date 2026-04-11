import type { EffectiveConfig, MaterializedSession, RenameContext, RenameSuggestion } from "@codexnamer/shared";

import {
  composeConfiguredSuggestionName,
  describeNamingBuilderItem,
  getEffectiveNamingBuilder,
  resolveTagDisplayLabel,
  resolveNamingTag
} from "../naming.js";
import { buildRenameContext } from "../rename-context.js";
import { stripControl, toUtcIso } from "../util.js";
import type { JsonSuggestionPayload, RequestLogResult } from "./shared.js";
import { RenameInferenceError } from "./shared.js";

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
  return [title, "```" + fence, ...(lines.length > 0 ? lines : ["(none)"]), "```"].join("\n");
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
    const descriptor = normalizePromptField(tag.description, 120) || normalizePromptField(tag.promptHint, 120) || "";
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
      "你要为 CodexNamer 生成一个用于会话列表的命名建议。",
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
    "You generate a session rename suggestion for CodexNamer.",
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

export function extractFirstJsonObject(text: string): JsonSuggestionPayload | undefined {
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

export function composeAiSuggestion(
  payload: JsonSuggestionPayload,
  session: MaterializedSession,
  config: EffectiveConfig,
  metadata: Record<string, string>
): {
  suggestion: RenameSuggestion;
  result: RequestLogResult;
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

export function buildProviderProbeSession(testedAt: string, config: EffectiveConfig): MaterializedSession {
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
