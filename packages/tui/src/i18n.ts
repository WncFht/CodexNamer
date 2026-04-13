import type { ConfigView } from "./types.js";

export type UiLanguage = "en-US" | "zh-CN";

const COPY = {
  "en-US": {
    nA: "n/a",
    loadingSessions: "Loading sessions...",
    dirtyOnly: "dirty-only",
    all: "all",
    settings: "Settings",
    configDetail: "Config detail",
    synced: "synced",
    dirty: "dirty",
    refreshing: "Refreshing...",
    browser: "browser",
    promptPreview: "AI prompt preview",
    selectedProfile: "selected profile",
    resolved: "resolved",
    noPreviewLoaded: "No preview loaded.",
    batchPreview: "Auto rename preview",
    noSettingSelected: "No setting selected",
    inputDisabled: "Input disabled: current stdin does not support raw mode.",
    search: "Search",
    rename: "Rename",
    loadingPrompt: "Loading prompt preview...",
    promptSynthetic: "synthetic fallback",
    promptSelected: "selected session",
    suggest: "Suggest",
    apply: "Apply",
    skip: "Skip",
  },
  "zh-CN": {
    nA: "无",
    loadingSessions: "正在加载会话...",
    dirtyOnly: "仅 dirty",
    all: "全部",
    settings: "设置",
    configDetail: "配置详情",
    synced: "已同步",
    dirty: "有变更",
    refreshing: "刷新中...",
    browser: "浏览",
    promptPreview: "AI Prompt 预览",
    selectedProfile: "当前 profile",
    resolved: "解析结果",
    noPreviewLoaded: "还没有加载预览。",
    batchPreview: "自动命名预览",
    noSettingSelected: "当前没有选中设置项",
    inputDisabled: "当前 stdin 不支持 raw mode，输入已禁用。",
    search: "搜索",
    rename: "重命名",
    loadingPrompt: "正在加载 prompt 预览...",
    promptSynthetic: "synthetic 回退",
    promptSelected: "当前会话",
    suggest: "建议",
    apply: "应用",
    skip: "跳过",
  },
} as const;

export function normalizeUiLanguage(configView?: ConfigView | null): UiLanguage {
  const raw = (configView?.effectiveConfig as Record<string, unknown> | undefined)?.general as
    | Record<string, unknown>
    | undefined;
  return raw?.uiLanguage === "zh-CN" ? "zh-CN" : "en-US";
}

export function t(language: UiLanguage, key: keyof (typeof COPY)["en-US"]): string {
  return COPY[language][key];
}

export function formatUiWhen(value: string | undefined, language: UiLanguage): string {
  if (!value) {
    return t(language, "nA");
  }
  return new Date(value).toLocaleString(language, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function sessionStatusLabel(status: string | undefined, language: UiLanguage): string {
  const map =
    language === "zh-CN"
      ? {
          discovered: "已发现",
          active: "活跃中",
          candidate_ready: "待生成候选",
          finalize_ready: "可终稿",
          applied: "已应用",
          idle: "空闲",
          archived_hint: "疑似归档",
          missing: "缺失",
        }
      : {
          discovered: "Discovered",
          active: "Active",
          candidate_ready: "Ready To Suggest",
          finalize_ready: "Finalize Ready",
          applied: "Applied",
          idle: "Idle",
          archived_hint: "Archive Hint",
          missing: "Missing",
        };
  return map[status as keyof typeof map] ?? status ?? "unknown";
}

export function autoRenameStatusLabel(status: string, language: UiLanguage): string {
  const map =
    language === "zh-CN"
      ? { skip: "跳过", suggest: "建议", apply: "应用" }
      : { skip: "Skip", suggest: "Suggest", apply: "Apply" };
  return map[status as keyof typeof map] ?? status;
}

export function autoRenameReasonLabel(reason: string, language: UiLanguage): string {
  const map =
    language === "zh-CN"
      ? {
          frozen: "已冻结",
          max_auto_renames_reached: "达到自动命名上限",
          rename_cooldown: "处于重命名冷却期",
          candidate_ready: "已达到生成候选阈值",
          finalize_ready: "已达到最终应用阈值",
          discovered: "内容不足",
          active: "仍在活跃更新",
          applied: "已经应用",
          idle: "空闲中",
          archived_hint: "疑似归档",
          missing: "会话缺失",
        }
      : {
          frozen: "Frozen",
          max_auto_renames_reached: "Max Auto Renames Reached",
          rename_cooldown: "Rename Cooldown",
          candidate_ready: "Ready To Generate Candidate",
          finalize_ready: "Ready To Apply",
          discovered: "Insufficient Content",
          active: "Still Active",
          applied: "Already Applied",
          idle: "Idle",
          archived_hint: "Archive Hint",
          missing: "Missing",
        };
  return map[reason as keyof typeof map] ?? reason;
}
