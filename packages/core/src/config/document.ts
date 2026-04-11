import * as TOML from "@iarna/toml";
import { REDACTED_SECRET, type ConfigDocument, type EffectiveConfig } from "@codexnamer/shared";

import { ensureTrailingNewline } from "../util.js";

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

const NAMING_COMPONENTS = ["timestamp", "workspace", "project", "tag", "kind", "scope", "summary"] as const;

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
        const component = getString(record, "component") as (typeof NAMING_COMPONENTS)[number] | undefined;
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
    .filter((item): item is NonNullable<EffectiveConfig["naming"]["builder"]>[number] => Boolean(item));

  return builder.length > 0 ? builder : undefined;
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

export function normalizeConfigDocumentInput(raw: Record<string, unknown>): ConfigDocument {
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
          requestType: normalizeWireApi(getString(record, "request_type", "requestType")) ?? "responses",
          displayName:
            getString(record, "display_name", "displayName") ?? getString(record, "profile_id", "profileId") ?? "default",
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
      autoApply: getString(rename, "auto_apply", "autoApply") as EffectiveConfig["rename"]["autoApply"] | undefined
    },
    watch: {
      scanIntervalSeconds: getNumber(watch, "scan_interval_seconds", "scanIntervalSeconds"),
      candidateIdleSeconds: getNumber(watch, "candidate_idle_seconds", "candidateIdleSeconds"),
      finalizeIdleSeconds: getNumber(watch, "finalize_idle_seconds", "finalizeIdleSeconds"),
      renameCooldownSeconds: getNumber(watch, "rename_cooldown_seconds", "renameCooldownSeconds"),
      maxAutoRenamesPerSession: getNumber(watch, "max_auto_renames_per_session", "maxAutoRenamesPerSession")
    },
    naming: {
      preset: getString(naming, "preset"),
      template: getString(naming, "template"),
      maxLength: getNumber(naming, "max_length", "maxLength"),
      language: getString(naming, "language"),
      contextStrategy: getString(naming, "context_strategy", "contextStrategy") as
        | EffectiveConfig["naming"]["contextStrategy"]
        | undefined,
      contextMaxChars: getNumber(naming, "context_max_chars", "contextMaxChars"),
      compositionMode: getString(naming, "composition_mode", "compositionMode") as
        | EffectiveConfig["naming"]["compositionMode"]
        | undefined,
      builder: normalizeNamingBuilder(naming.builder),
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
      suggestCompactIndexAboveMb: getNumber(maintenance, "suggest_compact_index_above_mb", "suggestCompactIndexAboveMb"),
      suggestCompactIndexAboveLines: getNumber(
        maintenance,
        "suggest_compact_index_above_lines",
        "suggestCompactIndexAboveLines"
      ),
      backupBeforeCompact: getBoolean(maintenance, "backup_before_compact", "backupBeforeCompact")
    }
  };
}

function mergeProviderProfiles(
  baseProfiles: ConfigDocument["providerProfiles"] | undefined,
  patchProfiles: NonNullable<ConfigDocument["providerProfiles"]>
): ConfigDocument["providerProfiles"] {
  const existingById = new Map((baseProfiles ?? []).map((profile) => [profile.profileId, profile]));

  return patchProfiles.map((profile) => {
    const existing = existingById.get(profile.profileId);
    return {
      ...existing,
      ...profile,
      apiKey: profile.apiKey === REDACTED_SECRET || profile.apiKey === undefined ? existing?.apiKey : profile.apiKey || undefined,
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

export function mergeConfigDocuments(base: ConfigDocument, patch: ConfigDocument): ConfigDocument {
  const merged = { ...base, ...patch } as ConfigDocument;
  if (patch.general) {
    merged.general = { ...(base.general ?? {}), ...patch.general };
  }
  if (patch.rename) {
    merged.rename = { ...(base.rename ?? {}), ...patch.rename };
  }
  if (patch.watch) {
    merged.watch = { ...(base.watch ?? {}), ...patch.watch };
  }
  if (patch.naming) {
    merged.naming = { ...(base.naming ?? {}), ...patch.naming };
  }
  if (patch.ai) {
    merged.ai = { ...(base.ai ?? {}), ...patch.ai };
  }
  if (patch.maintenance) {
    merged.maintenance = { ...(base.maintenance ?? {}), ...patch.maintenance };
  }
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

export function serializeConfigDocument(document: ConfigDocument): string {
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
      auto_apply: document.rename?.autoApply
    }),
    watch: stripEmptyRecord({
      scan_interval_seconds: document.watch?.scanIntervalSeconds,
      candidate_idle_seconds: document.watch?.candidateIdleSeconds,
      finalize_idle_seconds: document.watch?.finalizeIdleSeconds,
      rename_cooldown_seconds: document.watch?.renameCooldownSeconds,
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

export function redactConfigDocument(document: ConfigDocument): ConfigDocument {
  return {
    ...document,
    providerProfiles: document.providerProfiles?.map((profile) => ({
      ...profile,
      apiKey: profile.apiKey ? REDACTED_SECRET : undefined
    }))
  };
}
