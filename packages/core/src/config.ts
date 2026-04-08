import fs from "node:fs/promises";
import path from "node:path";

import * as TOML from "@iarna/toml";
import {
  DEFAULT_CONFIG_RELATIVE_PATH,
  DEFAULT_STATE_RELATIVE_PATH,
  DEFAULT_WATCH,
  LEGACY_CONFIG_RELATIVE_PATH,
  LEGACY_PROJECT_CONFIG_FILENAME,
  LEGACY_STATE_RELATIVE_PATH,
  PROJECT_CONFIG_FILENAME,
  REDACTED_SECRET,
  type CodexInheritedAuth,
  type ConfigDocument,
  type ConfigView,
  type InheritedCodexProvider,
  type EffectiveConfig
} from "@codexnamer/shared";

import { deepMerge, ensureTrailingNewline, expandHome } from "./util.js";

function getString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function getBoolean(record: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function getNumber(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") {
      return value;
    }
  }
  return undefined;
}

function getStringArray(record: Record<string, unknown>, ...keys: string[]): string[] | undefined {
  for (const key of keys) {
    const value = record[key];
    if (!Array.isArray(value)) {
      continue;
    }
    const strings = value.filter((item): item is string => typeof item === "string");
    if (strings.length > 0) {
      return strings;
    }
  }
  return undefined;
}

function normalizeProviderSource(value: string | undefined): EffectiveConfig["ai"]["providerSource"] | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "manual") {
    return "manual";
  }
  if (value === "codex-config") {
    return "codex-config";
  }
  return undefined;
}

function normalizeWireApi(
  value: string | undefined
): EffectiveConfig["providerProfiles"][number]["requestType"] | EffectiveConfig["inheritedCodex"]["providers"][string]["wireApi"] | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "responses") {
    return "responses";
  }
  if (value === "openai-compatible") {
    return "openai-compatible";
  }
  return undefined;
}

function normalizeAiBackend(value: string | undefined): EffectiveConfig["ai"]["backend"] | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "none") {
    return "none";
  }
  return normalizeWireApi(value) as EffectiveConfig["ai"]["backend"] | undefined;
}

function normalizeNamingTags(value: unknown): EffectiveConfig["naming"]["tags"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const tags = value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((record) => ({
      id: getString(record, "id") ?? "",
      label: getString(record, "label"),
      description: getString(record, "description"),
      promptHint: getString(record, "prompt_hint", "promptHint")
    }))
    .filter((tag) => tag.id.trim().length > 0);

  return tags.length > 0 ? tags : undefined;
}

const NAMING_COMPONENTS: EffectiveConfig["naming"]["components"] = [
  "timestamp",
  "workspace",
  "project",
  "tag",
  "kind",
  "scope",
  "summary"
];

const DEFAULT_TIMESTAMP_PRESET = "%Y-%m-%d" satisfies NonNullable<
  NonNullable<EffectiveConfig["naming"]["builder"]>[number] & { type: "component" }
>["format"];

function buildLegacyNamingBuilder(
  components: EffectiveConfig["naming"]["components"] | undefined,
  separator: string | undefined
): NonNullable<EffectiveConfig["naming"]["builder"]> | undefined {
  if (!components || components.length === 0) {
    return undefined;
  }

  const builder: NonNullable<EffectiveConfig["naming"]["builder"]> = [];
  components.forEach((component, index) => {
    builder.push({
      type: "component",
      component,
      ...(component === "timestamp" ? { format: DEFAULT_TIMESTAMP_PRESET } : {})
    });
    if (separator && index < components.length - 1) {
      builder.push({
        type: "separator",
        value: separator
      });
    }
  });
  return builder;
}

function normalizeNamingBuilder(value: unknown): EffectiveConfig["naming"]["builder"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const builder = value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((record) => {
      const type = getString(record, "type");
      if (type === "separator") {
        const separator = getString(record, "value");
        return separator
          ? {
              type: "separator" as const,
              value: separator
            }
          : undefined;
      }

      if (type === "component") {
        const component = getString(record, "component") as EffectiveConfig["naming"]["components"][number] | undefined;
        if (!component || !NAMING_COMPONENTS.includes(component)) {
          return undefined;
        }
        const format = getString(record, "format");
        return {
          type: "component" as const,
          component,
          ...(component === "timestamp" && format ? { format } : {})
        };
      }

      return undefined;
    })
    .filter(
      (
        item
      ): item is NonNullable<EffectiveConfig["naming"]["builder"]>[number] => Boolean(item)
    );

  return builder.length > 0 ? builder : undefined;
}

