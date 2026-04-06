import type {
  EffectiveConfig,
  MaterializedSession,
  NamingTagDefinition,
  NamingStyle,
  RenameSuggestion
} from "@codex-session-manager/shared";

import { buildRenameContext } from "./rename-context.js";
import { basenameSafe, excerpt, normalizeWhitespace, stripControl, toUtcIso } from "./util.js";

type TopicRule = {
  scope: string;
  zh: string;
  en: string;
  patterns: RegExp[];
};

const KIND_RULES: Array<{ kind: string; patterns: RegExp[] }> = [
  {
    kind: "fix",
    patterns: [/(fix|修复|bug|报错|错误|异常|失效|不生效|不能|无法)/i]
  },
  {
    kind: "debug",
    patterns: [/(debug|排查|定位|trace|诊断)/i]
  },
  {
    kind: "review",
    patterns: [/(review|审查|梳理|盘点|对齐|现状|逻辑|流程)/i]
  },
  {
    kind: "design",
    patterns: [/(design|方案|架构|策略|更具体|更复杂|细节|summary|scope|prompt)/i]
  },
  {
    kind: "research",
    patterns: [/(research|调研|分析|评估|compare|对比|看看)/i]
  },
  {
    kind: "migration",
    patterns: [/(migrat|迁移|升级|upgrade|切换|替换|兼容)/i]
  },
  {
    kind: "refactor",
    patterns: [/(refactor|重构|整理代码|整理逻辑)/i]
  },
  {
    kind: "test",
    patterns: [/(test|测试|验证|冒烟|回归)/i]
  },
  {
    kind: "docs",
    patterns: [/(docs|文档|readme|说明)/i]
  },
  {
    kind: "ops",
    patterns: [/(deploy|运维|部署|发布|重启|值班|环境)/i]
  },
  {
    kind: "feat",
    patterns: [/(feat|实现|新增|接入|补齐|支持|增加)/i]
  }
];

const TOPIC_RULES: TopicRule[] = [
  {
    scope: "settings",
    zh: "Web 设置",
    en: "web settings",
    patterns: [/(web|页面|ui)/i, /(setting|settings|配置|config)/i]
  },
  {
    scope: "settings",
    zh: "设置",
    en: "settings",
    patterns: [/(setting|settings|配置|config)/i]
  },
  {
    scope: "rename",
    zh: "自动重命名逻辑",
    en: "auto rename flow",
    patterns: [/(auto[\s-]?rename|自动重命名|rename)/i, /(逻辑|流程|策略|状态|行为)/i]
  },
  {
    scope: "naming",
    zh: "命名细节",
    en: "naming detail",
    patterns: [/(name|命名)/i, /(更具体|更复杂|细节|summary|scope|标题)/i]
  },
  {
    scope: "context",
    zh: "rename context",
    en: "rename context",
    patterns: [/(context|上下文|transcript|对话记录)/i]
  },
  {
    scope: "prompt",
    zh: "AI prompt",
    en: "AI prompt",
    patterns: [/(prompt)/i]
  },
  {
    scope: "provider",
    zh: "provider 配置",
    en: "provider config",
    patterns: [/(provider|base url|api key|wire api|model provider)/i]
  },
  {
    scope: "workspace",
    zh: "工作区",
    en: "workspace",
    patterns: [/(workspace|工作区)/i]
  },
  {
    scope: "history",
    zh: "会话历史",
    en: "session history",
    patterns: [/(history|历史|timeline|会话历史)/i]
  },
  {
    scope: "tests",
    zh: "测试",
    en: "tests",
    patterns: [/(test|测试|vitest|jest|冒烟|回归)/i]
  },
  {
    scope: "build",
    zh: "构建",
    en: "build",
    patterns: [/(build|构建|编译|tsc)/i]
  },
  {
    scope: "docs",
    zh: "文档",
    en: "docs",
    patterns: [/(docs|文档|readme|说明)/i]
  },
  {
    scope: "web",
    zh: "Web",
    en: "web",
    patterns: [/(web|浏览器|页面|frontend)/i]
  },
  {
    scope: "tui",
    zh: "TUI",
    en: "TUI",
    patterns: [/(tui|终端界面)/i]
  },
  {
    scope: "api",
    zh: "API",
    en: "API",
    patterns: [/(api|fastify|endpoint|路由)/i]
  },
  {
    scope: "daemon",
    zh: "daemon",
    en: "daemon",
    patterns: [/(daemon|watcher|后台)/i]
  }
];

