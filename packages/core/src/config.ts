import fs from "node:fs/promises";
import path from "node:path";

import * as TOML from "@iarna/toml";
import {
  DEFAULT_CONFIG_RELATIVE_PATH,
  DEFAULT_STATE_RELATIVE_PATH,
  DEFAULT_WATCH,
  PROJECT_CONFIG_FILENAME,
  REDACTED_SECRET,
  type CodexInheritedAuth,
  type ConfigDocument,
  type ConfigView,
  type InheritedCodexProvider,
  type EffectiveConfig
} from "@codex-session-manager/shared";

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

const DEFAULT_CONFIG: EffectiveConfig = {
  general: {
    codexHome: "~/.codex",
    stateDir: `~/${DEFAULT_STATE_RELATIVE_PATH}`
  },
  rename: {
    mode: "hybrid",
    autoApply: "idle-finalize",
    manualOverrideWins: true,
    freezeManualName: true
  },
  watch: {
    ...DEFAULT_WATCH
  },
  naming: {
    preset: "conventional",
    template: "{{time:%m%d-%H%M}} {{kind}}{{scope_paren}}: {{summary}}",
    maxLength: 72,
    language: "zh-CN"
  },
  ai: {
    backend: "codex",
    providerSource: "inherit-codex",
    profile: "default",
    timeoutSeconds: 45,
    temperature: 0.2
  },
  providerProfiles: [
    {
      profileId: "default",
      backendKind: "openai-compatible",
      displayName: "Default",
      providerSource: "inherit-codex",
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

function normalizeProviderProfileRecords(records: Record<string, unknown>): EffectiveConfig["providerProfiles"] {
  return Object.entries(records).map(([profileId, value]) => {
    const record = value as Record<string, unknown>;
    return {
      profileId,
      backendKind:
        (getString(record, "backend_kind", "backendKind") as EffectiveConfig["ai"]["backend"] | undefined) ??
        "openai-compatible",
      displayName: getString(record, "display_name", "displayName") ?? profileId,
      providerSource:
        (getString(
          record,
          "provider_source",
          "providerSource"
        ) as EffectiveConfig["ai"]["providerSource"] | undefined) ?? "explicit",
      providerRef: getString(record, "provider_ref", "providerRef"),
      baseUrl: getString(record, "base_url", "baseUrl"),
      model: getString(record, "model"),
      apiKey: getString(record, "api_key", "apiKey"),
      apiKeyRef: getString(record, "api_key_ref", "apiKeyRef"),
      headers: (record.headers as Record<string, string> | undefined) ?? {},
      wireApi:
        (getString(record, "wire_api", "wireApi") as
          | "responses"
          | "chat_completions"
          | "auto"
          | undefined) ?? "auto",
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
  const ai = (raw.ai ?? {}) as Record<string, unknown>;
  const maintenance = (raw.maintenance ?? {}) as Record<string, unknown>;

  const providerProfiles = Array.isArray(raw.providerProfiles)
    ? raw.providerProfiles
        .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"))
        .map((record) => ({
          profileId: getString(record, "profile_id", "profileId") ?? "default",
          backendKind:
            (getString(record, "backend_kind", "backendKind") as EffectiveConfig["ai"]["backend"] | undefined) ??
            "openai-compatible",
          displayName:
            getString(record, "display_name", "displayName") ??
            getString(record, "profile_id", "profileId") ??
            "default",
          providerSource:
            (getString(
              record,
              "provider_source",
              "providerSource"
            ) as EffectiveConfig["ai"]["providerSource"] | undefined) ?? "explicit",
          providerRef: getString(record, "provider_ref", "providerRef"),
          baseUrl: getString(record, "base_url", "baseUrl"),
          model: getString(record, "model"),
          apiKey: getString(record, "api_key", "apiKey"),
          apiKeyRef: getString(record, "api_key_ref", "apiKeyRef"),
          headers: (record.headers as Record<string, string> | undefined) ?? {},
          wireApi:
            (getString(record, "wire_api", "wireApi") as
              | "responses"
              | "chat_completions"
              | "auto"
              | undefined) ?? "auto",
          enabled: getBoolean(record, "enabled") ?? true,
          isDefault: getBoolean(record, "is_default", "isDefault") ?? false
        }))
    : normalizeProviderProfileRecords((raw.provider ?? {}) as Record<string, unknown>);

  return {
    general: {
      codexHome: getString(general, "codex_home", "codexHome"),
      stateDir: getString(general, "state_dir", "stateDir")
    },
    rename: {
      mode: getString(rename, "mode") as EffectiveConfig["rename"]["mode"] | undefined,
      autoApply: getString(rename, "auto_apply", "autoApply") as
        | EffectiveConfig["rename"]["autoApply"]
        | undefined,
      manualOverrideWins: getBoolean(rename, "manual_override_wins", "manualOverrideWins"),
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
      language: getString(naming, "language")
    },
    ai: {
      backend: getString(ai, "backend") as EffectiveConfig["ai"]["backend"] | undefined,
      providerSource: getString(ai, "provider_source", "providerSource") as
        | EffectiveConfig["ai"]["providerSource"]
        | undefined,
      profile: getString(ai, "profile"),
      timeoutSeconds: getNumber(ai, "timeout_seconds", "timeoutSeconds"),
      temperature: getNumber(ai, "temperature")
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
  const providerTable: Record<string, Record<string, unknown>> = {};
  for (const profile of document.providerProfiles ?? []) {
    const encoded = stripEmptyRecord({
      backend_kind: profile.backendKind,
      display_name: profile.displayName,
      provider_source: profile.providerSource,
      provider_ref: profile.providerRef,
      base_url: profile.baseUrl,
      model: profile.model,
      api_key: profile.apiKey,
      api_key_ref: profile.apiKeyRef,
      headers: profile.headers,
      wire_api: profile.wireApi,
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
      state_dir: document.general?.stateDir
    }),
    rename: stripEmptyRecord({
      mode: document.rename?.mode,
      auto_apply: document.rename?.autoApply,
      manual_override_wins: document.rename?.manualOverrideWins,
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
      language: document.naming?.language
    }),
    ai: stripEmptyRecord({
      backend: document.ai?.backend,
      provider_source: document.ai?.providerSource,
      profile: document.ai?.profile,
      timeout_seconds: document.ai?.timeoutSeconds,
      temperature: document.ai?.temperature
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

export function resolveConfigPaths(options?: {
  cwd?: string;
  configPath?: string;
}): { cwd: string; userConfigPath: string; projectConfigPath: string } {
  const cwd = options?.cwd ?? process.cwd();
  const userConfigPath = options?.configPath ?? path.join(process.env.HOME ?? "", DEFAULT_CONFIG_RELATIVE_PATH);
  const projectConfigPath = path.join(cwd, PROJECT_CONFIG_FILENAME);
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
  const paths = resolveConfigPaths(options);
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
  const paths = resolveConfigPaths(options);
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
        (record.wire_api as "responses" | "chat_completions" | "auto" | undefined) ?? "auto",
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
  const paths = resolveConfigPaths(options);
  const userRaw = normalizeConfigDocumentInput((await readTomlFile(paths.userConfigPath)) ?? {});
  const mergedGeneral = deepMerge(DEFAULT_CONFIG.general, userRaw.general ?? {});
  const projectRaw = normalizeConfigDocumentInput((await readTomlFile(paths.projectConfigPath)) ?? {});

  let effective = deepMerge(DEFAULT_CONFIG, userRaw as Partial<EffectiveConfig>);
  effective = deepMerge(effective, projectRaw as Partial<EffectiveConfig>);
  effective = deepMerge(effective, options?.overrides ?? {});

  effective.general = {
    codexHome: expandHome(effective.general.codexHome ?? mergedGeneral.codexHome),
    stateDir: expandHome(effective.general.stateDir ?? mergedGeneral.stateDir)
  };

  effective.inheritedCodex = await loadCodexInheritedConfig(effective.general.codexHome);

  if (effective.providerProfiles.length === 0) {
    effective.providerProfiles = DEFAULT_CONFIG.providerProfiles;
  }

  return effective;
}

export function buildConfigForTests(overrides?: Partial<EffectiveConfig>): EffectiveConfig {
  return deepMerge(DEFAULT_CONFIG, overrides ?? {});
}
