import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";

import { LocalApiClient } from "./api.js";
import { computeTerminalLayout, measureDisplayWidth, truncateDisplayText } from "./layout.js";
import type {
  BatchApplyResponse,
  ConfigDocument,
  ConfigView,
  ProviderProfile,
  SessionDetail,
  SessionSummary,
  SessionTranscriptEntry,
  SessionTranscriptPage
} from "./types.js";

type InputMode = "normal" | "search" | "rename" | "edit-setting";
type FocusPane = "sessions" | "transcript";
type TranscriptRoleFilter = "all" | "user" | "assistant" | "tool" | "system";
type ScreenMode = "browser" | "settings";
type BrowserViewMode = "split" | "detail" | "sessions";
type SettingKey =
  | "namingTemplate"
  | "namingMaxLength"
  | "namingLanguage"
  | "renameMode"
  | "renameAutoApply"
  | "candidateIdleSeconds"
  | "finalizeIdleSeconds"
  | "renameCooldownSeconds"
  | "aiBackend"
  | "aiProviderSource"
  | "aiProfile"
  | "aiTimeoutSeconds"
  | "aiTemperature"
  | "providerBaseUrl"
  | "providerModel"
  | "providerApiKey"
  | "providerWireApi";

type SettingsDraft = {
  namingTemplate: string;
  namingMaxLength: string;
  namingLanguage: string;
  renameMode: string;
  renameAutoApply: string;
  candidateIdleSeconds: string;
  finalizeIdleSeconds: string;
  renameCooldownSeconds: string;
  aiBackend: string;
  aiProviderSource: string;
  aiProfile: string;
  aiTimeoutSeconds: string;
  aiTemperature: string;
  providerProfiles: ProviderProfile[];
  selectedProfileId: string;
};

type RenameMode = "heuristic" | "ai" | "hybrid";
type RenameAutoApply = "off" | "idle-finalize" | "suggest-only";
type AiBackend = "none" | "codex" | "openai-compatible";
type ProviderSource = "inherit-codex" | "explicit";

const TRANSCRIPT_PAGE_SIZE = 18;