const BUILTIN_TAG_LABELS: Record<
  string,
  {
    zh: string;
    en: string;
  }
> = {
  settings: { zh: "设置", en: "settings" },
  rename: { zh: "命名", en: "rename" },
  context: { zh: "上下文", en: "context" },
  prompt: { zh: "Prompt", en: "prompt" },
  provider: { zh: "Provider", en: "provider" },
  daemon: { zh: "Daemon", en: "daemon" },
  history: { zh: "历史", en: "history" },
  tests: { zh: "测试", en: "tests" },
  docs: { zh: "文档", en: "docs" },
  workspace: { zh: "工作区", en: "workspace" }
};

function prefersChinese(language: string): boolean {
  return /^zh\b/i.test(language);
}

export function resolveTagDisplayLabel(tag: NamingTagDefinition, language: string): string {
  const explicit = normalizeTaskText(tag.label);
  if (explicit) {
    return explicit;
  }

  const builtin = BUILTIN_TAG_LABELS[tag.id];
  if (builtin) {
    return prefersChinese(language) ? builtin.zh : builtin.en;
  }

  return tag.id;
}

function extractTagKeywords(tag: NamingTagDefinition): string[] {
  const combined = [tag.id, tag.label, tag.description, tag.promptHint]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
  const matches = combined.match(/[\u4e00-\u9fff]{1,}|[A-Za-z0-9_-]{2,}/g) ?? [];
  return Array.from(new Set(matches.map((value) => value.toLowerCase())));
}

export function resolveNamingStyle(
  session: Pick<MaterializedSession, "namingStyle"> | undefined,
  config: Pick<EffectiveConfig, "naming">
): NamingStyle {
  return session?.namingStyle ?? config.naming.defaultStyle;
}

function normalizeTaskText(value?: string): string | undefined {
  const stripped = normalizeWhitespace(stripControl(value));
  if (!stripped) {
    return undefined;
  }

  return stripped
    .replace(/[❮]/g, " ")
    .replace(/\btopic[s]?:?/gi, " ")
    .replace(/\b\d+[.)、:：]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectTaskTexts(session: MaterializedSession): Array<{ text: string; weight: number }> {
  const renameContext = session.renameContext;
  const latestTranscriptUser = renameContext?.segments
    .slice()
    .reverse()
    .find((segment) => segment.role === "user")?.content;
  const latestTranscriptAssistant = renameContext?.segments
    .slice()
    .reverse()
    .find((segment) => segment.role === "assistant")?.content;
  const sources = [
    { text: session.lastUserMessage, weight: 8 },
    { text: latestTranscriptUser, weight: 7 },
    { text: session.firstUserMessage, weight: 5 },
    { text: latestTranscriptAssistant, weight: 3 },
    { text: session.lastAgentMessage, weight: 2 },
    { text: renameContext?.text, weight: 1 }
  ];

  return sources
    .map((source) => ({
      text: normalizeTaskText(source.text) ?? "",
      weight: source.weight
    }))
    .filter((item) => item.text.length > 0);
}

function classifyKind(session: MaterializedSession): string {
  const joined = collectTaskTexts(session)
    .map((item) => item.text)
    .join(" ")
    .toLowerCase();

  for (const rule of KIND_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(joined))) {
      return rule.kind;
    }
  }

  return "chore";
}

