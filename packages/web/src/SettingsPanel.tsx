import { useEffect, useMemo, useState } from "react";

import type { ConfigDocument, ConfigView, OverviewResponse, ProviderProfile, ProviderResponse } from "./types.js";

type SettingsDraft = {
  namingPreset: string;
  namingTemplate: string;
  namingLanguage: string;
  namingMaxLength: string;
  renameMode: string;
  renameAutoApply: string;
  manualOverrideWins: boolean;
  freezeManualName: boolean;
  scanIntervalSeconds: string;
  candidateIdleSeconds: string;
  finalizeIdleSeconds: string;
  renameCooldownSeconds: string;
  minRolloutGrowthBytes: string;
  minTaskCompleteDelta: string;
  maxAutoRenamesPerSession: string;
  aiBackend: string;
  aiProviderSource: string;
  aiProfile: string;
  aiTimeoutSeconds: string;
  aiTemperature: string;
  maintenanceCompactMb: string;
  maintenanceCompactLines: string;
  maintenanceBackupBeforeCompact: boolean;
  providerProfiles: ProviderProfile[];
  selectedProfileId: string;
};

type RenameMode = "heuristic" | "ai" | "hybrid";
type RenameAutoApply = "off" | "idle-finalize" | "suggest-only";
type AiBackend = "none" | "codex" | "openai-compatible";
type ProviderSource = "inherit-codex" | "explicit";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumberString(value: unknown, fallback = ""): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeProfile(raw: unknown): ProviderProfile {
  const record = asRecord(raw);
  return {
    profileId: asString(record.profileId, "default"),
    backendKind: (asString(record.backendKind || record.backend_kind, "openai-compatible") as ProviderProfile["backendKind"]) ?? "openai-compatible",
    displayName: asString(record.displayName || record.display_name),
    providerSource: (asString(record.providerSource || record.provider_source, "explicit") as ProviderProfile["providerSource"]) ?? "explicit",
    providerRef: asString(record.providerRef || record.provider_ref),
    baseUrl: asString(record.baseUrl || record.base_url),
    model: asString(record.model),
    apiKey: asString(record.apiKey || record.api_key),
    apiKeyRef: asString(record.apiKeyRef || record.api_key_ref),
    headers: (record.headers as Record<string, string> | undefined) ?? {},
    wireApi: (asString(record.wireApi || record.wire_api, "auto") as ProviderProfile["wireApi"]) ?? "auto",
    enabled: asBoolean(record.enabled, true),
    isDefault: asBoolean(record.isDefault || record.is_default, false)
  };
}

function buildDraft(configView: ConfigView): SettingsDraft {
  const effective = asRecord(configView.effectiveConfig);
  const naming = asRecord(effective.naming);
  const rename = asRecord(effective.rename);
  const watch = asRecord(effective.watch);
  const ai = asRecord(effective.ai);
  const maintenance = asRecord(effective.maintenance);
  const providerProfilesRaw = Array.isArray(effective.providerProfiles) ? effective.providerProfiles : [];
  const providerProfiles = providerProfilesRaw.map(normalizeProfile);
  const selectedProfileId = asString(ai.profile, providerProfiles.find((item) => item.isDefault)?.profileId ?? providerProfiles[0]?.profileId ?? "default");

  return {
    namingPreset: asString(naming.preset, "conventional"),
    namingTemplate: asString(naming.template, "{{time:%m%d-%H%M}} {{kind}}{{scope_paren}}: {{summary}}"),
    namingLanguage: asString(naming.language, "zh-CN"),
    namingMaxLength: asNumberString(naming.maxLength || naming.max_length, "72"),
    renameMode: asString(rename.mode, "hybrid"),
    renameAutoApply: asString(rename.autoApply || rename.auto_apply, "idle-finalize"),
    manualOverrideWins: asBoolean(rename.manualOverrideWins || rename.manual_override_wins, true),
    freezeManualName: asBoolean(rename.freezeManualName || rename.freeze_manual_name, true),
    scanIntervalSeconds: asNumberString(watch.scanIntervalSeconds || watch.scan_interval_seconds, "300"),
    candidateIdleSeconds: asNumberString(watch.candidateIdleSeconds || watch.candidate_idle_seconds, "120"),
    finalizeIdleSeconds: asNumberString(watch.finalizeIdleSeconds || watch.finalize_idle_seconds, "600"),
    renameCooldownSeconds: asNumberString(watch.renameCooldownSeconds || watch.rename_cooldown_seconds, "900"),
    minRolloutGrowthBytes: asNumberString(watch.minRolloutGrowthBytes || watch.min_rollout_growth_bytes, "4096"),
    minTaskCompleteDelta: asNumberString(watch.minTaskCompleteDelta || watch.min_task_complete_delta, "1"),
    maxAutoRenamesPerSession: asNumberString(watch.maxAutoRenamesPerSession || watch.max_auto_renames_per_session, "2"),
    aiBackend: asString(ai.backend, "codex"),
    aiProviderSource: asString(ai.providerSource || ai.provider_source, "inherit-codex"),
    aiProfile: asString(ai.profile, selectedProfileId),
    aiTimeoutSeconds: asNumberString(ai.timeoutSeconds || ai.timeout_seconds, "45"),
    aiTemperature: asNumberString(ai.temperature, "0.2"),
    maintenanceCompactMb: asNumberString(maintenance.suggestCompactIndexAboveMb || maintenance.suggest_compact_index_above_mb, "5"),
    maintenanceCompactLines: asNumberString(maintenance.suggestCompactIndexAboveLines || maintenance.suggest_compact_index_above_lines, "20000"),
    maintenanceBackupBeforeCompact: asBoolean(maintenance.backupBeforeCompact || maintenance.backup_before_compact, true),
    providerProfiles,
    selectedProfileId
  };
}

function parseNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stripEmptyString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function encodeDraft(draft: SettingsDraft): ConfigDocument {
  return {
    rename: {
      mode: draft.renameMode as RenameMode,
      autoApply: draft.renameAutoApply as RenameAutoApply,
      manualOverrideWins: draft.manualOverrideWins,
      freezeManualName: draft.freezeManualName
    },
    watch: {
      scanIntervalSeconds: parseNumber(draft.scanIntervalSeconds),
      candidateIdleSeconds: parseNumber(draft.candidateIdleSeconds),
      finalizeIdleSeconds: parseNumber(draft.finalizeIdleSeconds),
      renameCooldownSeconds: parseNumber(draft.renameCooldownSeconds),
      minRolloutGrowthBytes: parseNumber(draft.minRolloutGrowthBytes),
      minTaskCompleteDelta: parseNumber(draft.minTaskCompleteDelta),
      maxAutoRenamesPerSession: parseNumber(draft.maxAutoRenamesPerSession)
    },
    naming: {
      preset: stripEmptyString(draft.namingPreset),
      template: stripEmptyString(draft.namingTemplate),
      language: stripEmptyString(draft.namingLanguage),
      maxLength: parseNumber(draft.namingMaxLength)
    },
    ai: {
      backend: draft.aiBackend as AiBackend,
      providerSource: draft.aiProviderSource as ProviderSource,
      profile: stripEmptyString(draft.aiProfile),
      timeoutSeconds: parseNumber(draft.aiTimeoutSeconds),
      temperature: parseNumber(draft.aiTemperature)
    },
    maintenance: {
      suggestCompactIndexAboveMb: parseNumber(draft.maintenanceCompactMb),
      suggestCompactIndexAboveLines: parseNumber(draft.maintenanceCompactLines),
      backupBeforeCompact: draft.maintenanceBackupBeforeCompact
    },
    providerProfiles: draft.providerProfiles.map((profile) => ({
      profileId: profile.profileId,
      backendKind: profile.backendKind,
      displayName: stripEmptyString(profile.displayName ?? ""),
      providerSource: profile.providerSource,
      providerRef: stripEmptyString(profile.providerRef ?? ""),
      baseUrl: stripEmptyString(profile.baseUrl ?? ""),
      model: stripEmptyString(profile.model ?? ""),
      apiKey: stripEmptyString(profile.apiKey ?? ""),
      apiKeyRef: stripEmptyString(profile.apiKeyRef ?? ""),
      headers: profile.headers,
      wireApi: profile.wireApi,
      enabled: profile.enabled,
      isDefault: profile.isDefault
    }))
  };
}

