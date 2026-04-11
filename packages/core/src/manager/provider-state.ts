import type { EffectiveConfig } from "@codexnamer/shared";

import type { StateDatabase } from "../database.js";
import { inspectRenameProvider, probeRenameProvider } from "../provider.js";

export type ProviderTestSnapshot = {
  latestByFingerprint: Record<
    string,
    {
      ok: boolean;
      testedAt: string;
      latencyMs?: number;
      diagnostics: Record<string, unknown>;
      responseText?: string;
      error?: string;
    }
  >;
};

export function providerFingerprint(config: EffectiveConfig): string {
  const diagnostics = inspectRenameProvider(config);
  return JSON.stringify({
    requestedBackend: diagnostics.requestedBackend,
    profileId: diagnostics.profileId,
    providerRef: diagnostics.providerRef,
    baseUrl: diagnostics.baseUrl,
    model: diagnostics.model,
    requestType: diagnostics.requestType,
    credentialKind: diagnostics.credentialKind,
    credentialSource: diagnostics.credentialSource
  });
}

export function rememberProviderTest(
  db: StateDatabase,
  config: EffectiveConfig,
  result: {
    ok: boolean;
    testedAt: string;
    latencyMs?: number;
    diagnostics: Record<string, unknown>;
    responseText?: string;
    error?: string;
  }
): void {
  const snapshot = db.getMaintenanceState<ProviderTestSnapshot>("provider_tests");
  db.setMaintenanceState("provider_tests", {
    latestByFingerprint: {
      ...(snapshot?.latestByFingerprint ?? {}),
      [providerFingerprint(config)]: result
    }
  } satisfies ProviderTestSnapshot);
}

export function getLastProviderTest(db: StateDatabase, config: EffectiveConfig) {
  return db.getMaintenanceState<ProviderTestSnapshot>("provider_tests")?.latestByFingerprint?.[providerFingerprint(config)];
}

export async function requireSuccessfulProviderTest(db: StateDatabase, config: EffectiveConfig): Promise<void> {
  const latest = getLastProviderTest(db, config);
  if (latest?.ok) {
    return;
  }
  const result = await probeRenameProvider(config);
  rememberProviderTest(db, config, {
    ok: result.ok,
    testedAt: result.testedAt,
    latencyMs: result.latencyMs,
    diagnostics: result.diagnostics as unknown as Record<string, unknown>,
    responseText: result.responseText,
    error: result.error
  });
  if (!result.ok) {
    throw new Error("Provider has not passed connectivity test yet. Test it in Settings before rename.");
  }
}