function kindActionLabel(kind: string, language: string, secondary = false): string {
  const zhPrimary: Record<string, string> = {
    fix: "修复",
    debug: "排查",
    review: "梳理",
    design: "设计",
    research: "调研",
    migration: "迁移",
    refactor: "重构",
    test: "验证",
    docs: "撰写",
    ops: "处理",
    feat: "实现",
    chore: "处理"
  };
  const zhSecondary: Record<string, string> = {
    fix: "并梳理",
    debug: "并定位",
    review: "并校准",
    design: "并增强",
    research: "并补充",
    migration: "并适配",
    refactor: "并整理",
    test: "并回归",
    docs: "并补齐",
    ops: "并清理",
    feat: "并补齐",
    chore: "并处理"
  };
  const enPrimary: Record<string, string> = {
    fix: "fix",
    debug: "debug",
    review: "review",
    design: "design",
    research: "research",
    migration: "migrate",
    refactor: "refactor",
    test: "verify",
    docs: "document",
    ops: "operate",
    feat: "implement",
    chore: "handle"
  };
  const enSecondary: Record<string, string> = {
    fix: "and review",
    debug: "and inspect",
    review: "and align",
    design: "and refine",
    research: "and expand",
    migration: "and adapt",
    refactor: "and tidy",
    test: "and regress",
    docs: "and extend",
    ops: "and clean up",
    feat: "and cover",
    chore: "and handle"
  };

  if (prefersChinese(language)) {
    return (secondary ? zhSecondary : zhPrimary)[kind] ?? (secondary ? "并处理" : "处理");
  }

  return (secondary ? enSecondary : enPrimary)[kind] ?? (secondary ? "and handle" : "handle");
}

function detectTopics(session: MaterializedSession, language: string): Array<{ scope: string; label: string; score: number }> {
  const scores = new Map<string, { scope: string; label: string; score: number }>();

  for (const source of collectTaskTexts(session)) {
    for (const rule of TOPIC_RULES) {
      if (rule.patterns.every((pattern) => pattern.test(source.text))) {
        const key = `${rule.scope}:${prefersChinese(language) ? rule.zh : rule.en}`;
        const existing = scores.get(key);
        if (existing) {
          existing.score += source.weight + rule.patterns.length;
        } else {
          scores.set(key, {
            scope: rule.scope,
            label: prefersChinese(language) ? rule.zh : rule.en,
            score: source.weight + rule.patterns.length
          });
        }
      }
    }
  }

  return Array.from(scores.values()).sort((left, right) => right.score - left.score);
}

function detectNamingTag(
  session: MaterializedSession,
  config: EffectiveConfig
): NamingTagDefinition | undefined {
  if (config.naming.tags.length === 0) {
    return undefined;
  }

  const textSources = collectTaskTexts(session);
  const topicMatches = detectTopics(session, config.naming.language);
  const topicKeys = new Set<string>();
  for (const topic of topicMatches) {
    topicKeys.add(topic.scope.toLowerCase());
    topicKeys.add(topic.label.toLowerCase());
  }

  let best:
    | {
        tag: NamingTagDefinition;
        score: number;
      }
    | undefined;

  for (const tag of config.naming.tags) {
    const keywords = extractTagKeywords(tag);
    if (keywords.length === 0) {
      continue;
    }

    let score = 0;
    for (const source of textSources) {
      const haystack = source.text.toLowerCase();
      for (const keyword of keywords) {
        if (!haystack.includes(keyword)) {
          continue;
        }
        score += source.weight + Math.min(keyword.length, 8);
      }
    }

    if (topicKeys.has(tag.id.toLowerCase())) {
      score += 12;
    }
    if (topicMatches.some((topic) => resolveTagDisplayLabel(tag, config.naming.language).toLowerCase() === topic.label.toLowerCase())) {
      score += 10;
    }

    if (score <= 0) {
      continue;
    }

    if (!best || score > best.score) {
      best = {
        tag,
        score
      };
    }
  }

  return best?.tag;
}

