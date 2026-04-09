import type { EffectiveConfig, NamingBuilderItem, NamingTagDefinition } from "@codexnamer/shared";

import { inspectRenameProvider } from "./provider.js";
import { sha256 } from "./util.js";

function sortRecord<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries) as T;
}

function normalizeBuilder(builder: NamingBuilderItem[]): Array<Record<string, unknown>> {
  return builder.map((item) =>
    item.type === "component"
      ? sortRecord({
          type: item.type,
          component: item.component,
          format: item.format
        })
      : sortRecord({
          type: item.type,
          value: item.value
        })
  );
}

function normalizeTags(tags: NamingTagDefinition[]): Array<Record<string, unknown>> {
  return [...tags]
    .map((tag) =>
      sortRecord({
        id: tag.id,
        label: tag.label,
        description: tag.description,
        promptHint: tag.promptHint
      })
    )
    .sort((left, right) => String(left.id ?? "").localeCompare(String(right.id ?? "")));
}

export function buildRenameRuleSignatureBasis(config: EffectiveConfig): Record<string, unknown> {
  const provider = inspectRenameProvider(config);
  return sortRecord({
    naming: sortRecord({
      preset: config.naming.preset,
      template: config.naming.template,
      maxLength: config.naming.maxLength,
      language: config.naming.language,
      contextStrategy: config.naming.contextStrategy,
      contextMaxChars: config.naming.contextMaxChars,
      compositionMode: config.naming.compositionMode,
      builder: normalizeBuilder(config.naming.builder),
      tags: normalizeTags(config.naming.tags),
      customPrompt: config.naming.customPrompt ?? null
    }),
    ai: sortRecord({
      backend: config.ai.backend,
      providerSource: config.ai.providerSource,
      profile: config.ai.profile,
      temperature: config.ai.temperature,
      requestedBackend: provider.requestedBackend,
      profileId: provider.profileId,
      providerRef: provider.providerRef,
      baseUrl: provider.baseUrl,
      model: provider.model,
      requestType: provider.requestType
    })
  });
}

export function computeRenameRuleSignature(config: EffectiveConfig): string {
  return sha256(JSON.stringify(buildRenameRuleSignatureBasis(config)));
}