function formatWhen(value?: string): string {
  if (!value) {
    return "n/a";
  }

  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function compactWhitespace(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function windowItemsAround<T>(items: T[], selectedIndex: number, maxItems: number): Array<{ item: T; index: number }> {
  if (items.length === 0 || maxItems <= 0) {
    return [];
  }

  if (items.length <= maxItems) {
    return items.map((item, index) => ({ item, index }));
  }

  const half = Math.floor(maxItems / 2);
  let start = Math.max(0, selectedIndex - half);
  let end = Math.min(items.length, start + maxItems);
  start = Math.max(0, end - maxItems);

  return items.slice(start, end).map((item, offset) => ({
    item,
    index: start + offset
  }));
}

function useTerminalMetrics() {
  const { stdout } = useStdout();
  const readMetrics = () => ({
    columns: process.stdout.columns ?? stdout.columns ?? 120,
    rows: process.stdout.rows ?? stdout.rows ?? 40
  });
  const [metrics, setMetrics] = useState(readMetrics);

  useEffect(() => {
    const update = () => {
      setMetrics(readMetrics());
    };

    update();
    stdout.on("resize", update);
    process.stdout.on("resize", update);
    process.on("SIGWINCH", update);

    return () => {
      if (typeof stdout.off === "function") {
        stdout.off("resize", update);
      } else {
        stdout.removeListener("resize", update);
      }
      if (typeof process.stdout.off === "function") {
        process.stdout.off("resize", update);
      } else {
        process.stdout.removeListener("resize", update);
      }
      process.off("SIGWINCH", update);
    };
  }, [stdout]);

  return metrics;
}

function roleColor(role: SessionTranscriptEntry["role"]): "cyan" | "green" | "yellow" | "gray" {
  if (role === "user") {
    return "cyan";
  }
  if (role === "assistant") {
    return "green";
  }
  if (role === "tool") {
    return "yellow";
  }
  return "gray";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumberString(value: unknown, fallback = ""): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : fallback;
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
    enabled: typeof record.enabled === "boolean" ? record.enabled : true,
    isDefault: typeof record.isDefault === "boolean" ? record.isDefault : typeof record.is_default === "boolean" ? Boolean(record.is_default) : false
  };
}

function buildSettingsDraft(configView: ConfigView): SettingsDraft {
  const effective = asRecord(configView.effectiveConfig);
  const naming = asRecord(effective.naming);
  const rename = asRecord(effective.rename);
  const watch = asRecord(effective.watch);
  const ai = asRecord(effective.ai);
  const profiles = Array.isArray(effective.providerProfiles) ? effective.providerProfiles.map(normalizeProfile) : [];
  const selectedProfileId = asString(ai.profile, profiles.find((item) => item.isDefault)?.profileId ?? profiles[0]?.profileId ?? "default");
  const selectedProfile = profiles.find((profile) => profile.profileId === selectedProfileId) ?? profiles[0];

  return {
    namingTemplate: asString(naming.template, "{{time:%m%d-%H%M}} {{kind}}{{scope_paren}}: {{summary}}"),
    namingMaxLength: asNumberString(naming.maxLength || naming.max_length, "72"),
    namingLanguage: asString(naming.language, "zh-CN"),
    renameMode: asString(rename.mode, "hybrid"),
    renameAutoApply: asString(rename.autoApply || rename.auto_apply, "idle-finalize"),
    candidateIdleSeconds: asNumberString(watch.candidateIdleSeconds || watch.candidate_idle_seconds, "120"),
    finalizeIdleSeconds: asNumberString(watch.finalizeIdleSeconds || watch.finalize_idle_seconds, "600"),
    renameCooldownSeconds: asNumberString(watch.renameCooldownSeconds || watch.rename_cooldown_seconds, "900"),
    aiBackend: asString(ai.backend, "codex"),
    aiProviderSource: asString(ai.providerSource || ai.provider_source, "inherit-codex"),
    aiProfile: asString(ai.profile, selectedProfileId),
    aiTimeoutSeconds: asNumberString(ai.timeoutSeconds || ai.timeout_seconds, "45"),
    aiTemperature: asNumberString(ai.temperature, "0.2"),
    providerProfiles: profiles,
    selectedProfileId: selectedProfile?.profileId ?? selectedProfileId
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

function stripEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function updateSelectedProfile(
  profiles: ProviderProfile[],
  profileId: string,
  patch: Partial<ProviderProfile>
): ProviderProfile[] {
  return profiles.map((profile) => (profile.profileId === profileId ? { ...profile, ...patch } : profile));
}

function fitDisplayLine(value: string | undefined, width: number, fallback = "n/a"): string {
  const truncated = truncateDisplayText(value, width, fallback);
  const padding = Math.max(0, width - measureDisplayWidth(truncated));
  return `${truncated}${" ".repeat(padding)}`;
}

function encodeSettingsDraft(draft: SettingsDraft): ConfigDocument {
  return {
    rename: {
      mode: draft.renameMode as RenameMode,
      autoApply: draft.renameAutoApply as RenameAutoApply
    },
    watch: {
      candidateIdleSeconds: parseNumber(draft.candidateIdleSeconds),
      finalizeIdleSeconds: parseNumber(draft.finalizeIdleSeconds),
      renameCooldownSeconds: parseNumber(draft.renameCooldownSeconds)
    },
    naming: {
      template: stripEmpty(draft.namingTemplate),
      maxLength: parseNumber(draft.namingMaxLength),
      language: stripEmpty(draft.namingLanguage)
    },
    ai: {
      backend: draft.aiBackend as AiBackend,
      providerSource: draft.aiProviderSource as ProviderSource,
      profile: stripEmpty(draft.aiProfile),
      timeoutSeconds: parseNumber(draft.aiTimeoutSeconds),
      temperature: parseNumber(draft.aiTemperature)
    },
    providerProfiles: draft.providerProfiles.map((profile) => ({
      profileId: profile.profileId,
      backendKind: profile.backendKind,
      displayName: stripEmpty(profile.displayName ?? ""),
      providerSource: profile.providerSource,
      providerRef: stripEmpty(profile.providerRef ?? ""),
      baseUrl: stripEmpty(profile.baseUrl ?? ""),
      model: stripEmpty(profile.model ?? ""),
      apiKey: stripEmpty(profile.apiKey ?? ""),
      apiKeyRef: stripEmpty(profile.apiKeyRef ?? ""),
      headers: profile.headers,
      wireApi: profile.wireApi,
      enabled: profile.enabled,
      isDefault: profile.isDefault
    }))
  };
}

function cycle<T extends string>(current: T, values: readonly T[]): T {
  const index = values.indexOf(current);
  return values[(index + 1) % values.length] as T;
}

function SessionRow(props: {
  session: SessionSummary;
  active: boolean;
  width: number;
}) {
  const title = props.session.officialName ?? props.session.candidateName ?? props.session.threadId;
  const line1 = truncateDisplayText(title, props.width);
  const line2 = truncateDisplayText(
    [formatWhen(props.session.updatedAt), props.session.statusEstimate ?? "unknown", props.session.projectName ?? props.session.cwd ?? "n/a"]
      .filter(Boolean)
      .join(" | "),
    props.width
  );
  const line3 = truncateDisplayText(
    [props.session.provider ?? "n/a", `${props.session.taskCompleteCount}t`, props.session.dirty ? "dirty" : "clean", props.session.frozen ? "frozen" : null, props.session.manualOverride ? "manual" : null]
      .filter(Boolean)
      .join(" | "),
    props.width
  );

  return (
    <Box flexDirection="column" width={props.width} marginBottom={1}>
      <Text inverse={props.active} color={props.active ? "black" : "white"} wrap="truncate-end">
        {fitDisplayLine(line1, props.width, "")}
      </Text>
      <Text color={props.active ? "cyan" : "gray"} inverse={props.active} wrap="truncate-end">
        {fitDisplayLine(line2, props.width, "")}
      </Text>
      <Text color={props.active ? "yellow" : "gray"} inverse={props.active} wrap="truncate-end">
        {fitDisplayLine(line3, props.width, "")}
      </Text>
    </Box>
  );
}

function TranscriptRow(props: {
  entry: SessionTranscriptEntry;
  active: boolean;
  width: number;
  compact: boolean;
}) {
  const header = [props.entry.role, props.entry.kind, props.entry.name ?? props.entry.phase ?? props.entry.hiddenReason ?? null]
    .filter(Boolean)
    .join(" · ");
  const content = compactWhitespace(props.entry.content) || "(empty)";

  return (
    <Box flexDirection="column" width={props.width} marginBottom={props.compact ? 0 : 1}>
      <Box justifyContent="space-between" width={props.width}>
        <Text color={roleColor(props.entry.role)} inverse={props.active} wrap="truncate-end">
          {truncateDisplayText(header, Math.max(12, props.width - 14))}
        </Text>
        <Text color="gray" inverse={props.active}>
          {truncateDisplayText(formatWhen(props.entry.timestamp), 11, "")}
        </Text>
      </Box>
      <Text color={props.active ? "white" : undefined} inverse={props.active} wrap="truncate-end">
        {truncateDisplayText(content, props.width)}
      </Text>
    </Box>
  );
}

function PreviewRow(props: { item: BatchApplyResponse["items"][number]; width: number }) {
  const tone = props.item.status === "apply" ? "green" : "gray";
  const content = `${truncateDisplayText(props.item.threadId, 12)} | ${props.item.status} | ${
    props.item.candidateName ?? props.item.reason
  }`;
  return (
    <Box width={props.width}>
      <Text color={tone} wrap="truncate-end">
        {content}
      </Text>
    </Box>
  );
}

function SettingRow(props: {
  label: string;
  value: string;
  selected: boolean;
  width: number;
}) {
  const content = truncateDisplayText(`${props.label}: ${props.value || "(empty)"}`, props.width);
  return (
    <Text inverse={props.selected} color={props.selected ? "black" : "white"} wrap="truncate-end">
      {fitDisplayLine(content, props.width, "")}
    </Text>
  );
}

export function App(props: { apiBase: string; interactive: boolean }) {
  const { exit } = useApp();
  const [client] = useState(() => new LocalApiClient(props.apiBase));
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dirtyOnly, setDirtyOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [settingDraft, setSettingDraft] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("normal");
  const [focusPane, setFocusPane] = useState<FocusPane>("sessions");
  const [screenMode, setScreenMode] = useState<ScreenMode>("browser");
  const [browserViewMode, setBrowserViewMode] = useState<BrowserViewMode>("split");
  const [showPreviewPanel, setShowPreviewPanel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Loading sessions...");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<BatchApplyResponse["items"]>([]);
  const [transcriptPage, setTranscriptPage] = useState<SessionTranscriptPage | null>(null);
  const [transcriptItems, setTranscriptItems] = useState<SessionTranscriptEntry[]>([]);
  const [transcriptIndex, setTranscriptIndex] = useState(0);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [showHiddenTranscript, setShowHiddenTranscript] = useState(false);
  const [transcriptRole, setTranscriptRole] = useState<TranscriptRoleFilter>("all");
  const [configView, setConfigView] = useState<ConfigView | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsIndex, setSettingsIndex] = useState(0);
  const metrics = useTerminalMetrics();
  const layout = computeTerminalLayout(metrics, {
    screenMode,
    viewMode: browserViewMode,
    showPreview: screenMode === "browser" && showPreviewPanel
  });

  const selected = sessions[selectedIndex];
  const visibleSessions = windowItemsAround(sessions, selectedIndex, layout.visibleSessionCount);
  const visibleTranscriptCount = Math.max(
    4,
    Math.floor(Math.max(6, layout.detailHeight - (layout.compact ? 12 : 15)) / 3)
  );
  const visibleTranscript = windowItemsAround(transcriptItems, transcriptIndex, visibleTranscriptCount);

  const selectedProfile = settingsDraft?.providerProfiles.find(
    (profile) => profile.profileId === settingsDraft.selectedProfileId
  );

  const settingsFields = useMemo(() => {
    const profile = selectedProfile;
    return [
      { key: "namingTemplate", label: "Naming template", value: settingsDraft?.namingTemplate ?? "" },
      { key: "namingMaxLength", label: "Naming max length", value: settingsDraft?.namingMaxLength ?? "" },
      { key: "namingLanguage", label: "Naming language", value: settingsDraft?.namingLanguage ?? "" },
      { key: "renameMode", label: "Rename mode", value: settingsDraft?.renameMode ?? "" },
      { key: "renameAutoApply", label: "Rename auto apply", value: settingsDraft?.renameAutoApply ?? "" },
      { key: "candidateIdleSeconds", label: "Candidate idle sec", value: settingsDraft?.candidateIdleSeconds ?? "" },
      { key: "finalizeIdleSeconds", label: "Finalize idle sec", value: settingsDraft?.finalizeIdleSeconds ?? "" },
      { key: "renameCooldownSeconds", label: "Cooldown sec", value: settingsDraft?.renameCooldownSeconds ?? "" },
      { key: "aiBackend", label: "AI backend", value: settingsDraft?.aiBackend ?? "" },
      { key: "aiProviderSource", label: "AI provider source", value: settingsDraft?.aiProviderSource ?? "" },
      { key: "aiProfile", label: "AI profile", value: settingsDraft?.aiProfile ?? "" },
      { key: "aiTimeoutSeconds", label: "AI timeout", value: settingsDraft?.aiTimeoutSeconds ?? "" },
      { key: "aiTemperature", label: "AI temperature", value: settingsDraft?.aiTemperature ?? "" },
      { key: "providerBaseUrl", label: `Profile baseUrl (${profile?.profileId ?? "n/a"})`, value: profile?.baseUrl ?? "" },
      { key: "providerModel", label: "Profile model", value: profile?.model ?? "" },
      { key: "providerApiKey", label: "Profile apiKey", value: profile?.apiKey ?? "" },
      { key: "providerWireApi", label: "Profile wireApi", value: profile?.wireApi ?? "" }
    ] as Array<{ key: SettingKey; label: string; value: string }>;
  }, [selectedProfile, settingsDraft]);

  const activeSetting = settingsFields[settingsIndex];

  const requestExit = () => {
    exit();
    const timer = setTimeout(() => {
      process.exit(0);
    }, 20);
    timer.unref?.();
  };

  const reloadSessions = async (nextSelectedId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await client.listSessions({
        dirtyOnly,
        search,
        limit: 80
      });
      setSessions(payload.items);
      const nextIndex = nextSelectedId
        ? payload.items.findIndex((item) => item.threadId === nextSelectedId)
        : selected
          ? payload.items.findIndex((item) => item.threadId === selected.threadId)
          : 0;
      setSelectedIndex(nextIndex >= 0 ? nextIndex : 0);
      setMessage(`Loaded ${payload.items.length} sessions (${payload.counts.dirty} dirty / ${payload.counts.frozen} frozen)`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
      setSessions([]);
      setSelectedIndex(0);
    } finally {
      setLoading(false);
    }
  };

  const reloadDetail = async (threadId: string | undefined) => {
    if (!threadId) {
      setDetail(null);
      return;
    }

    try {
      const payload = await client.getSession(threadId);
      setDetail(payload);
      setRenameDraft(payload.candidateName ?? payload.officialName ?? "");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
      setDetail(null);
    }
  };

  const reloadTranscript = async (threadId: string | undefined) => {
    if (!threadId) {
      setTranscriptPage(null);
      setTranscriptItems([]);
      setTranscriptIndex(0);
      return;
    }

    setTranscriptLoading(true);
    setTranscriptError(null);
    try {
      const payload = await client.getSessionTranscript(threadId, {
        page: 1,
        pageSize: TRANSCRIPT_PAGE_SIZE,
        includeHidden: showHiddenTranscript,
        role: transcriptRole
      });
      setTranscriptPage(payload);
      setTranscriptItems(payload.items);
      setTranscriptIndex(Math.max(0, payload.items.length - 1));
    } catch (nextError) {
      setTranscriptError(nextError instanceof Error ? nextError.message : "Unknown error");
      setTranscriptPage(null);
      setTranscriptItems([]);
      setTranscriptIndex(0);
    } finally {
      setTranscriptLoading(false);
    }
  };

  const reloadConfig = async () => {
    try {
      const payload = await client.getConfig();
      setConfigView(payload);
      if (!settingsDirty) {
        setSettingsDraft(buildSettingsDraft(payload));
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
    }
  };

  const loadOlderTranscript = async () => {
    if (!selected?.threadId || !transcriptPage?.hasMore || transcriptLoading) {
      return;
    }

    setTranscriptLoading(true);
    setTranscriptError(null);
    try {
      const payload = await client.getSessionTranscript(selected.threadId, {
        page: transcriptPage.page + 1,
        pageSize: transcriptPage.pageSize,
        includeHidden: showHiddenTranscript,
        role: transcriptRole
      });
      setTranscriptItems((previous) => [...payload.items, ...previous]);
      setTranscriptPage(payload);
      setTranscriptIndex((previous) => previous + payload.items.length);
      setMessage(`Loaded ${payload.items.length} earlier transcript events`);
    } catch (nextError) {
      setTranscriptError(nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setTranscriptLoading(false);
    }
  };

  const runAction = async (operation: () => Promise<unknown>, successMessage: string) => {
    if (!selected) {
      return;
    }

    setLoading(true);
    setError(null);
    setMessage("Running action...");
    try {
      await operation();
      await reloadSessions(selected.threadId);
      await reloadDetail(selected.threadId);
      setMessage(successMessage);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const refreshPreview = async () => {
    try {
      setMessage("Refreshing preview...");
      const payload = await client.batchApplyDirty(true);
      setPreview(payload.items.slice(0, 12));
      setShowPreviewPanel(true);
      setMessage(`Preview refreshed: ${payload.items.filter((item) => item.status === "apply").length} ready`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
    }
  };

  const applySettingsFieldEdit = (key: SettingKey, value: string) => {
    if (!settingsDraft) {
      return;
    }

    setSettingsDirty(true);
    if (key === "providerBaseUrl" || key === "providerModel" || key === "providerApiKey" || key === "providerWireApi") {
      const patch: Partial<ProviderProfile> =
        key === "providerBaseUrl"
          ? { baseUrl: value }
          : key === "providerModel"
            ? { model: value }
            : key === "providerApiKey"
              ? { apiKey: value }
              : { wireApi: value as ProviderProfile["wireApi"] };
      setSettingsDraft({
        ...settingsDraft,
        providerProfiles: updateSelectedProfile(settingsDraft.providerProfiles, settingsDraft.selectedProfileId, patch)
      });
      return;
    }

    setSettingsDraft({
      ...settingsDraft,
      [key]: value
    });
  };

  const cycleSettingsField = (key: SettingKey) => {
    if (!settingsDraft) {
      return;
    }

    setSettingsDirty(true);
    if (key === "renameMode") {
      setSettingsDraft({ ...settingsDraft, renameMode: cycle(settingsDraft.renameMode, ["heuristic", "hybrid", "ai"] as const) });
      return;
    }
    if (key === "renameAutoApply") {
      setSettingsDraft({ ...settingsDraft, renameAutoApply: cycle(settingsDraft.renameAutoApply, ["off", "suggest-only", "idle-finalize"] as const) });
      return;
    }
    if (key === "aiBackend") {
      setSettingsDraft({ ...settingsDraft, aiBackend: cycle(settingsDraft.aiBackend, ["codex", "openai-compatible", "none"] as const) });
      return;
    }
    if (key === "aiProviderSource") {
      setSettingsDraft({ ...settingsDraft, aiProviderSource: cycle(settingsDraft.aiProviderSource, ["inherit-codex", "explicit"] as const) });
      return;
    }
    if (key === "providerWireApi" && selectedProfile) {
      setSettingsDraft({
        ...settingsDraft,
        providerProfiles: updateSelectedProfile(settingsDraft.providerProfiles, settingsDraft.selectedProfileId, {
          wireApi: cycle(selectedProfile.wireApi ?? "auto", ["auto", "responses", "chat_completions"] as const)
        })
      });
      return;
    }
  };

  const saveSettings = async () => {
    if (!settingsDraft) {
      return;
    }
    setLoading(true);
    setError(null);
    setMessage("Saving settings...");
    try {
      const payload = await client.updateConfig(encodeSettingsDraft(settingsDraft));
      setConfigView(payload.config);
      setSettingsDraft(buildSettingsDraft(payload.config));
      setSettingsDirty(false);
      setMessage(payload.restartRequired ? "Saved settings (restart required)." : "Saved settings.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reloadSessions();
    void reloadConfig();
  }, [dirtyOnly, search]);

  useEffect(() => {
    void reloadDetail(selected?.threadId);
  }, [selected?.threadId]);

  useEffect(() => {
    void reloadTranscript(selected?.threadId);
  }, [selected?.threadId, showHiddenTranscript, transcriptRole]);

  useInput((input, key) => {
    if (!props.interactive) {
      return;
    }

    if (inputMode === "search") {
      if (key.escape) {
        setSearchDraft(search);
        setInputMode("normal");
      }
      return;
    }

    if (inputMode === "rename") {
      if (key.escape) {
        setRenameDraft(detail?.candidateName ?? detail?.officialName ?? "");
        setInputMode("normal");
      }
      return;
    }

    if (inputMode === "edit-setting") {
      if (key.escape) {
        setSettingDraft(activeSetting?.value ?? "");
        setInputMode("normal");
      }
      return;
    }

    if ((key.ctrl && input === "c") || input === "q") {
      requestExit();
      return;
    }

    if (input === ",") {
      setScreenMode((current) => (current === "browser" ? "settings" : "browser"));
      return;
    }

    if (screenMode === "settings") {
      if (key.escape) {
        setScreenMode("browser");
        return;
      }
      if (key.upArrow || input === "k") {
        setSettingsIndex((value) => Math.max(0, value - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        setSettingsIndex((value) => Math.min(Math.max(0, settingsFields.length - 1), value + 1));
        return;
      }
      if (input === "e" || key.return) {
        setSettingDraft(activeSetting?.value ?? "");
        setInputMode("edit-setting");
        return;
      }
      if (input === " ") {
        if (activeSetting) {
          cycleSettingsField(activeSetting.key);
        }
        return;
      }
      if (input === "s") {
        void saveSettings();
        return;
      }
      if (input === "R") {
        setSettingsDirty(false);
        void reloadConfig();
        return;
      }
      return;
    }

    if (key.escape) {
      if (browserViewMode !== "split") {
        setBrowserViewMode("split");
      } else {
        requestExit();
      }
      return;
    }

    if (key.tab) {
      setFocusPane((current) => (current === "sessions" ? "transcript" : "sessions"));
      return;
    }

    if (input === "z") {
      setBrowserViewMode((current) => {
        if (current !== "split") {
          return "split";
        }
        return focusPane === "transcript" ? "detail" : "sessions";
      });
      return;
    }

    if (input === "v") {
      setBrowserViewMode((current) => (current === "detail" ? "split" : "detail"));
      setFocusPane("transcript");
      return;
    }

    if (input === "d") {
      setDirtyOnly((value) => !value);
      return;
    }

    if (input === "/") {
      setSearchDraft(search);
      setInputMode("search");
      return;
    }

    if (input === "r" && detail) {
      setRenameDraft(detail.candidateName ?? detail.officialName ?? "");
      setInputMode("rename");
      return;
    }

    if (input === "h") {
      setShowHiddenTranscript((value) => !value);
      return;
    }

    if (input === "1") {
      setTranscriptRole("all");
      return;
    }
    if (input === "2") {
      setTranscriptRole("user");
      return;
    }
    if (input === "3") {
      setTranscriptRole("assistant");
      return;
    }
    if (input === "4") {
      setTranscriptRole("tool");
      return;
    }
    if (input === "5") {
      setTranscriptRole("system");
      return;
    }

    if (input === "o") {
      void loadOlderTranscript();
      return;
    }

    if (input === "p") {
      if (showPreviewPanel) {
        setShowPreviewPanel(false);
      } else {
        void refreshPreview();
      }
      return;
    }

    if (key.upArrow || input === "k") {
      if (focusPane === "sessions") {
        setSelectedIndex((value) => Math.max(0, value - 1));
      } else {
        if (transcriptIndex <= 0 && transcriptPage?.hasMore) {
          void loadOlderTranscript();
        } else {
          setTranscriptIndex((value) => Math.max(0, value - 1));
        }
      }
      return;
    }

    if (key.downArrow || input === "j") {
      if (focusPane === "sessions") {
        setSelectedIndex((value) => Math.min(Math.max(0, sessions.length - 1), value + 1));
      } else {
        setTranscriptIndex((value) => Math.min(Math.max(0, transcriptItems.length - 1), value + 1));
      }
      return;
    }

    if (input === "g") {
      if (focusPane === "sessions") {
        setSelectedIndex(0);
      } else {
        setTranscriptIndex(0);
      }
      return;
    }

    if (input === "G") {
      if (focusPane === "sessions") {
        setSelectedIndex(Math.max(0, sessions.length - 1));
      } else {
        setTranscriptIndex(Math.max(0, transcriptItems.length - 1));
      }
      return;
    }

    if (input === "s" && selected) {
      void runAction(() => client.suggest(selected.threadId), `Suggested ${truncateDisplayText(selected.threadId, 12)}`);
      return;
    }

    if (input === "a" && selected) {
      void runAction(() => client.apply(selected.threadId), `Applied ${truncateDisplayText(selected.threadId, 12)}`);
      return;
    }

    if (input === "f" && detail) {
      void runAction(
        () => client.freeze(detail.threadId, !detail.frozen),
        `${detail.frozen ? "Unfroze" : "Froze"} ${truncateDisplayText(detail.threadId, 12)}`
      );
      return;
    }

    if (input === "m" && detail) {
      void runAction(
        () => client.setManualOverride(detail.threadId, !detail.manualOverride),
        `${detail.manualOverride ? "Cleared manual override for" : "Enabled manual override for"} ${truncateDisplayText(detail.threadId, 12)}`
      );
      return;
    }

    if (input === "A") {
      setLoading(true);
      setError(null);
      setMessage("Applying batch rename...");
      void client
        .batchApplyDirty(false)
        .then(async (payload) => {
          setPreview(payload.items.slice(0, 12));
          setShowPreviewPanel(true);
          setMessage(`Batch apply finished: ${payload.items.filter((item) => item.status === "apply").length} applied candidates`);
          await reloadSessions(selected?.threadId);
          await reloadDetail(selected?.threadId);
        })
        .catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : "Unknown error");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  });

  const transcriptSummary = useMemo(() => {
    if (!transcriptPage) {
      return "Transcript not loaded";
    }
    return `${transcriptItems.length}/${transcriptPage.totalItems} loaded · ${transcriptRole} · ${showHiddenTranscript ? "hidden:on" : "hidden:off"}`;
  }, [showHiddenTranscript, transcriptItems.length, transcriptPage, transcriptRole]);

  const selectedTranscript = transcriptItems[transcriptIndex];
  const detailTitle = detail ? detail.officialName ?? detail.candidateName ?? detail.threadId : "No session selected";
  const resolvedProviderSummary = asRecord(configView?.effectiveConfig).resolvedProvider
    ? JSON.stringify(asRecord(asRecord(configView?.effectiveConfig).resolvedProvider))
    : "n/a";

  const listPanel = (
    <Box flexDirection="column" width={layout.listWidth} height={layout.listHeight}>
      <Box justifyContent="space-between" width={layout.listWidth}>
        <Text color={focusPane === "sessions" ? "cyan" : "gray"}>Sessions [{sessions.length}]</Text>
        <Text color="gray">
          {browserViewMode} {layout.columns}x{layout.rows}
        </Text>
      </Box>
      <Box
        borderStyle="round"
        flexDirection="column"
        paddingX={1}
        width={layout.listWidth}
        height={Math.max(4, layout.listHeight - 1)}
        overflow="hidden"
      >
        {sessions.length === 0 ? <Text color="gray">No sessions matched the current filter.</Text> : null}
        {visibleSessions.map(({ item, index }) => (
          <SessionRow
            key={`${index}-${item.threadId}`}
            session={item}
            active={focusPane === "sessions" && index === selectedIndex}
            width={layout.listInnerWidth}
          />
        ))}
      </Box>
    </Box>
  );

  const detailPanel = (
    <Box flexDirection="column" width={layout.detailWidth} height={layout.detailHeight}>
      <Box justifyContent="space-between" width={layout.detailWidth}>
        <Text color={focusPane === "transcript" ? "cyan" : "gray"}>Detail & Transcript</Text>
        <Text color="gray">{transcriptSummary}</Text>
      </Box>
      <Box
        borderStyle="round"
        flexDirection="column"
        paddingX={1}
        width={layout.detailWidth}
        height={Math.max(4, layout.detailHeight - 1)}
        overflow="hidden"
      >
        <Text color="yellow" wrap="truncate-end">
          {truncateDisplayText(detailTitle, layout.detailInnerWidth)}
        </Text>
        <Text color="gray" wrap="truncate-end">
          {truncateDisplayText(
            [detail?.projectName ?? detail?.cwd ?? "n/a", detail?.provider ?? "n/a", detail?.model ?? "n/a"].join(" | "),
            layout.detailInnerWidth
          )}
        </Text>
        <Text color="gray" wrap="truncate-end">
          {truncateDisplayText(
            [`updated ${formatWhen(detail?.updatedAt)}`, `${detail?.tokenTotal ?? 0} tokens`, detail?.dirty ? "dirty" : "clean", detail?.frozen ? "frozen" : null, detail?.manualOverride ? "manual" : null]
              .filter(Boolean)
              .join(" | "),
            layout.detailInnerWidth
          )}
        </Text>
        <Text color="magenta" wrap="truncate-end">
          {detail?.candidateName
            ? `candidate: ${truncateDisplayText(detail.candidateName, Math.max(12, layout.detailInnerWidth - 11))}`
            : "candidate: n/a"}
        </Text>
        {detail?.renameHistory?.[0] ? (
          <Text color="gray" wrap="truncate-end">
            {truncateDisplayText(
              `last rename: ${detail.renameHistory[0].newName} | ${detail.renameHistory[0].kind}/${detail.renameHistory[0].source} | ${formatWhen(detail.renameHistory[0].appliedAt)}`,
              layout.detailInnerWidth
            )}
          </Text>
        ) : (
          <Text color="gray">last rename: none</Text>
        )}
        <Box marginTop={1} width={layout.detailInnerWidth}>
          <Text color="cyan">{transcriptLoading ? "Loading transcript..." : "Conversation"}</Text>
        </Box>
        {transcriptError ? (
          <Text color="red" wrap="truncate-end">
            {transcriptError}
          </Text>
        ) : null}
        {visibleTranscript.length === 0 && !transcriptLoading ? (
          <Text color="gray">No transcript events matched the current filter.</Text>
        ) : null}
        {visibleTranscript.map(({ item, index }) => (
          <TranscriptRow
            key={`${index}-${item.id}`}
            entry={item}
            active={focusPane === "transcript" && index === transcriptIndex}
            width={layout.detailInnerWidth}
            compact={layout.compact && browserViewMode !== "detail"}
          />
        ))}
        <Box marginTop={1}>
          <Text color="gray" wrap="truncate-end">
            {selectedTranscript
              ? `selected: ${selectedTranscript.role}/${selectedTranscript.kind} · ${formatWhen(selectedTranscript.timestamp)}`
              : transcriptPage?.hasMore
                ? "Press o to load earlier transcript events."
                : "No more transcript events."}
          </Text>
        </Box>
      </Box>
    </Box>
  );

  const settingsPanel = (
    <Box flexDirection="column" width={layout.listWidth} height={layout.topSectionHeight}>
      <Box justifyContent="space-between" width={layout.listWidth}>
        <Text color="cyan">Settings</Text>
        <Text color="gray">{settingsDirty ? "dirty" : "synced"}</Text>
      </Box>
      <Box
        borderStyle="round"
        flexDirection="column"
        paddingX={1}
        width={layout.listWidth}
        height={Math.max(6, layout.topSectionHeight - 1)}
        overflow="hidden"
      >
        {windowItemsAround(settingsFields, settingsIndex, Math.max(8, layout.visibleSessionCount + 3)).map(({ item, index }) => (
          <SettingRow
            key={`${item.key}-${index}`}
            label={item.label}
            value={item.value}
            selected={index === settingsIndex}
            width={layout.listInnerWidth}
          />
        ))}
      </Box>
    </Box>
  );

  const settingsInfoPanel = (
    <Box flexDirection="column" width={layout.detailWidth} height={layout.topSectionHeight}>
      <Box justifyContent="space-between" width={layout.detailWidth}>
        <Text color="gray">Config detail</Text>
        <Text color="gray">{configView?.paths.userConfigPath ?? "n/a"}</Text>
      </Box>
      <Box
        borderStyle="round"
        flexDirection="column"
        paddingX={1}
        width={layout.detailWidth}
        height={Math.max(6, layout.topSectionHeight - 1)}
        overflow="hidden"
      >
        <Text color="yellow" wrap="truncate-end">
          {truncateDisplayText(`selected profile: ${selectedProfile?.profileId ?? "n/a"}`, layout.detailInnerWidth)}
        </Text>
        <Text color="gray" wrap="truncate-end">
          {truncateDisplayText(`baseUrl: ${selectedProfile?.baseUrl ?? "n/a"}`, layout.detailInnerWidth)}
        </Text>
        <Text color="gray" wrap="truncate-end">
          {truncateDisplayText(`model: ${selectedProfile?.model ?? "n/a"}`, layout.detailInnerWidth)}
        </Text>
        <Text color="gray" wrap="truncate-end">
          {truncateDisplayText(`wireApi: ${selectedProfile?.wireApi ?? "n/a"}`, layout.detailInnerWidth)}
        </Text>
        <Text color="gray" wrap="truncate-end">
          {truncateDisplayText(`resolved: ${resolvedProviderSummary}`, layout.detailInnerWidth)}
        </Text>
        <Box marginTop={1}>
          <Text color="gray" wrap="truncate-end">
            e/edit field  space cycle enum  s save  R reload  , back to browser
          </Text>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box flexDirection="column" width={layout.columns}>
      <Box justifyContent="space-between">
        <Text color="yellow">Codex Session Manager TUI</Text>
        <Text color="gray">
          {screenMode === "browser"
            ? `${dirtyOnly ? "dirty-only" : "all"} | focus ${focusPane} | view ${browserViewMode} | api ${props.apiBase}`
            : `settings | api ${props.apiBase}`}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={error ? "red" : "green"}>{error ?? message}</Text>
      </Box>

      {!props.interactive ? (
        <Box marginTop={1}>
          <Text color="yellow">Input disabled: current stdin does not support raw mode.</Text>
        </Box>
      ) : null}

      {inputMode === "search" ? (
        <Box marginTop={1}>
          <Text color="cyan">Search: </Text>
          <TextInput
            value={searchDraft}
            onChange={setSearchDraft}
            onSubmit={(value) => {
              setSearch(value.trim());
              setInputMode("normal");
            }}
          />
        </Box>
      ) : null}

      {inputMode === "rename" ? (
        <Box marginTop={1}>
          <Text color="magenta">Rename: </Text>
          <TextInput
            value={renameDraft}
            onChange={setRenameDraft}
            onSubmit={(value) => {
              const nextName = value.trim();
              setInputMode("normal");
              if (!detail || !nextName) {
                return;
              }
              void runAction(() => client.rename(detail.threadId, nextName), `Renamed ${truncateDisplayText(detail.threadId, 12)}`);
            }}
          />
        </Box>
      ) : null}

      {inputMode === "edit-setting" ? (
        <Box marginTop={1}>
          <Text color="magenta">{activeSetting?.label ?? "Edit"}: </Text>
          <TextInput
            value={settingDraft}
            onChange={setSettingDraft}
            onSubmit={(value) => {
              if (activeSetting) {
                applySettingsFieldEdit(activeSetting.key, value);
              }
              setInputMode("normal");
            }}
          />
        </Box>
      ) : null}

      {screenMode === "browser" ? (
        <>
          <Box
            marginTop={1}
            gap={1}
            flexDirection={layout.stacked || browserViewMode !== "split" ? "column" : "row"}
            height={layout.topSectionHeight}
          >
            {browserViewMode !== "detail" ? listPanel : null}
            {browserViewMode !== "sessions" ? detailPanel : null}
          </Box>

          {showPreviewPanel ? (
            <Box marginTop={1} flexDirection="column" height={Math.max(5, layout.previewHeight || 8)}>
              <Text color="cyan">Batch preview</Text>
              <Box borderStyle="round" flexDirection="column" paddingX={1} height={Math.max(4, Math.max(5, layout.previewHeight || 8) - 1)} overflow="hidden">
                {preview.length === 0 ? <Text color="gray">No preview loaded.</Text> : null}
                {preview.slice(0, Math.max(3, layout.visiblePreviewCount)).map((item, index) => (
                  <PreviewRow key={`${index}-${item.threadId}`} item={item} width={layout.previewInnerWidth} />
                ))}
              </Box>
            </Box>
          ) : null}
        </>
      ) : layout.compact ? (
        <Box marginTop={1} flexDirection="column" gap={1} height={layout.topSectionHeight}>
          {settingsPanel}
          <Box borderStyle="round" flexDirection="column" paddingX={1} height={Math.max(5, Math.min(10, layout.rows - layout.topSectionHeight - 6))}>
            <Text color="yellow" wrap="truncate-end">
              {fitDisplayLine(activeSetting ? `${activeSetting.label}: ${activeSetting.value}` : "No setting selected", layout.previewInnerWidth)}
            </Text>
            <Text color="gray" wrap="truncate-end">
              {fitDisplayLine(`profile ${selectedProfile?.profileId ?? "n/a"} | model ${selectedProfile?.model ?? "n/a"}`, layout.previewInnerWidth)}
            </Text>
            <Text color="gray" wrap="truncate-end">
              {fitDisplayLine(`baseUrl ${selectedProfile?.baseUrl ?? "n/a"}`, layout.previewInnerWidth)}
            </Text>
            <Text color="gray" wrap="truncate-end">
              {fitDisplayLine("e edit  space cycle  s save  R reload  , back", layout.previewInnerWidth)}
            </Text>
          </Box>
        </Box>
      ) : (
        <Box marginTop={1} gap={1} flexDirection={layout.stacked ? "column" : "row"} height={layout.topSectionHeight}>
          {settingsPanel}
          {settingsInfoPanel}
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text color="gray" wrap="truncate-end">
          {screenMode === "browser"
            ? ", settings  z focus-full  v detail-full  tab switch-pane  j/k move  o older  h hidden  1-5 role  d dirty  / search  r rename  s suggest  a apply  f freeze  m manual  p preview  A batch-apply  q quit"
            : ", browser  j/k field  e edit  space cycle  s save  R reload  q quit"}
        </Text>
      </Box>
    </Box>
  );
}