function detectIssueSuffix(joined: string, language: string): string | undefined {
  if (/(save|保存)/i.test(joined) && /(重置|reset|不能|无法|失败|不生效)/i.test(joined)) {
    return prefersChinese(language) ? "保存问题" : "save issue";
  }
  if (/(显示|展示|加载|刷新|render|display)/i.test(joined) && /(不能|无法|失败|异常|卡住|重置)/i.test(joined)) {
    return prefersChinese(language) ? "显示问题" : "display issue";
  }
  if (/(不能|无法|失败|异常|报错|重置|失效|不生效|不可)/i.test(joined)) {
    return prefersChinese(language) ? "问题" : "issue";
  }
  return undefined;
}

function composeFragment(action: string, topic: string, language: string, suffix?: string): string {
  if (prefersChinese(language)) {
    return `${action}${topic}${suffix ?? ""}`.trim();
  }

  return [action, topic, suffix].filter(Boolean).join(" ").trim();
}

function fallbackExcerptSummary(session: MaterializedSession, maxLength: number): string {
  const renameContext = session.renameContext;
  const latestTranscriptUser = renameContext?.segments
    .slice()
    .reverse()
    .find((segment) => segment.role === "user")?.content;
  const latestTranscriptAssistant = renameContext?.segments
    .slice()
    .reverse()
    .find((segment) => segment.role === "assistant")?.content;
  const preferred = [
    latestTranscriptUser,
    session.lastUserMessage,
    latestTranscriptAssistant,
    session.firstUserMessage,
    session.lastAgentMessage,
    renameContext?.text
  ];

  for (const candidate of preferred) {
    const value = excerpt(normalizeTaskText(candidate), maxLength);
    if (value) {
      return value;
    }
  }

  return session.projectName ?? session.threadId;
}

function removeDuplicateFocus(summary: string, focus: string): boolean {
  const comparableSummary = summary.toLowerCase();
  const comparableFocus = focus.toLowerCase();
  return comparableFocus.length === 0 || comparableSummary.includes(comparableFocus);
}