function deriveLegacyComponentsFromBuilder(
  builder: EffectiveConfig["naming"]["builder"] | undefined
): EffectiveConfig["naming"]["components"] | undefined {
  const components = builder
    ?.filter(
      (
        item
      ): item is Extract<NonNullable<EffectiveConfig["naming"]["builder"]>[number], { type: "component" }> =>
        item.type === "component"
    )
    .map((item) => item.component);

  return components && components.length > 0 ? components : undefined;
}

function deriveLegacySeparatorFromBuilder(builder: EffectiveConfig["naming"]["builder"] | undefined): string | undefined {
  const separators = builder
    ?.filter(
      (
        item
      ): item is Extract<NonNullable<EffectiveConfig["naming"]["builder"]>[number], { type: "separator" }> =>
        item.type === "separator"
    )
    .map((item) => item.value);

  if (!separators || separators.length === 0) {
    return undefined;
  }

  const [first] = separators;
  return separators.every((value) => value === first) ? first : undefined;
}

const DEFAULT_NAMING_TAGS: EffectiveConfig["naming"]["tags"] = [
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

const DEFAULT_CONFIG: EffectiveConfig = {
  general: {
    codexHome: "~/.codex",
    stateDir: `~/${DEFAULT_STATE_RELATIVE_PATH}`,
    uiLanguage: "en-US"
  },
  rename: {
    mode: "hybrid",
    autoApply: "idle-finalize",
    freezeManualName: true
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
    components: ["tag", "kind", "summary"],
    componentSeparator: " · ",
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

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T[K] extends Record<string, unknown>
      ? DeepPartial<T[K]>
      : T[K];
};

async function readTomlFile(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return TOML.parse(content) as Record<string, unknown>;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolvePreferredPath(primaryPath: string, legacyPath: string): Promise<string> {
  if (await pathExists(primaryPath)) {
    return primaryPath;
  }
  if (await pathExists(legacyPath)) {
    return legacyPath;
  }
  return primaryPath;
}

async function resolveDefaultStateDir(): Promise<string> {
  const primary = expandHome(`~/${DEFAULT_STATE_RELATIVE_PATH}`);
  const legacy = expandHome(`~/${LEGACY_STATE_RELATIVE_PATH}`);
  if (await pathExists(primary)) {
    return primary;
  }
  if (await pathExists(legacy)) {
    return legacy;
  }
  return primary;
}

function normalizeProviderProfileRecords(records: Record<string, unknown>): EffectiveConfig["providerProfiles"] {
  return Object.entries(records).map(([profileId, value]) => {
    const record = value as Record<string, unknown>;
    return {
      profileId,
      requestType: normalizeWireApi(getString(record, "request_type", "requestType")) ?? "responses",
      displayName: getString(record, "display_name", "displayName") ?? profileId,
      providerRef: getString(record, "provider_ref", "providerRef"),
      baseUrl: getString(record, "base_url", "baseUrl"),
      model: getString(record, "model"),
      apiKey: getString(record, "api_key", "apiKey"),
      apiKeyRef: getString(record, "api_key_ref", "apiKeyRef"),
      headers: (record.headers as Record<string, string> | undefined) ?? {},
      enabled: getBoolean(record, "enabled") ?? true,
      isDefault: getBoolean(record, "is_default", "isDefault") ?? profileId === "default"
    };
  });
}

function normalizeConfigDocumentInput(raw: Record<string, unknown>): ConfigDocument {
  const general = (raw.general ?? {}) as Record<string, unknown>;
  const rename = (raw.rename ?? {}) as Record<string, unknown>;
  const watch = (raw.watch ?? {}) as Record<string, unknown>;
  const naming = (raw.naming ?? {}) as Record<string, unknown>;
  const legacyComponents = getStringArray(naming, "components") as EffectiveConfig["naming"]["components"] | undefined;
  const legacySeparator = getString(naming, "component_separator", "componentSeparator");

  const ai = (raw.ai ?? {}) as Record<string, unknown>;
  const maintenance = (raw.maintenance ?? {}) as Record<string, unknown>;

  const providerProfiles = Array.isArray(raw.providerProfiles)
    ? raw.providerProfiles
        .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"))
        .map((record) => ({
          profileId: getString(record, "profile_id", "profileId") ?? "default",
          requestType: normalizeWireApi(getString(record, "request_type", "requestType")) ?? "responses",
          displayName:
            getString(record, "display_name", "displayName") ??
            getString(record, "profile_id", "profileId") ??
            "default",
          providerRef: getString(record, "provider_ref", "providerRef"),
          baseUrl: getString(record, "base_url", "baseUrl"),
          model: getString(record, "model"),
          apiKey: getString(record, "api_key", "apiKey"),
          apiKeyRef: getString(record, "api_key_ref", "apiKeyRef"),
          headers: (record.headers as Record<string, string> | undefined) ?? {},
          enabled: getBoolean(record, "enabled") ?? true,
          isDefault: getBoolean(record, "is_default", "isDefault") ?? false
        }))
    : normalizeProviderProfileRecords((raw.provider ?? {}) as Record<string, unknown>);

  return {
    general: {
      codexHome: getString(general, "codex_home", "codexHome"),
      stateDir: getString(general, "state_dir", "stateDir"),
      uiLanguage: getString(general, "ui_language", "uiLanguage") as EffectiveConfig["general"]["uiLanguage"] | undefined
    },
    rename: {
      mode: getString(rename, "mode") as EffectiveConfig["rename"]["mode"] | undefined,
      autoApply: getString(rename, "auto_apply", "autoApply") as
        | EffectiveConfig["rename"]["autoApply"]
        | undefined,
      freezeManualName: getBoolean(rename, "freeze_manual_name", "freezeManualName")
    },
    watch: {
      scanIntervalSeconds: getNumber(watch, "scan_interval_seconds", "scanIntervalSeconds"),
      candidateIdleSeconds: getNumber(watch, "candidate_idle_seconds", "candidateIdleSeconds"),
      finalizeIdleSeconds: getNumber(watch, "finalize_idle_seconds", "finalizeIdleSeconds"),
      renameCooldownSeconds: getNumber(watch, "rename_cooldown_seconds", "renameCooldownSeconds"),
      minRolloutGrowthBytes: getNumber(watch, "min_rollout_growth_bytes", "minRolloutGrowthBytes"),
      minTaskCompleteDelta: getNumber(watch, "min_task_complete_delta", "minTaskCompleteDelta"),
      maxAutoRenamesPerSession: getNumber(
        watch,
        "max_auto_renames_per_session",
        "maxAutoRenamesPerSession"
      )
    },
    naming: {
      preset: getString(naming, "preset"),
      template: getString(naming, "template"),
      maxLength: getNumber(naming, "max_length", "maxLength"),
      language: getString(naming, "language"),
      contextStrategy: getString(
        naming,
        "context_strategy",
        "contextStrategy"
      ) as EffectiveConfig["naming"]["contextStrategy"] | undefined,
      contextMaxChars: getNumber(naming, "context_max_chars", "contextMaxChars"),
      compositionMode: getString(
        naming,
        "composition_mode",
        "compositionMode"
      ) as EffectiveConfig["naming"]["compositionMode"] | undefined,
      builder: normalizeNamingBuilder(naming.builder) ?? buildLegacyNamingBuilder(legacyComponents, legacySeparator),
      components: legacyComponents,
      componentSeparator: legacySeparator,
      tags: normalizeNamingTags(naming.tags),
      customPrompt: getString(naming, "custom_prompt", "customPrompt")
    },
    ai: {
      backend: normalizeAiBackend(getString(ai, "backend")),
      providerSource: normalizeProviderSource(getString(ai, "provider_source", "providerSource")),
      profile: getString(ai, "profile"),
      timeoutSeconds: getNumber(ai, "timeout_seconds", "timeoutSeconds"),
      temperature: getNumber(ai, "temperature"),
      maxConcurrency: getNumber(ai, "max_concurrency", "maxConcurrency")
    },
    providerProfiles: providerProfiles.length > 0 ? providerProfiles : undefined,
    maintenance: {
      suggestCompactIndexAboveMb: getNumber(
        maintenance,
        "suggest_compact_index_above_mb",
        "suggestCompactIndexAboveMb"
      ),
      suggestCompactIndexAboveLines: getNumber(
        maintenance,
        "suggest_compact_index_above_lines",
        "suggestCompactIndexAboveLines"
      ),
      backupBeforeCompact: getBoolean(
        maintenance,
        "backup_before_compact",
        "backupBeforeCompact"
      )
    }
  };
}

function mergeProviderProfiles(
  baseProfiles: EffectiveConfig["providerProfiles"] | undefined,
  patchProfiles: EffectiveConfig["providerProfiles"]
): EffectiveConfig["providerProfiles"] {
  const existingById = new Map((baseProfiles ?? []).map((profile) => [profile.profileId, profile]));

  return patchProfiles.map((profile) => {
    const existing = existingById.get(profile.profileId);
    return {
      ...existing,
      ...profile,
      apiKey:
        profile.apiKey === REDACTED_SECRET || profile.apiKey === undefined
          ? existing?.apiKey
          : profile.apiKey || undefined,
      apiKeyRef:
        profile.apiKeyRef === REDACTED_SECRET || profile.apiKeyRef === undefined
          ? existing?.apiKeyRef
          : profile.apiKeyRef || undefined,
      headers: profile.headers ?? existing?.headers ?? {},
      enabled: profile.enabled ?? existing?.enabled ?? true,
      isDefault: profile.isDefault ?? existing?.isDefault ?? false
    };
  });
}

function mergeConfigDocuments(base: ConfigDocument, patch: ConfigDocument): ConfigDocument {
  const merged = deepMerge(base, patch);
  if (patch.providerProfiles) {
    merged.providerProfiles = mergeProviderProfiles(base.providerProfiles, patch.providerProfiles);
  }
  return merged;
}

function stripEmptyRecord(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length > 0) {
        result[key] = value;
      }
      continue;
    }

    if (value && typeof value === "object") {
      const nested = stripEmptyRecord(value as Record<string, unknown>);
      if (nested && Object.keys(nested).length > 0) {
        result[key] = nested;
      }
      continue;
    }

    result[key] = value;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function serializeConfigDocument(document: ConfigDocument): string {
  const derivedBuilder = document.naming?.builder;
  const derivedComponents = document.naming?.components ?? deriveLegacyComponentsFromBuilder(derivedBuilder);
  const derivedSeparator =
    document.naming?.componentSeparator ?? deriveLegacySeparatorFromBuilder(derivedBuilder);
  const providerTable: Record<string, Record<string, unknown>> = {};
  for (const profile of document.providerProfiles ?? []) {
    const encoded = stripEmptyRecord({
      request_type: profile.requestType,
      display_name: profile.displayName,
      provider_ref: profile.providerRef,
      base_url: profile.baseUrl,
      model: profile.model,
      api_key: profile.apiKey,
      api_key_ref: profile.apiKeyRef,
      headers: profile.headers,
      enabled: profile.enabled,
      is_default: profile.isDefault
    });
    if (encoded) {
      providerTable[profile.profileId] = encoded;
    }
  }

  const payload = stripEmptyRecord({
    general: stripEmptyRecord({
      codex_home: document.general?.codexHome,
      state_dir: document.general?.stateDir,
      ui_language: document.general?.uiLanguage
    }),
    rename: stripEmptyRecord({
      mode: document.rename?.mode,
      auto_apply: document.rename?.autoApply,
      freeze_manual_name: document.rename?.freezeManualName
    }),
    watch: stripEmptyRecord({
      scan_interval_seconds: document.watch?.scanIntervalSeconds,
      candidate_idle_seconds: document.watch?.candidateIdleSeconds,
      finalize_idle_seconds: document.watch?.finalizeIdleSeconds,
      rename_cooldown_seconds: document.watch?.renameCooldownSeconds,
      min_rollout_growth_bytes: document.watch?.minRolloutGrowthBytes,
      min_task_complete_delta: document.watch?.minTaskCompleteDelta,
      max_auto_renames_per_session: document.watch?.maxAutoRenamesPerSession
    }),
    naming: stripEmptyRecord({
      preset: document.naming?.preset,
      template: document.naming?.template,
      max_length: document.naming?.maxLength,
      language: document.naming?.language,
      context_strategy: document.naming?.contextStrategy,
      context_max_chars: document.naming?.contextMaxChars,
      composition_mode: document.naming?.compositionMode,
      builder: document.naming?.builder?.map((item) =>
        item.type === "separator"
          ? stripEmptyRecord({
              type: item.type,
              value: item.value
            })
          : stripEmptyRecord({
              type: item.type,
              component: item.component,
              format: item.format
            })
      ),
      components: derivedComponents,
      component_separator: derivedSeparator,
      tags: document.naming?.tags?.map((tag) =>
        stripEmptyRecord({
          id: tag.id,
          label: tag.label,
          description: tag.description,
          prompt_hint: tag.promptHint
        })
      ),
      custom_prompt: document.naming?.customPrompt
    }),
    ai: stripEmptyRecord({
      backend: document.ai?.backend,
      provider_source: document.ai?.providerSource,
      profile: document.ai?.profile,
      timeout_seconds: document.ai?.timeoutSeconds,
      temperature: document.ai?.temperature,
      max_concurrency: document.ai?.maxConcurrency
    }),
    maintenance: stripEmptyRecord({
      suggest_compact_index_above_mb: document.maintenance?.suggestCompactIndexAboveMb,
      suggest_compact_index_above_lines: document.maintenance?.suggestCompactIndexAboveLines,
      backup_before_compact: document.maintenance?.backupBeforeCompact
    }),
    provider: Object.keys(providerTable).length > 0 ? providerTable : undefined
  });

  return ensureTrailingNewline(TOML.stringify((payload ?? {}) as TOML.JsonMap));
}

function redactConfigDocument(document: ConfigDocument): ConfigDocument {
  return {
    ...document,
    providerProfiles: document.providerProfiles?.map((profile) => ({
      ...profile,
      apiKey: profile.apiKey ? REDACTED_SECRET : undefined
    }))
  };
}

export async function resolveConfigPaths(options?: {
  cwd?: string;
  configPath?: string;
}): Promise<{ cwd: string; userConfigPath: string; projectConfigPath: string }> {
  const cwd = options?.cwd ?? process.cwd();
  const userConfigPath =
    options?.configPath ??
    (await resolvePreferredPath(
      path.join(process.env.HOME ?? "", DEFAULT_CONFIG_RELATIVE_PATH),
      path.join(process.env.HOME ?? "", LEGACY_CONFIG_RELATIVE_PATH)
    ));
  const projectConfigPath = await resolvePreferredPath(
    path.join(cwd, PROJECT_CONFIG_FILENAME),
    path.join(cwd, LEGACY_PROJECT_CONFIG_FILENAME)
  );
  return {
    cwd,
    userConfigPath,
    projectConfigPath
  };
}

export async function loadConfigView(options?: {
  cwd?: string;
  configPath?: string;
  overrides?: Partial<EffectiveConfig>;
  effectiveConfig?: EffectiveConfig;
  effectiveConfigView?: Record<string, unknown>;
}): Promise<ConfigView> {
  const paths = await resolveConfigPaths(options);
  const userConfig = normalizeConfigDocumentInput((await readTomlFile(paths.userConfigPath)) ?? {});
  const projectOverride = normalizeConfigDocumentInput((await readTomlFile(paths.projectConfigPath)) ?? {});
  const effective =
    options?.effectiveConfig ??
    (await loadEffectiveConfig({
      cwd: paths.cwd,
      configPath: paths.userConfigPath,
      overrides: options?.overrides
    }));

  return {
    paths,
    userConfig: redactConfigDocument(userConfig),
    projectOverride: redactConfigDocument(projectOverride),
    effectiveConfig: options?.effectiveConfigView ?? {
      general: effective.general,
      rename: effective.rename,
      watch: effective.watch,
      naming: effective.naming,
      ai: effective.ai,
      providerProfiles: redactConfigDocument({
        providerProfiles: effective.providerProfiles
      }).providerProfiles,
      inheritedCodex: {
        modelProvider: effective.inheritedCodex.modelProvider,
        model: effective.inheritedCodex.model,
        providers: effective.inheritedCodex.providers,
        auth: effective.inheritedCodex.auth
          ? {
              authMode: effective.inheritedCodex.auth.authMode,
              openaiApiKey: effective.inheritedCodex.auth.openaiApiKey ? REDACTED_SECRET : undefined,
              accessToken: effective.inheritedCodex.auth.accessToken ? REDACTED_SECRET : undefined,
              hasOpenaiApiKey: Boolean(effective.inheritedCodex.auth.openaiApiKey),
              hasAccessToken: Boolean(effective.inheritedCodex.auth.accessToken)
            }
          : undefined
      }
    }
  };
}

export async function writeUserConfig(options: {
  cwd?: string;
  configPath?: string;
  patch: ConfigDocument;
}): Promise<{ userConfigPath: string; userConfig: ConfigDocument }> {
  const paths = await resolveConfigPaths(options);
  const existing = normalizeConfigDocumentInput((await readTomlFile(paths.userConfigPath)) ?? {});
  const merged = mergeConfigDocuments(existing, options.patch);
  await fs.mkdir(path.dirname(paths.userConfigPath), { recursive: true });
  await fs.writeFile(paths.userConfigPath, serializeConfigDocument(merged), "utf8");
  return {
    userConfigPath: paths.userConfigPath,
    userConfig: merged
  };
}

async function loadCodexInheritedConfig(codexHome: string): Promise<EffectiveConfig["inheritedCodex"]> {
  const codexConfigPath = path.join(codexHome, "config.toml");
  const authJsonPath = path.join(codexHome, "auth.json");
  const raw = await readTomlFile(codexConfigPath);
  let auth: CodexInheritedAuth | undefined;

  try {
    const authRaw = JSON.parse(await fs.readFile(authJsonPath, "utf8")) as Record<string, unknown>;
    const tokens =
      authRaw.tokens && typeof authRaw.tokens === "object"
        ? (authRaw.tokens as Record<string, unknown>)
        : undefined;
    const accessToken = typeof tokens?.access_token === "string" ? tokens.access_token.trim() : undefined;
    auth = {
      authMode: typeof authRaw.auth_mode === "string" ? authRaw.auth_mode : undefined,
      openaiApiKey:
        typeof authRaw.OPENAI_API_KEY === "string" && authRaw.OPENAI_API_KEY.trim().length > 0
          ? authRaw.OPENAI_API_KEY.trim()
          : undefined,
      accessToken: accessToken && accessToken.length > 0 ? accessToken : undefined
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  if (!raw) {
    return {
      providers: {},
      auth
    };
  }

  const providerRecords = (raw.model_providers ?? {}) as Record<string, unknown>;
  const providers: Record<string, InheritedCodexProvider> = {};

  for (const [providerKey, providerValue] of Object.entries(providerRecords)) {
    const record = providerValue as Record<string, unknown>;
    providers[providerKey] = {
      name: (record.name as string | undefined) ?? providerKey,
      baseUrl: record.base_url as string | undefined,
      wireApi:
        normalizeWireApi(record.wire_api as string | undefined) ?? "responses",
      apiKeyEnv:
        (record.api_key_env as string | undefined) ??
        (record.env_key as string | undefined) ??
        (record.api_key_env_var as string | undefined),
      headers: (record.headers as Record<string, string> | undefined) ?? {},
      requiresOpenaiAuth: (record.requires_openai_auth as boolean | undefined) ?? false
    };
  }

  return {
    modelProvider: raw.model_provider as string | undefined,
    model: raw.model as string | undefined,
    providers,
    auth
  };
}

export async function loadEffectiveConfig(options?: {
  cwd?: string;
  configPath?: string;
  overrides?: Partial<EffectiveConfig>;
}): Promise<EffectiveConfig> {
  const paths = await resolveConfigPaths(options);
  const userRaw = normalizeConfigDocumentInput((await readTomlFile(paths.userConfigPath)) ?? {});
  const mergedGeneral = deepMerge(DEFAULT_CONFIG.general, userRaw.general ?? {});
  const projectRaw = normalizeConfigDocumentInput((await readTomlFile(paths.projectConfigPath)) ?? {});

  let effective = deepMerge(DEFAULT_CONFIG, userRaw as Partial<EffectiveConfig>);
  effective = deepMerge(effective, projectRaw as Partial<EffectiveConfig>);
  effective = deepMerge(effective, options?.overrides ?? {});

  const explicitStateDir =
    options?.overrides?.general?.stateDir ?? projectRaw.general?.stateDir ?? userRaw.general?.stateDir;
  effective.general = {
    codexHome: expandHome(effective.general.codexHome ?? mergedGeneral.codexHome),
    stateDir: explicitStateDir ? expandHome(explicitStateDir) : await resolveDefaultStateDir(),
    uiLanguage: effective.general.uiLanguage ?? mergedGeneral.uiLanguage ?? DEFAULT_CONFIG.general.uiLanguage
  };

  effective.inheritedCodex = await loadCodexInheritedConfig(effective.general.codexHome);

  if (effective.providerProfiles.length === 0) {
    effective.providerProfiles = DEFAULT_CONFIG.providerProfiles;
  }

  return effective;
}

export function buildConfigForTests(overrides?: DeepPartial<EffectiveConfig>): EffectiveConfig {
  return deepMerge(DEFAULT_CONFIG, (overrides ?? {}) as Partial<EffectiveConfig>);
}
