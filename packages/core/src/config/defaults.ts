import {
  DEFAULT_STATE_RELATIVE_PATH,
  DEFAULT_WATCH,
  type EffectiveConfig
} from "@codexnamer/shared";

export const DEFAULT_NAMING_TAGS: EffectiveConfig["naming"]["tags"] = [
  {
    id: "settings",
    description: "用于设置页、配置保存、语言切换、provider 选项这类会话。",
    promptHint: "Choose when the main work is editing config, fixing settings forms, or explaining provider / language options."
  },
  {
    id: "rename",
    description: "用于命名规则、标题结构、风格版本、重命名策略这类会话。",
    promptHint: "Choose when the session is about rename logic, title structure, naming style, or session title quality."
  },
  {
    id: "context",
    description: "用于 rename context、transcript、上下文读取策略这类会话。",
    promptHint: "Choose when the work focuses on transcript selection, context building, summary signals, or prompt inputs."
  },
  {
    id: "prompt",
    description: "用于 AI prompt、提示词策略、请求载荷构造这类会话。",
    promptHint: "Choose when the work is mainly about prompt writing, prompt preview, or model request payload design."
  },
  {
    id: "provider",
    description: "用于模型提供方、base URL、模型与鉴权配置这类会话。",
    promptHint: "Choose when the main focus is provider selection, base URL, model auth, wire API, or relay compatibility."
  },
  {
    id: "daemon",
    description: "用于 watcher、scan、后台 sweep、auto-apply 这类会话。",
    promptHint: "Choose when the session is about daemon background work, scan cadence, heartbeat, or automatic apply behavior."
  },
  {
    id: "history",
    description: "用于命名历史、timeline、session detail 这类会话。",
    promptHint: "Choose when the main work is inspecting rename history, timelines, detail panels, or applied records."
  },
  {
    id: "tests",
    description: "用于测试、回归、构建验证这类会话。",
    promptHint: "Choose when the session is primarily about tests, regression coverage, builds, or verification."
  },
  {
    id: "docs",
    description: "用于 README、维护文档、规格同步这类会话。",
    promptHint: "Choose when the main output is documentation, specs, README updates, or maintenance notes."
  },
  {
    id: "workspace",
    description: "用于工作区、会话列表、布局和目录边界这类会话。",
    promptHint: "Choose when the work is about workspace grouping, session list layout, project boundaries, or cwd handling."
  }
];

export const DEFAULT_CONFIG: EffectiveConfig = {
  general: {
    codexHome: "~/.codex",
    stateDir: `~/${DEFAULT_STATE_RELATIVE_PATH}`,
    uiLanguage: "en-US"
  },
  rename: {
    autoApply: "idle-finalize"
  },
  watch: {
    ...DEFAULT_WATCH
  },
  naming: {
    preset: "conventional",
    template: "{{time:%m%d-%H%M}} {{kind}}{{scope_paren}}: {{summary}}",
    maxLength: 72,
    language: "zh-CN",
    contextStrategy: "summary-signals",
    contextMaxChars: 8_000,
    compositionMode: "structured",
    builder: [
      { type: "component", component: "tag" },
      { type: "separator", value: " · " },
      { type: "component", component: "kind" },
      { type: "separator", value: " · " },
      { type: "component", component: "summary" }
    ],
    tags: DEFAULT_NAMING_TAGS,
    customPrompt: undefined
  },
  ai: {
    backend: "responses",
    providerSource: "codex-config",
    profile: "default",
    timeoutSeconds: 45,
    temperature: 0.2,
    maxConcurrency: 1
  },
  providerProfiles: [
    {
      profileId: "default",
      requestType: "responses",
      displayName: "Default",
      apiKey: undefined,
      enabled: true,
      isDefault: true
    }
  ],
  maintenance: {
    suggestCompactIndexAboveMb: 5,
    suggestCompactIndexAboveLines: 20_000,
    backupBeforeCompact: true
  },
  inheritedCodex: {
    providers: {},
    auth: undefined
  }
};

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T[K] extends Record<string, unknown>
      ? DeepPartial<T[K]>
      : T[K];
};