function updateSelectedProfile(
  profiles: ProviderProfile[],
  profileId: string,
  patch: Partial<ProviderProfile>
): ProviderProfile[] {
  return profiles.map((profile) => (profile.profileId === profileId ? { ...profile, ...patch } : profile));
}

function formatMetric(value: number | undefined): string {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

export function SettingsPanel(props: {
  configView: ConfigView | null;
  overview: OverviewResponse | null;
  previewApplyCount: number;
  providers: ProviderResponse | null;
  saving: boolean;
  onReload: () => void | Promise<void>;
  onSave: (patch: ConfigDocument) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!props.configView) {
      return;
    }
    if (!dirty) {
      setDraft(buildDraft(props.configView));
    }
  }, [dirty, props.configView]);

  const effective = asRecord(props.configView?.effectiveConfig);
  const inheritedCodex = asRecord(effective.inheritedCodex);
  const selectedProfile = useMemo(
    () => draft?.providerProfiles.find((profile) => profile.profileId === draft.selectedProfileId),
    [draft]
  );

  if (!props.configView || !draft) {
    return <section className="settings-layout"><div className="history-empty">Loading settings...</div></section>;
  }

  return (
    <section className="settings-layout">
      <header className="settings-header">
        <div>
          <h2>Settings</h2>
          <p>Configure naming rules, auto-rename cadence, and the AI/provider profile used for suggestions.</p>
        </div>
        <div className="header-actions">
          <button
            className="btn-refresh"
            onClick={() => {
              setDirty(false);
              void props.onReload();
            }}
            type="button"
          >
            Reload
          </button>
          <button
            className="btn-sm primary"
            disabled={!dirty || props.saving}
            onClick={() => {
              void (async () => {
                await props.onSave(encodeDraft(draft));
                setDirty(false);
              })();
            }}
            type="button"
          >
            {props.saving ? "Saving..." : "Save settings"}
          </button>
        </div>
      </header>

      <div className="settings-grid">
        <section className="detail-panel settings-panel settings-overview-panel settings-span-wide">
          <div className="settings-overview-header">
            <div>
              <p className="panel-kicker">Control State</p>
              <h3>Rename activity and queue health</h3>
              <p className="settings-copy">
                This panel tracks how many sessions are currently dirty, how many names have already been applied,
                and how often AI is actually being used to land final names.
              </p>
            </div>
          </div>

          <div className="settings-metrics-grid">
            <article className="metric-card">
              <span className="metric-label">Indexed sessions</span>
              <strong>{formatMetric(props.overview?.sessions.total)}</strong>
              <p>
                {formatMetric(props.overview?.sessions.workspaces)} workspaces, {formatMetric(props.overview?.sessions.named)} named
              </p>
            </article>
            <article className="metric-card">
              <span className="metric-label">Dirty queue</span>
              <strong>{formatMetric(props.overview?.sessions.dirty)}</strong>
              <p>
                {formatMetric(props.previewApplyCount)} ready to apply, {formatMetric(props.overview?.sessions.withCandidate)} with candidates
              </p>
            </article>
            <article className="metric-card">
              <span className="metric-label">AI applied</span>
              <strong>{formatMetric(props.overview?.renameHistory.aiApplied)}</strong>
              <p>
                {formatMetric(props.overview?.renameHistory.autoApplied)} auto-applied, {formatMetric(props.overview?.renameHistory.applied)} total applied
              </p>
            </article>
            <article className="metric-card">
              <span className="metric-label">Manual controls</span>
              <strong>{formatMetric(props.overview?.sessions.manualOverride)}</strong>
              <p>
                {formatMetric(props.overview?.sessions.frozen)} frozen, {formatMetric(props.overview?.renameHistory.manualApplied)} manual applies
              </p>
            </article>
          </div>

          <div className="settings-overview-detail">
            <article className="settings-mini-panel">
              <p className="panel-kicker">Pipeline</p>
              <dl className="settings-inline-stats">
                <div><dt>Active</dt><dd>{formatMetric(props.overview?.pipeline.active)}</dd></div>
                <div><dt>Candidate</dt><dd>{formatMetric(props.overview?.pipeline.candidateReady)}</dd></div>
                <div><dt>Finalize</dt><dd>{formatMetric(props.overview?.pipeline.finalizeReady)}</dd></div>
                <div><dt>Applied</dt><dd>{formatMetric(props.overview?.pipeline.applied)}</dd></div>
              </dl>
            </article>
            <article className="settings-mini-panel">
              <p className="panel-kicker">Rename Sources</p>
              <dl className="settings-inline-stats">
                <div><dt>Heuristic</dt><dd>{formatMetric(props.overview?.renameHistory.heuristicApplied)}</dd></div>
                <div><dt>Hybrid</dt><dd>{formatMetric(props.overview?.renameHistory.hybridApplied)}</dd></div>
                <div><dt>Batch</dt><dd>{formatMetric(props.overview?.renameHistory.batchApplied)}</dd></div>
                <div><dt>Preview only</dt><dd>{formatMetric(props.overview?.renameHistory.previewOnly)}</dd></div>
              </dl>
            </article>
          </div>
        </section>

        <section className="detail-panel settings-panel">
          <p className="panel-kicker">Style</p>
          <h3>Naming</h3>
          <p className="settings-copy">
            Control the visible session title format, context extraction strategy, and whether the rename engine stays heuristic or asks AI for structure.
          </p>
          <label className="settings-field">
            <span>Preset</span>
            <input
              value={draft.namingPreset}
              onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, namingPreset: event.target.value });
              }}
            />
          </label>
          <label className="settings-field settings-field-wide">
            <span>Template</span>
            <textarea
              rows={3}
              value={draft.namingTemplate}
              onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, namingTemplate: event.target.value });
              }}
            />
          </label>
          <div className="settings-two-up">
            <label className="settings-field">
              <span>Language</span>
              <input
                value={draft.namingLanguage}
                onChange={(event) => {
                  setDirty(true);
                  setDraft({ ...draft, namingLanguage: event.target.value });
                }}
              />
            </label>
            <label className="settings-field">
              <span>Max length</span>
              <input
                value={draft.namingMaxLength}
                onChange={(event) => {
                  setDirty(true);
                  setDraft({ ...draft, namingMaxLength: event.target.value });
                }}
              />
            </label>
          </div>
          <div className="settings-two-up">
            <label className="settings-field">
              <span>Rename mode</span>
              <select
                value={draft.renameMode}
                onChange={(event) => {
                  setDirty(true);
                  setDraft({ ...draft, renameMode: event.target.value });
                }}
              >
                <option value="heuristic">heuristic</option>
                <option value="hybrid">hybrid</option>
                <option value="ai">ai</option>
              </select>
            </label>
            <label className="settings-field">
              <span>Auto apply</span>
              <select
                value={draft.renameAutoApply}
                onChange={(event) => {
                  setDirty(true);
                  setDraft({ ...draft, renameAutoApply: event.target.value });
                }}
              >
                <option value="off">off</option>
                <option value="suggest-only">suggest-only</option>
                <option value="idle-finalize">idle-finalize</option>
              </select>
            </label>
          </div>
          <div className="settings-checks">
            <label className="toggle">
              <input
                checked={draft.manualOverrideWins}
                onChange={(event) => {
                  setDirty(true);
                  setDraft({ ...draft, manualOverrideWins: event.target.checked });
                }}
                type="checkbox"
              />
              Manual override wins
            </label>
            <label className="toggle">
              <input
                checked={draft.freezeManualName}
                onChange={(event) => {
                  setDirty(true);
                  setDraft({ ...draft, freezeManualName: event.target.checked });
                }}
                type="checkbox"
              />
              Freeze manual name
            </label>
          </div>
        </section>

        <section className="detail-panel settings-panel">
          <p className="panel-kicker">Scheduler</p>
          <h3>Auto Rename Watch</h3>
          <p className="settings-copy">
            These thresholds decide when a changed session becomes a candidate and when it is stable enough to finalize back into Codex.
          </p>
          <div className="settings-two-up">
            <label className="settings-field">
              <span>Scan interval</span>
              <input value={draft.scanIntervalSeconds} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, scanIntervalSeconds: event.target.value });
              }} />
            </label>
            <label className="settings-field">
              <span>Candidate idle</span>
              <input value={draft.candidateIdleSeconds} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, candidateIdleSeconds: event.target.value });
              }} />
            </label>
            <label className="settings-field">
              <span>Finalize idle</span>
              <input value={draft.finalizeIdleSeconds} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, finalizeIdleSeconds: event.target.value });
              }} />
            </label>
            <label className="settings-field">
              <span>Rename cooldown</span>
              <input value={draft.renameCooldownSeconds} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, renameCooldownSeconds: event.target.value });
              }} />
            </label>
            <label className="settings-field">
              <span>Min rollout growth</span>
              <input value={draft.minRolloutGrowthBytes} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, minRolloutGrowthBytes: event.target.value });
              }} />
            </label>
            <label className="settings-field">
              <span>Min task delta</span>
              <input value={draft.minTaskCompleteDelta} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, minTaskCompleteDelta: event.target.value });
              }} />
            </label>
            <label className="settings-field">
              <span>Max auto renames / session</span>
              <input value={draft.maxAutoRenamesPerSession} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, maxAutoRenamesPerSession: event.target.value });
              }} />
            </label>
          </div>
        </section>

        <section className="detail-panel settings-panel">
          <p className="panel-kicker">Provider</p>
          <h3>AI</h3>
          <p className="settings-copy">
            Pick whether naming runs through inherited Codex credentials or an explicit OpenAI-compatible profile, and tune the active profile below.
          </p>
          <div className="settings-two-up">
            <label className="settings-field">
              <span>Backend</span>
              <select value={draft.aiBackend} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, aiBackend: event.target.value });
              }}>
                <option value="codex">codex</option>
                <option value="openai-compatible">openai-compatible</option>
                <option value="none">none</option>
              </select>
            </label>
            <label className="settings-field">
              <span>Provider source</span>
              <select value={draft.aiProviderSource} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, aiProviderSource: event.target.value });
              }}>
                <option value="inherit-codex">inherit-codex</option>
                <option value="explicit">explicit</option>
              </select>
            </label>
            <label className="settings-field">
              <span>Active profile</span>
              <select value={draft.aiProfile} onChange={(event) => {
                const nextProfileId = event.target.value;
                setDirty(true);
                setDraft({ ...draft, aiProfile: nextProfileId, selectedProfileId: nextProfileId });
              }}>
                {draft.providerProfiles.map((profile) => (
                  <option key={profile.profileId} value={profile.profileId}>
                    {profile.profileId}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>Edit profile</span>
              <select value={draft.selectedProfileId} onChange={(event) => {
                setDraft({ ...draft, selectedProfileId: event.target.value });
              }}>
                {draft.providerProfiles.map((profile) => (
                  <option key={profile.profileId} value={profile.profileId}>
                    {profile.profileId}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>Timeout seconds</span>
              <input value={draft.aiTimeoutSeconds} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, aiTimeoutSeconds: event.target.value });
              }} />
            </label>
            <label className="settings-field">
              <span>Temperature</span>
              <input value={draft.aiTemperature} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, aiTemperature: event.target.value });
              }} />
            </label>
          </div>

          {selectedProfile ? (
            <div className="settings-profile-block">
              <div className="settings-two-up">
                <label className="settings-field">
                  <span>Display name</span>
                  <input value={selectedProfile.displayName ?? ""} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        displayName: event.target.value
                      })
                    });
                  }} />
                </label>
                <label className="settings-field">
                  <span>Backend kind</span>
                  <select value={selectedProfile.backendKind ?? "openai-compatible"} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        backendKind: event.target.value as ProviderProfile["backendKind"]
                      })
                    });
                  }}>
                    <option value="openai-compatible">openai-compatible</option>
                    <option value="codex">codex</option>
                    <option value="none">none</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>Profile source</span>
                  <select value={selectedProfile.providerSource ?? "explicit"} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        providerSource: event.target.value as ProviderProfile["providerSource"]
                      })
                    });
                  }}>
                    <option value="explicit">explicit</option>
                    <option value="inherit-codex">inherit-codex</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>Provider ref</span>
                  <input value={selectedProfile.providerRef ?? ""} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        providerRef: event.target.value
                      })
                    });
                  }} />
                </label>
                <label className="settings-field">
                  <span>Base URL</span>
                  <input value={selectedProfile.baseUrl ?? ""} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        baseUrl: event.target.value
                      })
                    });
                  }} />
                </label>
                <label className="settings-field">
                  <span>Model</span>
                  <input value={selectedProfile.model ?? ""} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        model: event.target.value
                      })
                    });
                  }} />
                </label>
                <label className="settings-field">
                  <span>Wire API</span>
                  <select value={selectedProfile.wireApi ?? "auto"} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        wireApi: event.target.value as ProviderProfile["wireApi"]
                      })
                    });
                  }}>
                    <option value="auto">auto</option>
                    <option value="responses">responses</option>
                    <option value="chat_completions">chat_completions</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>API key</span>
                  <input value={selectedProfile.apiKey ?? ""} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        apiKey: event.target.value
                      })
                    });
                  }} />
                </label>
                <label className="settings-field">
                  <span>API key ref</span>
                  <input value={selectedProfile.apiKeyRef ?? ""} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        apiKeyRef: event.target.value
                      })
                    });
                  }} />
                </label>
              </div>
              <div className="settings-checks">
                <label className="toggle">
                  <input checked={selectedProfile.enabled ?? true} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: updateSelectedProfile(draft.providerProfiles, draft.selectedProfileId, {
                        enabled: event.target.checked
                      })
                    });
                  }} type="checkbox" />
                  Enabled
                </label>
                <label className="toggle">
                  <input checked={selectedProfile.isDefault ?? false} onChange={(event) => {
                    setDirty(true);
                    setDraft({
                      ...draft,
                      providerProfiles: draft.providerProfiles.map((profile) => ({
                        ...profile,
                        isDefault: profile.profileId === draft.selectedProfileId ? event.target.checked : false
                      }))
                    });
                  }} type="checkbox" />
                  Default profile
                </label>
              </div>
            </div>
          ) : null}
        </section>

        <section className="detail-panel settings-panel">
          <p className="panel-kicker">Housekeeping</p>
          <h3>Maintenance</h3>
          <p className="settings-copy">
            Compact thresholds only affect suggestions and maintenance workflows. They do not rewrite the index automatically.
          </p>
          <div className="settings-two-up">
            <label className="settings-field">
              <span>Suggest compact above MB</span>
              <input value={draft.maintenanceCompactMb} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, maintenanceCompactMb: event.target.value });
              }} />
            </label>
            <label className="settings-field">
              <span>Suggest compact above lines</span>
              <input value={draft.maintenanceCompactLines} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, maintenanceCompactLines: event.target.value });
              }} />
            </label>
          </div>
          <div className="settings-checks">
            <label className="toggle">
              <input checked={draft.maintenanceBackupBeforeCompact} onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, maintenanceBackupBeforeCompact: event.target.checked });
              }} type="checkbox" />
              Backup before compact
            </label>
          </div>
        </section>

        <section className="detail-panel settings-panel">
          <p className="panel-kicker">Runtime</p>
          <h3>Resolved Environment</h3>
          <dl className="settings-readonly">
            <div>
              <dt>User config</dt>
              <dd>{props.configView.paths.userConfigPath}</dd>
            </div>
            <div>
              <dt>Project override</dt>
              <dd>{props.configView.paths.projectConfigPath}</dd>
            </div>
            <div>
              <dt>Resolved backend</dt>
              <dd>{String(props.providers?.resolvedProvider?.resolvedBackend ?? "n/a")}</dd>
            </div>
            <div>
              <dt>Resolved transport</dt>
              <dd>{String(props.providers?.resolvedProvider?.transport ?? "n/a")}</dd>
            </div>
            <div>
              <dt>Inherited model provider</dt>
              <dd>{String(inheritedCodex.modelProvider ?? "n/a")}</dd>
            </div>
            <div>
              <dt>Inherited model</dt>
              <dd>{String(inheritedCodex.model ?? "n/a")}</dd>
            </div>
          </dl>
          <details className="settings-disclosure">
            <summary>Inspect resolved provider payload</summary>
            <pre className="settings-json">{JSON.stringify(props.providers?.resolvedProvider ?? {}, null, 2)}</pre>
          </details>
        </section>
      </div>
    </section>
  );
}