function normalizeFocusClause(value: string | undefined): string | undefined {
  const normalized = normalizeTaskText(value);
  if (!normalized) {
    return undefined;
  }

  const cleaned = normalized
    .replace(
      /^(请你|请先|请|帮我|帮忙|麻烦|看看|看下|先把|先|现在|然后|另外|以及|需要|希望|我希望|我觉得|我发现|能不能|可以|要不要|你先)\s*/gi,
      ""
    )
    .replace(/\b(topic|session|rename)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || undefined;
}

function chooseConcreteFocus(session: MaterializedSession, language: string): string | undefined {
  const renameContext = session.renameContext;
  const latestTranscriptUser = renameContext?.segments
    .slice()
    .reverse()
    .find((segment) => segment.role === "user")?.content;
  const candidates = [
    session.lastUserMessage,
    latestTranscriptUser,
    session.firstUserMessage,
    session.lastAgentMessage
  ];

  const clauses = candidates
    .flatMap((candidate) => {
      const normalized = normalizeFocusClause(candidate);
      if (!normalized) {
        return [];
      }
      return normalized
        .split(/(?:[，,。；;！？!?]| 然后 | 并且 | 同时 | 以及 )+/)
        .map((part) => normalizeFocusClause(part))
        .filter((value): value is string => Boolean(value));
    })
    .map((value) => {
      const identifierBonus = /[`"'_-]|[A-Za-z]+\d*|[A-Za-z]+-[A-Za-z]+/.test(value) ? 8 : 0;
      const configBonus = /(config|setting|provider|prompt|context|daemon|rename|history|apply|auto|默认|详细|简略|配置|命名|上下文|自动)/i.test(
        value
      )
        ? 6
        : 0;
      return {
        value,
        score: Math.min(value.length, prefersChinese(language) ? 36 : 52) + identifierBonus + configBonus
      };
    })
    .sort((left, right) => right.score - left.score);

  const focus = clauses[0]?.value;
  if (!focus) {
    return undefined;
  }

  return excerpt(focus, prefersChinese(language) ? 20 : 30);
}

function buildSummary(
  session: MaterializedSession,
  kind: string,
  maxLength: number,
  language: string,
  style: NamingStyle
): string {
  const topics = detectTopics(session, language);
  const joined = collectTaskTexts(session)
    .map((item) => item.text)
    .join(" ");
  const primary = topics[0];
  const secondary = topics.find((topic) => topic.scope !== primary?.scope);
  const issueSuffix = detectIssueSuffix(joined, language);

  if (!primary) {
    return fallbackExcerptSummary(session, maxLength);
  }

  const primarySuffix =
    kind === "fix" || kind === "debug"
      ? issueSuffix
      : undefined;
  const fragments = [
    composeFragment(kindActionLabel(kind, language), primary.label, language, primarySuffix)
  ];

  if (secondary) {
    fragments.push(composeFragment(kindActionLabel(kind, language, true), secondary.label, language));
  }

  const joinedSummary = prefersChinese(language)
    ? fragments.join("")
    : fragments.join(" ");

  if (style === "brief") {
    return excerpt(joinedSummary, maxLength) ?? fallbackExcerptSummary(session, maxLength);
  }

  const focus = chooseConcreteFocus(session, language);
  if (!focus || removeDuplicateFocus(joinedSummary, focus)) {
    return excerpt(joinedSummary, maxLength) ?? fallbackExcerptSummary(session, maxLength);
  }

  const detailedSummary = prefersChinese(language)
    ? `${joinedSummary}，聚焦${focus}`
    : `${joinedSummary}; focus ${focus}`;
  return excerpt(detailedSummary, maxLength) ?? excerpt(joinedSummary, maxLength) ?? fallbackExcerptSummary(session, maxLength);
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

function renderStructuredName(
  session: MaterializedSession,
  config: EffectiveConfig,
  fields: {
    kind: string;
    summary: string;
    scope?: string;
    tag?: NamingTagDefinition;
  }
): string {
  const parts = config.naming.components
    .map((component) => {
      switch (component) {
        case "tag":
          return fields.tag ? `#${resolveTagDisplayLabel(fields.tag, config.naming.language)}` : undefined;
        case "kind":
          return fields.kind;
        case "scope":
          return fields.scope;
        case "summary":
          return fields.summary;
        case "project":
          return session.projectName ?? basenameSafe(session.cwd) ?? undefined;
        default:
          return undefined;
      }
    })
    .filter((value): value is string => Boolean(value && value.trim().length > 0));

  const separator = config.naming.componentSeparator || " · ";
  if (parts.length === 0) {
    return renderTemplate(config.naming.template, session, fields);
  }

  return parts.join(separator).replace(/\s+/g, " ").trim();
}

export function suggestNameHeuristically(
  session: MaterializedSession,
  config: EffectiveConfig
): RenameSuggestion {
  const renameContext = session.renameContext ?? buildRenameContext(session, config);
  const style = resolveNamingStyle(session, config);
  const materialized = {
    ...session,
    renameContext
  };
  const kind = classifyKind(materialized);
  const summary = buildSummary(
    materialized,
    kind,
    Math.min(style === "detailed" ? 72 : 56, config.naming.maxLength),
    config.naming.language,
    style
  );
  const topicScope = detectTopics(materialized, config.naming.language)[0]?.scope;
  const scope =
    topicScope && topicScope !== "web" && topicScope !== "session"
      ? topicScope
      : materialized.projectName && materialized.projectName !== "fanghaotian"
        ? materialized.projectName
        : undefined;
  const tag = detectNamingTag(materialized, config);

  let name = renderStructuredName(materialized, config, {
    kind,
    summary,
    scope,
    tag
  });
  if (name.length > config.naming.maxLength) {
    name = name.slice(0, config.naming.maxLength).trim();
  }

  return {
    threadId: materialized.threadId,
    name,
    source: "heuristic",
    style,
    kind,
    summary,
    scope,
    generatedAt: toUtcIso()
  };
}
