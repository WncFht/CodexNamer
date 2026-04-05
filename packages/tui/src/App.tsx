import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";

import { LocalApiClient } from "./api.js";
import {
  autoRenameReasonLabel,
  autoRenameStatusLabel,
  formatUiWhen,
  normalizeUiLanguage,
  sessionStatusLabel,
  t,
  type UiLanguage
} from "./i18n.js";
import { computeTerminalLayout, measureDisplayWidth, truncateDisplayText, wrapDisplayText } from "./layout.js";
import type {
  AutoRenamePreviewResponse,
  BatchApplyResponse,
  ConfigDocument,
  ConfigView,
  PromptPreviewResponse,
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
  | "uiLanguage"
  | "namingTemplate"
  | "namingMaxLength"
  | "namingLanguage"
  | "namingContextStrategy"
  | "namingContextMaxChars"
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
  uiLanguage: UiLanguage;
  namingTemplate: string;
  namingMaxLength: string;
  namingLanguage: string;
  namingContextStrategy: string;
  namingContextMaxChars: string;
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
const THEME = {
  accent: "#c96442",
  text: "#efe6d8",
  muted: "#a79d89",
  border: "#6f675d",
  borderActive: "#c96442",
  success: "#9bb06f",
  warning: "#d7a15b",
  danger: "#d26a55",
  manual: "#c58e73",
  bgAccent: "#d28b6a",
  bgDark: "#141413"
} as const;

function compactWhitespace(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function inLanguage(language: UiLanguage, zh: string, en: string): string {
  return language === "zh-CN" ? zh : en;
}

function transcriptRoleLabel(role: SessionTranscriptEntry["role"] | "all", language: UiLanguage): string {
  const map =
    language === "zh-CN"
      ? {
          all: "全部",
          user: "用户",
          assistant: "助手",
          tool: "工具",
          system: "系统"
        }
      : {
          all: "all",
          user: "user",
          assistant: "assistant",
          tool: "tool",
          system: "system"
        };
  return map[role];
}

function transcriptKindLabel(kind: SessionTranscriptEntry["kind"], language: UiLanguage): string {
  const map =
    language === "zh-CN"
      ? {
          message: "消息",
          tool_call: "工具调用",
          tool_output: "工具输出",
          reasoning: "思考",
          status: "状态"
        }
      : {
          message: "message",
          tool_call: "tool_call",
          tool_output: "tool_output",
          reasoning: "reasoning",
          status: "status"
        };
  return map[kind];
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
    return THEME.accent as never;
  }
  if (role === "assistant") {
    return THEME.success as never;
  }
  if (role === "tool") {
    return THEME.warning as never;
  }
  return THEME.muted as never;
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
  const general = asRecord(effective.general);
  const naming = asRecord(effective.naming);
  const rename = asRecord(effective.rename);
  const watch = asRecord(effective.watch);
  const ai = asRecord(effective.ai);
  const profiles = Array.isArray(effective.providerProfiles) ? effective.providerProfiles.map(normalizeProfile) : [];
  const selectedProfileId = asString(ai.profile, profiles.find((item) => item.isDefault)?.profileId ?? profiles[0]?.profileId ?? "default");
  const selectedProfile = profiles.find((profile) => profile.profileId === selectedProfileId) ?? profiles[0];

  return {
    uiLanguage: general.uiLanguage === "zh-CN" ? "zh-CN" : "en-US",
    namingTemplate: asString(naming.template, "{{time:%m%d-%H%M}} {{kind}}{{scope_paren}}: {{summary}}"),
    namingMaxLength: asNumberString(naming.maxLength || naming.max_length, "72"),
    namingLanguage: asString(naming.language, "zh-CN"),
    namingContextStrategy: asString(naming.contextStrategy || naming.context_strategy, "summary-signals"),
    namingContextMaxChars: asNumberString(naming.contextMaxChars || naming.context_max_chars, "8000"),
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
    general: {
      uiLanguage: draft.uiLanguage
    },
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
      language: stripEmpty(draft.namingLanguage),
      contextStrategy: stripEmpty(draft.namingContextStrategy) as "summary-signals" | "user-assistant-transcript" | undefined,
      contextMaxChars: parseNumber(draft.namingContextMaxChars)
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
  uiLanguage: UiLanguage;
}) {
  const title = props.session.officialName ?? props.session.candidateName ?? props.session.threadId;
  const line1 = truncateDisplayText(title, props.width);
  const line2 = truncateDisplayText(
    [
      formatUiWhen(props.session.updatedAt, props.uiLanguage),
      props.session.projectName ?? props.session.cwd ?? "n/a",
      props.session.provider ?? "n/a",
      props.session.dirty
        ? inLanguage(props.uiLanguage, "dirty", "dirty")
        : inLanguage(props.uiLanguage, "clean", "clean"),
      props.session.frozen ? inLanguage(props.uiLanguage, "冻结", "frozen") : null,
      props.session.manualOverride ? inLanguage(props.uiLanguage, "手动覆盖", "manual") : null,
      props.session.statusEstimate ? sessionStatusLabel(props.session.statusEstimate, props.uiLanguage) : null
    ]
      .filter(Boolean)
      .join(" · "),
    props.width
  );

  return (
    <Box flexDirection="column" width={props.width} marginBottom={1}>
      <Text
        color={props.active ? THEME.bgDark : THEME.text}
        backgroundColor={props.active ? THEME.bgAccent : undefined}
        wrap="truncate-end"
      >
        {fitDisplayLine(line1, props.width, "")}
      </Text>
      <Text
        color={props.active ? THEME.bgDark : THEME.muted}
        backgroundColor={props.active ? THEME.bgAccent : undefined}
        wrap="truncate-end"
      >
        {fitDisplayLine(line2, props.width, "")}
      </Text>
    </Box>
  );
}

function TranscriptRow(props: {
  entry: SessionTranscriptEntry;
  active: boolean;
  width: number;
  compact: boolean;
  uiLanguage: UiLanguage;
}) {
  const header = [
    transcriptRoleLabel(props.entry.role, props.uiLanguage),
    transcriptKindLabel(props.entry.kind, props.uiLanguage),
    props.entry.name ?? props.entry.phase ?? props.entry.hiddenReason ?? null
  ]
    .filter(Boolean)
    .join(" · ");
  const content = compactWhitespace(props.entry.content) || inLanguage(props.uiLanguage, "(空)", "(empty)");

  return (
    <Box flexDirection="column" width={props.width} marginBottom={props.compact ? 0 : 1}>
      <Box justifyContent="space-between" width={props.width}>
        <Text
          color={props.active ? THEME.bgDark : roleColor(props.entry.role)}
          backgroundColor={props.active ? THEME.bgAccent : undefined}
          wrap="truncate-end"
        >
          {fitDisplayLine(header, Math.max(12, props.width - 14), "")}
        </Text>
        <Text color={props.active ? THEME.bgDark : THEME.muted} backgroundColor={props.active ? THEME.bgAccent : undefined}>
          {fitDisplayLine(formatUiWhen(props.entry.timestamp, props.uiLanguage), 11, "")}
        </Text>
      </Box>
      <Text color={props.active ? THEME.bgDark : THEME.text} backgroundColor={props.active ? THEME.bgAccent : undefined} wrap="truncate-end">
        {fitDisplayLine(content, props.width)}
      </Text>
    </Box>
  );
}

function PreviewRow(props: { item: AutoRenamePreviewResponse["items"][number]; width: number; uiLanguage: UiLanguage }) {
  const tone =
    props.item.status === "apply" ? THEME.success : props.item.status === "suggest" ? THEME.warning : THEME.muted;
  const content = `${truncateDisplayText(props.item.threadId, 12)} | ${autoRenameStatusLabel(
    props.item.status,
    props.uiLanguage
  )} | ${truncateDisplayText(props.item.candidateName ?? autoRenameReasonLabel(props.item.reason, props.uiLanguage), Math.max(18, props.width - 24))}`;
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
    <Text
      color={props.selected ? THEME.bgDark : THEME.text}
      backgroundColor={props.selected ? THEME.bgAccent : undefined}
      wrap="truncate-end"
    >
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
  const [preview, setPreview] = useState<AutoRenamePreviewResponse["items"]>([]);
  const [transcriptPage, setTranscriptPage] = useState<SessionTranscriptPage | null>(null);
  const [transcriptItems, setTranscriptItems] = useState<SessionTranscriptEntry[]>([]);
  const [transcriptIndex, setTranscriptIndex] = useState(0);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [showHiddenTranscript, setShowHiddenTranscript] = useState(false);
  const [transcriptRole, setTranscriptRole] = useState<TranscriptRoleFilter>("all");
  const [expandedTranscript, setExpandedTranscript] = useState(false);
  const [expandedTranscriptScroll, setExpandedTranscriptScroll] = useState(0);
  const [configView, setConfigView] = useState<ConfigView | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsIndex, setSettingsIndex] = useState(0);
  const [promptPreview, setPromptPreview] = useState<PromptPreviewResponse | null>(null);
  const [promptPreviewRefreshing, setPromptPreviewRefreshing] = useState(false);
  const metrics = useTerminalMetrics();
  const layout = computeTerminalLayout(metrics, {
    screenMode,
    viewMode: browserViewMode,
    showPreview: screenMode === "browser" && showPreviewPanel
  });

  const selected = sessions[selectedIndex];
  const visibleSessions = windowItemsAround(sessions, selectedIndex, layout.visibleSessionCount);
  const historyReserveLines = expandedTranscript
    ? 0
    : detail?.renameHistory?.length
      ? browserViewMode === "detail"
        ? 6
        : 4
      : 2;
  const visibleTranscriptCount = Math.max(
    1,
    Math.floor(Math.max(3, layout.detailHeight - (layout.compact ? 12 : 15) - historyReserveLines) / 3)
  );
  const visibleTranscript = windowItemsAround(transcriptItems, transcriptIndex, visibleTranscriptCount);

  const selectedProfile = settingsDraft?.providerProfiles.find(
    (profile) => profile.profileId === settingsDraft.selectedProfileId
  );
  const uiLanguage = normalizeUiLanguage(configView);
  const tt = (key: Parameters<typeof t>[1]) => t(uiLanguage, key);
  const previewSuggestCount = preview.filter((item) => item.status === "suggest").length;
  const previewApplyCount = preview.filter((item) => item.status === "apply").length;
  const previewSkipCount = preview.filter((item) => item.status === "skip").length;

  const settingsFields = useMemo(() => {
    const profile = selectedProfile;
    return [
      { key: "uiLanguage", label: inLanguage(uiLanguage, "界面 / 语言", "UI / Language"), value: settingsDraft?.uiLanguage ?? "" },
      { key: "namingTemplate", label: inLanguage(uiLanguage, "命名 / 模板", "Naming / Template"), value: settingsDraft?.namingTemplate ?? "" },
      { key: "namingMaxLength", label: inLanguage(uiLanguage, "命名 / 最大长度", "Naming / Max length"), value: settingsDraft?.namingMaxLength ?? "" },
      { key: "namingLanguage", label: inLanguage(uiLanguage, "命名 / 语言", "Naming / Language"), value: settingsDraft?.namingLanguage ?? "" },
      { key: "namingContextStrategy", label: inLanguage(uiLanguage, "命名 / 上下文策略", "Naming / Context strategy"), value: settingsDraft?.namingContextStrategy ?? "" },
      { key: "namingContextMaxChars", label: inLanguage(uiLanguage, "命名 / 上下文长度上限", "Naming / Context max chars"), value: settingsDraft?.namingContextMaxChars ?? "" },
      { key: "renameMode", label: inLanguage(uiLanguage, "重命名 / 模式", "Rename / Mode"), value: settingsDraft?.renameMode ?? "" },
      { key: "renameAutoApply", label: inLanguage(uiLanguage, "重命名 / 自动应用", "Rename / Auto apply"), value: settingsDraft?.renameAutoApply ?? "" },
      { key: "candidateIdleSeconds", label: inLanguage(uiLanguage, "节奏 / 候选空闲秒数", "Cadence / Candidate idle sec"), value: settingsDraft?.candidateIdleSeconds ?? "" },
      { key: "finalizeIdleSeconds", label: inLanguage(uiLanguage, "节奏 / 终稿空闲秒数", "Cadence / Finalize idle sec"), value: settingsDraft?.finalizeIdleSeconds ?? "" },
      { key: "renameCooldownSeconds", label: inLanguage(uiLanguage, "节奏 / 冷却秒数", "Cadence / Cooldown sec"), value: settingsDraft?.renameCooldownSeconds ?? "" },
      { key: "aiBackend", label: "AI / Backend", value: settingsDraft?.aiBackend ?? "" },
      { key: "aiProviderSource", label: inLanguage(uiLanguage, "AI / Provider 来源", "AI / Provider source"), value: settingsDraft?.aiProviderSource ?? "" },
      { key: "aiProfile", label: "AI / Profile", value: settingsDraft?.aiProfile ?? "" },
      { key: "aiTimeoutSeconds", label: inLanguage(uiLanguage, "AI / 超时", "AI / Timeout"), value: settingsDraft?.aiTimeoutSeconds ?? "" },
      { key: "aiTemperature", label: inLanguage(uiLanguage, "AI / 温度", "AI / Temperature"), value: settingsDraft?.aiTemperature ?? "" },
      { key: "providerBaseUrl", label: inLanguage(uiLanguage, `Provider / Base URL (${profile?.profileId ?? tt("nA")})`, `Provider / baseUrl (${profile?.profileId ?? tt("nA")})`), value: profile?.baseUrl ?? "" },
      { key: "providerModel", label: inLanguage(uiLanguage, "Provider / 模型", "Provider / model"), value: profile?.model ?? "" },
      { key: "providerApiKey", label: "Provider / API key", value: profile?.apiKey ?? "" },
      { key: "providerWireApi", label: "Provider / Wire API", value: profile?.wireApi ?? "" }
    ] as Array<{ key: SettingKey; label: string; value: string }>;
  }, [selectedProfile, settingsDraft, tt, uiLanguage]);

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
      setMessage(
        inLanguage(
          uiLanguage,
          `已加载 ${payload.items.length} 个会话（dirty ${payload.counts.dirty} / 冻结 ${payload.counts.frozen}）`,
          `Loaded ${payload.items.length} sessions (${payload.counts.dirty} dirty / ${payload.counts.frozen} frozen)`
        )
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : inLanguage(uiLanguage, "未知错误", "Unknown error"));
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
      setError(nextError instanceof Error ? nextError.message : inLanguage(uiLanguage, "未知错误", "Unknown error"));
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
      setTranscriptError(nextError instanceof Error ? nextError.message : inLanguage(uiLanguage, "未知错误", "Unknown error"));
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
      setError(nextError instanceof Error ? nextError.message : inLanguage(uiLanguage, "未知错误", "Unknown error"));
    }
  };

  const reloadPromptPreview = async (threadId?: string, options?: { silent?: boolean }) => {
    setPromptPreviewRefreshing(true);
    try {
      const payload = await client.getPromptPreview(threadId);
      setPromptPreview(payload);
      if (!options?.silent) {
        setMessage(
          inLanguage(
            uiLanguage,
            payload.synthetic ? "已刷新 synthetic prompt 预览" : "已刷新当前会话 prompt 预览",
            payload.synthetic ? "Refreshed synthetic prompt preview" : "Refreshed prompt preview for selected session"
          )
        );
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : inLanguage(uiLanguage, "未知错误", "Unknown error"));
    } finally {
      setPromptPreviewRefreshing(false);
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
      setMessage(
        inLanguage(
          uiLanguage,
          `已加载更早的 ${payload.items.length} 条 transcript 事件`,
          `Loaded ${payload.items.length} earlier transcript events`
        )
      );
    } catch (nextError) {
      setTranscriptError(nextError instanceof Error ? nextError.message : inLanguage(uiLanguage, "未知错误", "Unknown error"));
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
    setMessage(inLanguage(uiLanguage, "正在执行操作...", "Running action..."));
    try {
      await operation();
      await reloadSessions(selected.threadId);
      await reloadDetail(selected.threadId);
      await reloadPromptPreview(selected.threadId, { silent: true });
      setMessage(successMessage);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : inLanguage(uiLanguage, "未知错误", "Unknown error"));
    } finally {
      setLoading(false);
    }
  };

  const refreshPreview = async () => {
    try {
      setMessage(inLanguage(uiLanguage, "正在刷新自动命名预览...", "Refreshing auto-rename preview..."));
      const payload = await client.getAutoRenamePreview({
        includeCandidateNames: true,
        limit: 12
      });
      setPreview(payload.items.slice(0, 12));
      setShowPreviewPanel(true);
      const suggestCount = payload.items.filter((item) => item.status === "suggest").length;
      const applyCount = payload.items.filter((item) => item.status === "apply").length;
      setMessage(
        inLanguage(
          uiLanguage,
          `预览已刷新：建议 ${suggestCount} / 应用 ${applyCount}`,
          `Preview refreshed: ${suggestCount} suggest / ${applyCount} apply`
        )
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : inLanguage(uiLanguage, "未知错误", "Unknown error"));
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
    if (key === "uiLanguage") {
      setSettingsDraft({ ...settingsDraft, uiLanguage: cycle(settingsDraft.uiLanguage, ["en-US", "zh-CN"] as const) });
      return;
    }
    if (key === "renameMode") {
      setSettingsDraft({ ...settingsDraft, renameMode: cycle(settingsDraft.renameMode, ["heuristic", "hybrid", "ai"] as const) });
      return;
    }
    if (key === "namingContextStrategy") {
      setSettingsDraft({
        ...settingsDraft,
        namingContextStrategy: cycle(settingsDraft.namingContextStrategy, ["summary-signals", "user-assistant-transcript"] as const)
      });
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
    setMessage(inLanguage(uiLanguage, "正在保存设置...", "Saving settings..."));
    try {
      const payload = await client.updateConfig(encodeSettingsDraft(settingsDraft));
      setConfigView(payload.config);
      setSettingsDraft(buildSettingsDraft(payload.config));
      setSettingsDirty(false);
      await reloadPromptPreview(selected?.threadId, { silent: true });
      setMessage(
        payload.restartRequired
          ? inLanguage(uiLanguage, "设置已保存（需要重启）。", "Saved settings (restart required).")
          : inLanguage(uiLanguage, "设置已保存。", "Saved settings.")
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : inLanguage(uiLanguage, "未知错误", "Unknown error"));
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

  useEffect(() => {
    void reloadPromptPreview(selected?.threadId, { silent: true });
  }, [selected?.threadId]);

  useEffect(() => {
    setExpandedTranscript(false);
    setExpandedTranscriptScroll(0);
  }, [selected?.threadId, transcriptIndex]);

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
      if (input === "p") {
        void reloadPromptPreview(selected?.threadId);
        return;
      }
      if (input === "R") {
        setSettingsDirty(false);
        void reloadConfig();
        void reloadPromptPreview(selected?.threadId, { silent: true });
        return;
      }
      return;
    }

    if (key.escape) {
      if (expandedTranscript) {
        setExpandedTranscript(false);
        setExpandedTranscriptScroll(0);
        return;
      }
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

    if (input === "h") {
      setFocusPane("sessions");
      return;
    }

    if (input === "l") {
      setFocusPane("transcript");
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

    if (input === "H") {
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

    if (key.return && focusPane === "transcript" && selectedTranscript) {
      setExpandedTranscript((current) => !current);
      setExpandedTranscriptScroll(0);
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
        if (expandedTranscript) {
          setExpandedTranscriptScroll((value) => Math.max(0, value - 1));
          return;
        }
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
        if (expandedTranscript) {
          setExpandedTranscriptScroll((value) => value + 1);
          return;
        }
        setTranscriptIndex((value) => Math.min(Math.max(0, transcriptItems.length - 1), value + 1));
      }
      return;
    }

    if (input === "g") {
      if (focusPane === "sessions") {
        setSelectedIndex(0);
      } else {
        if (expandedTranscript) {
          setExpandedTranscriptScroll(0);
          return;
        }
        setTranscriptIndex(0);
      }
      return;
    }

    if (input === "G") {
      if (focusPane === "sessions") {
        setSelectedIndex(Math.max(0, sessions.length - 1));
      } else {
        if (expandedTranscript) {
          setExpandedTranscriptScroll(Number.MAX_SAFE_INTEGER);
          return;
        }
        setTranscriptIndex(Math.max(0, transcriptItems.length - 1));
      }
      return;
    }

    if (input === "s" && selected) {
      void runAction(
        () => client.suggest(selected.threadId),
        inLanguage(
          uiLanguage,
          `已建议 ${truncateDisplayText(selected.threadId, 12)}`,
          `Suggested ${truncateDisplayText(selected.threadId, 12)}`
        )
      );
      return;
    }

    if (input === "a" && selected) {
      void runAction(
        () => client.apply(selected.threadId),
        inLanguage(
          uiLanguage,
          `已应用 ${truncateDisplayText(selected.threadId, 12)}`,
          `Applied ${truncateDisplayText(selected.threadId, 12)}`
        )
      );
      return;
    }

    if (input === "f" && detail) {
      void runAction(
        () => client.freeze(detail.threadId, !detail.frozen),
        inLanguage(
          uiLanguage,
          `${detail.frozen ? "已解冻" : "已冻结"} ${truncateDisplayText(detail.threadId, 12)}`,
          `${detail.frozen ? "Unfroze" : "Froze"} ${truncateDisplayText(detail.threadId, 12)}`
        )
      );
      return;
    }

    if (input === "m" && detail) {
      void runAction(
        () => client.setManualOverride(detail.threadId, !detail.manualOverride),
        inLanguage(
          uiLanguage,
          `${detail.manualOverride ? "已清除手动覆盖" : "已启用手动覆盖"} ${truncateDisplayText(detail.threadId, 12)}`,
          `${detail.manualOverride ? "Cleared manual override for" : "Enabled manual override for"} ${truncateDisplayText(detail.threadId, 12)}`
        )
      );
      return;
    }

    if (input === "A") {
      setLoading(true);
      setError(null);
      setMessage(inLanguage(uiLanguage, "正在批量应用命名...", "Applying batch rename..."));
      void client
        .batchApplyDirty(false)
        .then(async (payload: BatchApplyResponse) => {
          await refreshPreview();
          setShowPreviewPanel(true);
          setMessage(
            inLanguage(
              uiLanguage,
              `批量应用完成：已应用 ${payload.items.filter((item) => item.action === "applied").length} 个候选名`,
              `Batch apply finished: ${payload.items.filter((item) => item.action === "applied").length} applied candidates`
            )
          );
          await reloadSessions(selected?.threadId);
          await reloadDetail(selected?.threadId);
          await reloadPromptPreview(selected?.threadId, { silent: true });
        })
        .catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : inLanguage(uiLanguage, "未知错误", "Unknown error"));
        })
        .finally(() => {
          setLoading(false);
        });
    }
  });

  const transcriptSummary = useMemo(() => {
    if (!transcriptPage) {
      return inLanguage(uiLanguage, "尚未加载 transcript", "Transcript not loaded");
    }
    return `${transcriptItems.length}/${transcriptPage.totalItems} ${inLanguage(uiLanguage, "已加载", "loaded")} · ${transcriptRoleLabel(
      transcriptRole,
      uiLanguage
    )} · ${showHiddenTranscript ? inLanguage(uiLanguage, "隐藏:开", "hidden:on") : inLanguage(uiLanguage, "隐藏:关", "hidden:off")}`;
  }, [showHiddenTranscript, transcriptItems.length, transcriptPage, transcriptRole, uiLanguage]);

  const selectedTranscript = transcriptItems[transcriptIndex];
  const expandedTranscriptLines = useMemo(() => {
    if (!selectedTranscript) {
      return [];
    }
    return wrapDisplayText(selectedTranscript.content, layout.detailInnerWidth);
  }, [layout.detailInnerWidth, selectedTranscript]);
  const expandedTranscriptVisibleCount = Math.max(3, layout.detailHeight - 12);
  const expandedTranscriptMaxScroll = Math.max(0, expandedTranscriptLines.length - expandedTranscriptVisibleCount);
  const normalizedExpandedTranscriptScroll = Math.min(expandedTranscriptScroll, expandedTranscriptMaxScroll);
  const visibleExpandedTranscriptLines = expandedTranscriptLines.slice(
    normalizedExpandedTranscriptScroll,
    normalizedExpandedTranscriptScroll + expandedTranscriptVisibleCount
  );
  const detailTitle = detail
    ? detail.officialName ?? detail.candidateName ?? detail.threadId
    : inLanguage(uiLanguage, "当前未选中会话", "No session selected");
  const detailTitleLines = useMemo(
    () => wrapDisplayText(detailTitle, layout.detailInnerWidth).slice(0, 2),
    [detailTitle, layout.detailInnerWidth]
  );
  const resolvedProviderSummary = asRecord(configView?.effectiveConfig).resolvedProvider
    ? JSON.stringify(asRecord(asRecord(configView?.effectiveConfig).resolvedProvider))
    : tt("nA");
  const settingsPromptLineBudget = Math.max(3, layout.topSectionHeight - 11);
  const settingsPromptLines = useMemo(() => {
    const promptText =
      promptPreview?.prompt ??
      (promptPreviewRefreshing
        ? inLanguage(uiLanguage, "正在加载 prompt 预览...", "Loading prompt preview...")
        : tt("noPreviewLoaded"));
    return wrapDisplayText(promptText, layout.detailInnerWidth).slice(0, settingsPromptLineBudget);
  }, [layout.detailInnerWidth, promptPreview?.prompt, promptPreviewRefreshing, settingsPromptLineBudget, tt, uiLanguage]);

  useEffect(() => {
    if (expandedTranscriptScroll > expandedTranscriptMaxScroll) {
      setExpandedTranscriptScroll(expandedTranscriptMaxScroll);
    }
  }, [expandedTranscriptMaxScroll, expandedTranscriptScroll]);

  const listPanel = (
    <Box flexDirection="column" width={layout.listWidth} height={layout.listHeight}>
      <Box justifyContent="space-between" width={layout.listWidth}>
        <Text color={focusPane === "sessions" ? THEME.accent : THEME.muted}>
          {focusPane === "sessions" ? inLanguage(uiLanguage, "归档 / ", "Archive / ") : ""}
          {inLanguage(uiLanguage, "会话", "Sessions")} [{sessions.length}]
        </Text>
        <Text color={THEME.muted}>
          {browserViewMode} {layout.columns}x{layout.rows}
        </Text>
      </Box>
      <Box
        borderStyle="round"
        borderColor={focusPane === "sessions" ? THEME.borderActive : THEME.border}
        flexDirection="column"
        paddingX={1}
        width={layout.listWidth}
        height={Math.max(4, layout.listHeight - 1)}
        overflow="hidden"
      >
        {sessions.length === 0 ? (
          <Text color={THEME.muted}>
            {inLanguage(uiLanguage, "当前筛选下没有匹配会话。", "No sessions matched the current filter.")}
          </Text>
        ) : null}
        {visibleSessions.map(({ item, index }) => (
          <SessionRow
            key={`${index}-${item.threadId}`}
            session={item}
            active={focusPane === "sessions" && index === selectedIndex}
            width={layout.listInnerWidth}
            uiLanguage={uiLanguage}
          />
        ))}
      </Box>
    </Box>
  );

  const detailPanel = (
    <Box flexDirection="column" width={layout.detailWidth} height={layout.detailHeight}>
      <Box justifyContent="space-between" width={layout.detailWidth}>
        <Text color={focusPane === "transcript" ? THEME.accent : THEME.muted}>
          {focusPane === "transcript" ? inLanguage(uiLanguage, "阅读 / ", "Reading room / ") : ""}
          {inLanguage(uiLanguage, "详情与 Transcript", "Detail & Transcript")}
        </Text>
        <Text color={THEME.muted}>{expandedTranscript ? "expanded-entry" : transcriptSummary}</Text>
      </Box>
      <Box
        borderStyle="round"
        borderColor={focusPane === "transcript" ? THEME.borderActive : THEME.border}
        flexDirection="column"
        paddingX={1}
        width={layout.detailWidth}
        height={Math.max(4, layout.detailHeight - 1)}
        overflow="hidden"
      >
        {detailTitleLines.map((line, index) => (
          <Text color={THEME.accent} key={`detail-title-${index}`} wrap="truncate-end">
            {fitDisplayLine(line, layout.detailInnerWidth, "")}
          </Text>
        ))}
        <Text color={THEME.muted} wrap="truncate-end">
          {fitDisplayLine(
            [detail?.projectName ?? detail?.cwd ?? "n/a", detail?.provider ?? "n/a", detail?.model ?? "n/a"].join(" | "),
            layout.detailInnerWidth
          )}
        </Text>
        <Text color={THEME.muted} wrap="truncate-end">
          {fitDisplayLine(
            [
              `${inLanguage(uiLanguage, "更新于", "updated")} ${formatUiWhen(detail?.updatedAt, uiLanguage)}`,
              `${detail?.tokenTotal ?? 0} tokens`,
              detail?.dirty ? inLanguage(uiLanguage, "dirty", "dirty") : inLanguage(uiLanguage, "clean", "clean"),
              detail?.frozen ? inLanguage(uiLanguage, "冻结", "frozen") : null,
              detail?.manualOverride ? inLanguage(uiLanguage, "手动覆盖", "manual") : null
            ]
              .filter(Boolean)
              .join(" | "),
            layout.detailInnerWidth
          )}
        </Text>
        <Text color={THEME.manual} wrap="truncate-end">
          {fitDisplayLine(
            detail?.candidateName
              ? `${inLanguage(uiLanguage, "候选名", "candidate")}: ${truncateDisplayText(detail.candidateName, Math.max(12, layout.detailInnerWidth - 11))}`
              : `${inLanguage(uiLanguage, "候选名", "candidate")}: ${tt("nA")}`,
            layout.detailInnerWidth
          )}
        </Text>
        {detail?.renameHistory?.[0] ? (
          <Text color={THEME.muted} wrap="truncate-end">
            {fitDisplayLine(
              `${inLanguage(uiLanguage, "最近一次命名", "last rename")}: ${detail.renameHistory[0].newName} | ${detail.renameHistory[0].kind}/${detail.renameHistory[0].source} | ${formatUiWhen(detail.renameHistory[0].appliedAt, uiLanguage)}`,
              layout.detailInnerWidth
            )}
          </Text>
        ) : (
          <Text color={THEME.muted}>
            {fitDisplayLine(inLanguage(uiLanguage, "最近一次命名: 无", "last rename: none"), layout.detailInnerWidth)}
          </Text>
        )}
        <Box marginTop={1} width={layout.detailInnerWidth}>
          <Text color={THEME.accent}>
            {transcriptLoading
              ? inLanguage(uiLanguage, "正在加载 transcript...", "Loading transcript...")
              : expandedTranscript
                ? inLanguage(uiLanguage, "展开条目", "Expanded entry")
                : inLanguage(uiLanguage, "会话内容", "Conversation")}
          </Text>
        </Box>
        {transcriptError ? (
          <Text color={THEME.danger} wrap="truncate-end">
            {transcriptError}
          </Text>
        ) : null}
        {!expandedTranscript && visibleTranscript.length === 0 && !transcriptLoading ? (
          <Text color={THEME.muted}>
            {inLanguage(uiLanguage, "当前筛选下没有匹配的 transcript 事件。", "No transcript events matched the current filter.")}
          </Text>
        ) : null}
        {expandedTranscript
          ? visibleExpandedTranscriptLines.map((line: string, index: number) => (
              <Text key={`expanded-${index}`} wrap="truncate-end">
                {fitDisplayLine(line, layout.detailInnerWidth, "")}
              </Text>
            ))
          : visibleTranscript.map(({ item, index }) => (
              <TranscriptRow
                key={`${index}-${item.id}`}
                entry={item}
                active={focusPane === "transcript" && index === transcriptIndex}
                width={layout.detailInnerWidth}
                compact={layout.compact && browserViewMode !== "detail"}
                uiLanguage={uiLanguage}
              />
            ))}
        {expandedTranscript ? (
          <Box marginTop={1}>
            <Text color={THEME.muted} wrap="truncate-end">
              {fitDisplayLine(
                selectedTranscript
                  ? `${transcriptRoleLabel(selectedTranscript.role, uiLanguage)}/${transcriptKindLabel(selectedTranscript.kind, uiLanguage)} · ${inLanguage(uiLanguage, "行", "lines")} ${normalizedExpandedTranscriptScroll + 1}-${Math.min(
                      normalizedExpandedTranscriptScroll + expandedTranscriptVisibleCount,
                      expandedTranscriptLines.length
                    )}/${expandedTranscriptLines.length} · ${inLanguage(uiLanguage, "回车/esc 关闭", "enter/esc close")}`
                  : inLanguage(uiLanguage, "当前没有选中的 transcript 条目", "No transcript selected"),
                layout.detailInnerWidth
              )}
            </Text>
          </Box>
        ) : (
          <>
            <Box marginTop={1}>
              <Text color={THEME.muted} wrap="truncate-end">
                {fitDisplayLine(
                  selectedTranscript
                    ? `${inLanguage(uiLanguage, "选中", "selected")}: ${transcriptRoleLabel(selectedTranscript.role, uiLanguage)}/${transcriptKindLabel(selectedTranscript.kind, uiLanguage)} · ${formatUiWhen(selectedTranscript.timestamp, uiLanguage)} · ${inLanguage(uiLanguage, "回车展开", "enter expand")}`
                    : transcriptPage?.hasMore
                      ? inLanguage(uiLanguage, "按 o 加载更早 transcript 事件。", "Press o to load earlier transcript events.")
                      : inLanguage(uiLanguage, "没有更多 transcript 事件了。", "No more transcript events."),
                  layout.detailInnerWidth
                )}
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text color={THEME.accent}>{inLanguage(uiLanguage, "命名历史", "Rename history")}</Text>
            </Box>
            {(detail?.renameHistory ?? []).slice(0, browserViewMode === "detail" ? 4 : 2).map((entry, index) => (
              <Text key={`history-${index}`} color={THEME.muted} wrap="truncate-end">
                {fitDisplayLine(
                  `${formatUiWhen(entry.appliedAt, uiLanguage)} | ${entry.kind}/${entry.source}/${autoRenameStatusLabel(entry.status, uiLanguage)} | ${entry.newName}`,
                  layout.detailInnerWidth
                )}
              </Text>
            ))}
            {(detail?.renameHistory ?? []).length === 0 ? (
              <Text color={THEME.muted} wrap="truncate-end">
                {fitDisplayLine(inLanguage(uiLanguage, "还没有命名历史。", "No rename history yet."), layout.detailInnerWidth)}
              </Text>
            ) : null}
          </>
        )}
      </Box>
    </Box>
  );

  const settingsPanel = (
    <Box flexDirection="column" width={layout.listWidth} height={layout.topSectionHeight}>
      <Box justifyContent="space-between" width={layout.listWidth}>
        <Text color={THEME.accent}>{tt("settings")}</Text>
        <Text color={THEME.muted}>{settingsDirty ? tt("dirty") : tt("synced")}</Text>
      </Box>
      <Box
        borderStyle="round"
        borderColor={THEME.border}
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
        <Text color={THEME.accent}>{tt("configDetail")}</Text>
        <Text color={THEME.muted}>{configView?.paths.userConfigPath ?? tt("nA")}</Text>
      </Box>
      <Box
        borderStyle="round"
        borderColor={THEME.border}
        flexDirection="column"
        paddingX={1}
        width={layout.detailWidth}
        height={Math.max(6, layout.topSectionHeight - 1)}
        overflow="hidden"
      >
        <Text color={THEME.accent} wrap="truncate-end">
          {truncateDisplayText(`${tt("selectedProfile")}: ${selectedProfile?.profileId ?? tt("nA")}`, layout.detailInnerWidth)}
        </Text>
        <Text color={THEME.muted} wrap="truncate-end">
          {truncateDisplayText(`baseUrl: ${selectedProfile?.baseUrl ?? tt("nA")}`, layout.detailInnerWidth)}
        </Text>
        <Text color={THEME.muted} wrap="truncate-end">
          {truncateDisplayText(`model: ${selectedProfile?.model ?? tt("nA")}`, layout.detailInnerWidth)}
        </Text>
        <Text color={THEME.muted} wrap="truncate-end">
          {truncateDisplayText(`wireApi: ${selectedProfile?.wireApi ?? tt("nA")}`, layout.detailInnerWidth)}
        </Text>
        <Text color={THEME.muted} wrap="truncate-end">
          {truncateDisplayText(`${tt("resolved")}: ${resolvedProviderSummary}`, layout.detailInnerWidth)}
        </Text>
        <Box marginTop={1}>
          <Text color={THEME.accent} wrap="truncate-end">
            {fitDisplayLine(
              `${tt("promptPreview")} · ${promptPreviewRefreshing ? tt("refreshing") : promptPreview?.synthetic ? tt("promptSynthetic") : tt("promptSelected")}`,
              layout.detailInnerWidth
            )}
          </Text>
        </Box>
        <Text color={THEME.muted} wrap="truncate-end">
          {fitDisplayLine(
            `${inLanguage(uiLanguage, "线程", "thread")}: ${promptPreview?.threadId ?? tt("nA")} | ${inLanguage(uiLanguage, "策略", "strategy")}: ${promptPreview?.renameContext.strategy ?? tt("nA")}`,
            layout.detailInnerWidth
          )}
        </Text>
        {settingsPromptLines.map((line, index) => (
          <Text color={THEME.text} key={`settings-prompt-${index}`} wrap="truncate-end">
            {fitDisplayLine(line, layout.detailInnerWidth, "")}
          </Text>
        ))}
        <Text color={THEME.muted} wrap="truncate-end">
          {fitDisplayLine(
            `${autoRenameStatusLabel("suggest", uiLanguage)} ${previewSuggestCount} · ${autoRenameStatusLabel("apply", uiLanguage)} ${previewApplyCount} · ${autoRenameStatusLabel("skip", uiLanguage)} ${previewSkipCount}`,
            layout.detailInnerWidth
          )}
        </Text>
        <Box marginTop={1}>
          <Text color={THEME.muted} wrap="truncate-end">
            {fitDisplayLine(
              inLanguage(
                uiLanguage,
                "e 编辑字段  space 枚举切换  s 保存  p 刷新 prompt  R 重载  , 返回浏览",
                "e edit field  space cycle enum  s save  p refresh prompt  R reload  , back to browser"
              ),
              layout.detailInnerWidth
            )}
          </Text>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box flexDirection="column" width={layout.columns}>
      <Box justifyContent="space-between">
        <Text color={THEME.accent}>Codex Session Manager TUI</Text>
        <Text color={THEME.muted}>
          {screenMode === "browser"
            ? `${dirtyOnly ? tt("dirtyOnly") : tt("all")} | focus ${focusPane} | view ${browserViewMode} | api ${props.apiBase}`
            : `${tt("settings")} | api ${props.apiBase}`}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={error ? THEME.danger : THEME.success}>{error ?? message}</Text>
      </Box>

      {!props.interactive ? (
        <Box marginTop={1}>
          <Text color={THEME.warning}>{tt("inputDisabled")}</Text>
        </Box>
      ) : null}

      {inputMode === "search" ? (
        <Box marginTop={1}>
          <Text color={THEME.accent}>{`${tt("search")}: `}</Text>
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
          <Text color={THEME.manual}>{`${tt("rename")}: `}</Text>
          <TextInput
            value={renameDraft}
            onChange={setRenameDraft}
            onSubmit={(value) => {
              const nextName = value.trim();
              setInputMode("normal");
              if (!detail || !nextName) {
                return;
              }
              void runAction(
                () => client.rename(detail.threadId, nextName),
                inLanguage(
                  uiLanguage,
                  `已重命名 ${truncateDisplayText(detail.threadId, 12)}`,
                  `Renamed ${truncateDisplayText(detail.threadId, 12)}`
                )
              );
            }}
          />
        </Box>
      ) : null}

      {inputMode === "edit-setting" ? (
        <Box marginTop={1}>
          <Text color={THEME.manual}>{activeSetting?.label ?? "Edit"}: </Text>
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
              <Text color={THEME.accent}>
                {`${tt("batchPreview")} · ${autoRenameStatusLabel("suggest", uiLanguage)} ${previewSuggestCount} · ${autoRenameStatusLabel("apply", uiLanguage)} ${previewApplyCount}`}
              </Text>
              <Box borderStyle="round" borderColor={THEME.border} flexDirection="column" paddingX={1} height={Math.max(4, Math.max(5, layout.previewHeight || 8) - 1)} overflow="hidden">
                {preview.length === 0 ? <Text color={THEME.muted}>{tt("noPreviewLoaded")}</Text> : null}
                {preview.slice(0, Math.max(3, layout.visiblePreviewCount)).map((item, index) => (
                  <PreviewRow key={`${index}-${item.threadId}`} item={item} width={layout.previewInnerWidth} uiLanguage={uiLanguage} />
                ))}
              </Box>
            </Box>
          ) : null}
        </>
      ) : layout.compact ? (
        <Box marginTop={1} flexDirection="column" gap={1} height={layout.topSectionHeight}>
          {settingsPanel}
          <Box borderStyle="round" borderColor={THEME.border} flexDirection="column" paddingX={1} height={Math.max(5, Math.min(10, layout.rows - layout.topSectionHeight - 6))}>
            <Text color={THEME.accent} wrap="truncate-end">
              {fitDisplayLine(activeSetting ? `${activeSetting.label}: ${activeSetting.value}` : tt("noSettingSelected"), layout.previewInnerWidth)}
            </Text>
            <Text color={THEME.muted} wrap="truncate-end">
              {fitDisplayLine(`profile ${selectedProfile?.profileId ?? tt("nA")} | model ${selectedProfile?.model ?? tt("nA")}`, layout.previewInnerWidth)}
            </Text>
            <Text color={THEME.muted} wrap="truncate-end">
              {fitDisplayLine(`baseUrl ${selectedProfile?.baseUrl ?? tt("nA")}`, layout.previewInnerWidth)}
            </Text>
            {settingsPromptLines.slice(0, 2).map((line, index) => (
              <Text color={THEME.text} key={`compact-settings-prompt-${index}`} wrap="truncate-end">
                {fitDisplayLine(line, layout.previewInnerWidth, "")}
              </Text>
            ))}
            <Text color={THEME.muted} wrap="truncate-end">
              {fitDisplayLine(
                inLanguage(uiLanguage, "e 编辑  space 切换  s 保存  p prompt  R 重载  , 返回", "e edit  space cycle  s save  p prompt  R reload  , back"),
                layout.previewInnerWidth
              )}
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
        {screenMode === "browser" ? (
          <>
            <Text color={THEME.muted} wrap="truncate-end">
              {fitDisplayLine(
                inLanguage(
                  uiLanguage,
                  ", 设置  z 聚焦  enter 展开  h/l 面板  tab 切换  j/k 移动  g/G 首尾  o 更早  H 隐藏  1-5 角色",
                  ", settings  z full-focus  enter expand  h/l pane  tab pane  j/k move  g/G ends  o older  H hidden  1-5 role"
                ),
                layout.columns - 2,
                ""
              )}
            </Text>
            <Text color={THEME.muted} wrap="truncate-end">
              {fitDisplayLine(
                inLanguage(
                  uiLanguage,
                  "/ 搜索  r 重命名  s 建议  a 应用  f 冻结  m 手动覆盖  p 预览  A 批量应用  q 退出",
                  "/ search  r rename  s suggest  a apply  f freeze  m manual  p preview  A batch  q quit"
                ),
                layout.columns - 2,
                ""
              )}
            </Text>
          </>
        ) : (
          <Text color={THEME.muted} wrap="truncate-end">
            {fitDisplayLine(
              inLanguage(
                uiLanguage,
                ", 浏览  j/k 字段  e 编辑  space 切换  s 保存  p 刷新 prompt  R 重载  q 退出",
                ", browser  j/k field  e edit  space cycle  s save  p refresh prompt  R reload  q quit"
              ),
              layout.columns - 2,
              ""
            )}
          </Text>
        )}
      </Box>
    </Box>
  );
}
