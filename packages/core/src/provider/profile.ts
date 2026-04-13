import type { EffectiveConfig } from "@codexnamer/shared";

import type { ProviderDiagnostics, ResolvedProvider } from "./shared.js";

export function shouldPreferStreamingProviderRequest(config: EffectiveConfig): boolean {
  return config.ai.providerSource === "codex-config";
}

export function resolveProfile(config: EffectiveConfig): ResolvedProvider | undefined {
  const requestedProfileId = config.ai.profile;
  const explicit =
    config.providerProfiles.find((item) => item.profileId === requestedProfileId) ??
    config.providerProfiles.find((item) => item.isDefault) ??
    config.providerProfiles[0];

  if (!explicit) {
    return undefined;
  }
  const useManualConfig = config.ai.providerSource === "manual";

  const inheritedProviderRef = config.inheritedCodex.modelProvider;
  const inherited =
    inheritedProviderRef && config.inheritedCodex.providers[inheritedProviderRef]
      ? config.inheritedCodex.providers[inheritedProviderRef]
      : undefined;

  const explicitApiKey = explicit.apiKey?.trim() || undefined;
  const explicitApiKeyRef = explicit.apiKeyRef
    ? process.env[explicit.apiKeyRef]?.trim()
    : undefined;
  const inheritedEnvApiKey = inherited?.apiKeyEnv
    ? process.env[inherited.apiKeyEnv]?.trim()
    : undefined;
  const inheritedAuthApiKey = config.inheritedCodex.auth?.openaiApiKey?.trim() || undefined;
  const envOpenAiApiKey = process.env.OPENAI_API_KEY?.trim() || undefined;
  const inheritedAccessToken = config.inheritedCodex.auth?.accessToken?.trim() || undefined;

  const credentialValue = useManualConfig
    ? explicitApiKey || explicitApiKeyRef
    : inheritedEnvApiKey || inheritedAuthApiKey || envOpenAiApiKey || inheritedAccessToken;
  const credentialKind = useManualConfig
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
    requestType: useManualConfig
      ? (explicit.requestType ?? (config.ai.backend === "none" ? "responses" : config.ai.backend))
      : (inherited?.wireApi ?? (config.ai.backend === "none" ? "responses" : config.ai.backend)),
    requiresOpenaiAuth: inherited?.requiresOpenaiAuth ?? false,
    requestedBackend: useManualConfig
      ? (explicit.requestType ?? (config.ai.backend === "none" ? "responses" : config.ai.backend))
      : (inherited?.wireApi ?? (config.ai.backend === "none" ? "responses" : config.ai.backend)),
  };
}

export function resolveRenameProvider(config: EffectiveConfig):
  | (Omit<ResolvedProvider, "credentialValue"> & {
      credentialValue?: string;
    })
  | undefined {
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
      canDirectHttp: false,
    };
  }

  const provider = resolveProfile(config);
  if (!provider) {
    return {
      configuredBackend,
      requestedBackend: configuredBackend,
      hasCredential: false,
      preferredTransport: "http",
      canDirectHttp: false,
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
    canDirectHttp,
  };
}
