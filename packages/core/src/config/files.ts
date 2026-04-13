import fs from "node:fs/promises";
import path from "node:path";
import type {
  CodexInheritedAuth,
  ConfigDocument,
  ConfigView,
  EffectiveConfig,
  InheritedCodexProvider,
} from "@codexnamer/shared";
import {
  DEFAULT_CONFIG_RELATIVE_PATH,
  DEFAULT_STATE_RELATIVE_PATH,
  PROJECT_CONFIG_FILENAME,
  REDACTED_SECRET,
} from "@codexnamer/shared";
import * as TOML from "@iarna/toml";

import { deepMerge, expandHome } from "../util.js";
import type { DeepPartial } from "./defaults.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import {
  mergeConfigDocuments,
  normalizeConfigDocumentInput,
  redactConfigDocument,
  serializeConfigDocument,
} from "./document.js";

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

function normalizeWireApi(
  value: string | undefined,
):
  | EffectiveConfig["providerProfiles"][number]["requestType"]
  | EffectiveConfig["inheritedCodex"]["providers"][string]["wireApi"]
  | undefined {
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

export async function resolveConfigPaths(options?: {
  cwd?: string;
  configPath?: string;
}): Promise<{ cwd: string; userConfigPath: string; projectConfigPath: string }> {
  const cwd = options?.cwd ?? process.cwd();
  const userConfigPath =
    options?.configPath ?? path.join(process.env.HOME ?? "", DEFAULT_CONFIG_RELATIVE_PATH);
  const projectConfigPath = path.join(cwd, PROJECT_CONFIG_FILENAME);
  return {
    cwd,
    userConfigPath,
    projectConfigPath,
  };
}

async function loadCodexInheritedConfig(
  codexHome: string,
): Promise<EffectiveConfig["inheritedCodex"]> {
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
    const accessToken =
      typeof tokens?.access_token === "string" ? tokens.access_token.trim() : undefined;
    auth = {
      authMode: typeof authRaw.auth_mode === "string" ? authRaw.auth_mode : undefined,
      openaiApiKey:
        typeof authRaw.OPENAI_API_KEY === "string" && authRaw.OPENAI_API_KEY.trim().length > 0
          ? authRaw.OPENAI_API_KEY.trim()
          : undefined,
      accessToken: accessToken && accessToken.length > 0 ? accessToken : undefined,
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
      auth,
    };
  }

  const providerRecords = (raw.model_providers ?? {}) as Record<string, unknown>;
  const providers: Record<string, InheritedCodexProvider> = {};

  for (const [providerKey, providerValue] of Object.entries(providerRecords)) {
    const record = providerValue as Record<string, unknown>;
    providers[providerKey] = {
      name: (record.name as string | undefined) ?? providerKey,
      baseUrl: record.base_url as string | undefined,
      wireApi: normalizeWireApi(record.wire_api as string | undefined) ?? "responses",
      apiKeyEnv:
        (record.api_key_env as string | undefined) ??
        (record.env_key as string | undefined) ??
        (record.api_key_env_var as string | undefined),
      headers: (record.headers as Record<string, string> | undefined) ?? {},
      requiresOpenaiAuth: (record.requires_openai_auth as boolean | undefined) ?? false,
    };
  }

  return {
    modelProvider: raw.model_provider as string | undefined,
    model: raw.model as string | undefined,
    providers,
    auth,
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
  const projectOverride = normalizeConfigDocumentInput(
    (await readTomlFile(paths.projectConfigPath)) ?? {},
  );
  const effective =
    options?.effectiveConfig ??
    (await loadEffectiveConfig({
      cwd: paths.cwd,
      configPath: paths.userConfigPath,
      overrides: options?.overrides,
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
        providerProfiles: effective.providerProfiles,
      }).providerProfiles,
      inheritedCodex: {
        modelProvider: effective.inheritedCodex.modelProvider,
        model: effective.inheritedCodex.model,
        providers: effective.inheritedCodex.providers,
        auth: effective.inheritedCodex.auth
          ? {
              authMode: effective.inheritedCodex.auth.authMode,
              openaiApiKey: effective.inheritedCodex.auth.openaiApiKey
                ? REDACTED_SECRET
                : undefined,
              accessToken: effective.inheritedCodex.auth.accessToken ? REDACTED_SECRET : undefined,
              hasOpenaiApiKey: Boolean(effective.inheritedCodex.auth.openaiApiKey),
              hasAccessToken: Boolean(effective.inheritedCodex.auth.accessToken),
            }
          : undefined,
      },
    },
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
    userConfig: merged,
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
  const projectRaw = normalizeConfigDocumentInput(
    (await readTomlFile(paths.projectConfigPath)) ?? {},
  );

  let effective = deepMerge(DEFAULT_CONFIG, userRaw as Partial<EffectiveConfig>);
  effective = deepMerge(effective, projectRaw as Partial<EffectiveConfig>);
  effective = deepMerge(effective, options?.overrides ?? {});

  const explicitStateDir =
    options?.overrides?.general?.stateDir ??
    projectRaw.general?.stateDir ??
    userRaw.general?.stateDir;
  effective.general = {
    codexHome: expandHome(effective.general.codexHome ?? mergedGeneral.codexHome),
    stateDir: explicitStateDir
      ? expandHome(explicitStateDir)
      : expandHome(`~/${DEFAULT_STATE_RELATIVE_PATH}`),
    uiLanguage:
      effective.general.uiLanguage ?? mergedGeneral.uiLanguage ?? DEFAULT_CONFIG.general.uiLanguage,
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
