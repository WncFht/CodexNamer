import type { ConfigDocument, ConfigView, EffectiveConfig } from "@codexnamer/shared";

import { loadConfigView, writeUserConfig } from "../config.js";
import {
  inspectRenameProvider,
  probeRenameProvider,
  resolveRenameProvider
} from "../provider.js";
import { getLastProviderTest, rememberProviderTest } from "./provider-state.js";
import { deepMerge } from "../util.js";
import type { ManagerServiceContext } from "./shared.js";
import { redactSecret } from "./shared.js";

export async function printConfig(context: ManagerServiceContext): Promise<Record<string, unknown>> {
  const providerDiagnostics = inspectRenameProvider(context.config);
  const lastProviderTest = getLastProviderTest(context.db, context.config);

  return {
    general: context.config.general,
    rename: context.config.rename,
    watch: context.config.watch,
    naming: context.config.naming,
    ai: context.config.ai,
    providerProfiles: context.config.providerProfiles.map((profile) => ({
      ...profile,
      apiKey: redactSecret(profile.apiKey),
      apiKeyRef: profile.apiKeyRef ?? undefined
    })),
    inheritedCodex: {
      modelProvider: context.config.inheritedCodex.modelProvider,
      model: context.config.inheritedCodex.model,
      providers: context.config.inheritedCodex.providers,
      auth: context.config.inheritedCodex.auth
        ? {
            authMode: context.config.inheritedCodex.auth.authMode,
            openaiApiKey: redactSecret(context.config.inheritedCodex.auth.openaiApiKey),
            accessToken: redactSecret(context.config.inheritedCodex.auth.accessToken),
            hasOpenaiApiKey: Boolean(context.config.inheritedCodex.auth.openaiApiKey),
            hasAccessToken: Boolean(context.config.inheritedCodex.auth.accessToken)
          }
        : undefined
    },
    resolvedProvider: providerDiagnostics,
    lastProviderTest
  };
}

export function parseCodexProviderConfig(context: ManagerServiceContext): Record<string, unknown> {
  const previewConfig = deepMerge(context.config, {
    ai: {
      providerSource: "codex-config"
    }
  } as Partial<EffectiveConfig>);
  const resolved = resolveRenameProvider(previewConfig);
  return {
    source: "codex-config",
    profile: {
      requestType: resolved?.requestType ?? (previewConfig.ai.backend === "none" ? "responses" : previewConfig.ai.backend),
      providerRef: resolved?.providerRef,
      baseUrl: resolved?.baseUrl,
      model: resolved?.model,
      apiKey: resolved?.credentialKind === "api-key" ? resolved.credentialValue : undefined
    }
  };
}

export async function getConfigView(context: ManagerServiceContext): Promise<ConfigView> {
  return loadConfigView({
    cwd: context.cwd,
    configPath: context.configPath,
    overrides: context.overrides,
    effectiveConfig: context.config,
    effectiveConfigView: await printConfig(context)
  });
}

export async function updateConfig(
  context: ManagerServiceContext,
  patch: ConfigDocument
): Promise<{ writtenTo: string; restartRequired: boolean; config: ConfigView }> {
  const nextStateDir = patch.general?.stateDir;
  if (nextStateDir && nextStateDir !== context.config.general.stateDir) {
    throw new Error("Updating general.stateDir via the running API is not supported. Restart with a new state dir instead.");
  }

  const result = await writeUserConfig({
    cwd: context.cwd,
    configPath: context.configPath,
    patch
  });
  await context.reloadConfig();
  context.db.clearAllCandidates();
  return {
    writtenTo: result.userConfigPath,
    restartRequired: false,
    config: await getConfigView(context)
  };
}

export async function testProvider(
  context: ManagerServiceContext,
  options?: { userConfig?: ConfigDocument }
): Promise<Record<string, unknown>> {
  const previewConfig = context.resolvePreviewConfig(options?.userConfig);
  const result = await probeRenameProvider(previewConfig);
  rememberProviderTest(context.db, previewConfig, {
    ok: result.ok,
    testedAt: result.testedAt,
    latencyMs: result.latencyMs,
    diagnostics: result.diagnostics as unknown as Record<string, unknown>,
    responseText: result.responseText,
    error: result.error
  });
  return result;
}
