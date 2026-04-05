import type {
  EffectiveConfig,
  MaterializedSession,
  RenameSuggestion
} from "@codex-session-manager/shared";

import { basenameSafe, excerpt, stripControl, toUtcIso } from "./util.js";

function classifyKind(session: MaterializedSession): string {
  const joined = [
    session.firstUserMessage,
    session.lastUserMessage,
    session.lastAgentMessage
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/(fix|bug|错误|修复|异常)/.test(joined)) {
    return "fix";
  }
  if (/(refactor|重构)/.test(joined)) {
    return "refactor";
  }
  if (/(docs|文档|readme)/.test(joined)) {
    return "docs";
  }
  if (/(research|调研|分析|看看|review|compare)/.test(joined)) {
    return "research";
  }
  if (/(feat|新增|实现|增加)/.test(joined)) {
    return "feat";
  }

  return "chore";
}

function buildSummary(session: MaterializedSession, maxLength: number): string {
  const preferred = [
    session.lastUserMessage,
    session.firstUserMessage,
    session.lastAgentMessage
  ];

  for (const candidate of preferred) {
    const value = excerpt(stripControl(candidate), maxLength);
    if (value) {
      return value;
    }
  }

  return session.projectName ?? session.threadId;
}

function formatTime(timestamp: string | undefined, pattern: string): string {
  const date = timestamp ? new Date(timestamp) : new Date();
  const parts: Record<string, string> = {
    "%Y": String(date.getUTCFullYear()),
    "%m": String(date.getUTCMonth() + 1).padStart(2, "0"),
    "%d": String(date.getUTCDate()).padStart(2, "0"),
    "%H": String(date.getUTCHours()).padStart(2, "0"),
    "%M": String(date.getUTCMinutes()).padStart(2, "0")
  };

  let output = pattern;
  for (const [token, value] of Object.entries(parts)) {
    output = output.replaceAll(token, value);
  }

  return output;
}

function renderTemplate(
  template: string,
  session: MaterializedSession,
  fields: { kind: string; summary: string; scope?: string }
): string {
  const scope = fields.scope ?? "";
  const replacements: Record<string, string> = {
    "{{kind}}": fields.kind,
    "{{summary}}": fields.summary,
    "{{scope}}": scope,
    "{{scope_paren}}": scope ? `(${scope})` : "",
    "{{project}}": session.projectName ?? basenameSafe(session.cwd) ?? "",
    "{{cwd_base}}": basenameSafe(session.cwd) ?? ""
  };

  let output = template.replace(/\{\{time:([^}]+)\}\}/g, (_, fmt: string) =>
    formatTime(session.updatedAt ?? session.createdAt, fmt)
  );
  output = output.replace(/\{\{date:([^}]+)\}\}/g, (_, fmt: string) =>
    formatTime(session.updatedAt ?? session.createdAt, fmt)
  );

  for (const [key, value] of Object.entries(replacements)) {
    output = output.replaceAll(key, value);
  }

  return output.replace(/\s+/g, " ").trim();
}

export function suggestNameHeuristically(
  session: MaterializedSession,
  config: EffectiveConfig
): RenameSuggestion {
  const kind = classifyKind(session);
  const summary = buildSummary(session, Math.min(48, config.naming.maxLength));
  const scope = session.projectName && session.projectName !== "fanghaotian"
    ? session.projectName
    : undefined;

  let name = renderTemplate(config.naming.template, session, { kind, summary, scope });
  if (name.length > config.naming.maxLength) {
    name = name.slice(0, config.naming.maxLength).trim();
  }

  return {
    threadId: session.threadId,
    name,
    source: "heuristic",
    kind,
    summary,
    scope,
    generatedAt: toUtcIso()
  };
}

