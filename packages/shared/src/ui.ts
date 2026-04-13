import type { UiLanguage } from "./types.js";

export const DEFAULT_UI_LANGUAGE: UiLanguage = "en-US";

export function normalizeUiLanguage(value?: string): UiLanguage {
  return value === "zh-CN" ? "zh-CN" : DEFAULT_UI_LANGUAGE;
}

export function formatUiWhen(value: string | undefined | null, language: UiLanguage): string {
  if (!value) {
    return language === "zh-CN" ? "无" : "n/a";
  }

  return new Date(value).toLocaleString(language, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatUiNumber(value: number | undefined, language: UiLanguage): string {
  return new Intl.NumberFormat(language).format(value ?? 0);
}

export function sessionStatusLabel(status: string | undefined, language: UiLanguage): string {
  const key = status ?? "unknown";
  const zhMap: Record<string, string> = {
    discovered: "已发现",
    active: "活跃中",
    candidate_ready: "待生成候选",
    finalize_ready: "可终稿",
    applied: "已应用",
    idle: "空闲",
    archived_hint: "疑似归档",
    missing: "缺失",
    unknown: "未知",
  };
  const enMap: Record<string, string> = {
    discovered: "Discovered",
    active: "Active",
    candidate_ready: "Ready To Suggest",
    finalize_ready: "Finalize Ready",
    applied: "Applied",
    idle: "Idle",
    archived_hint: "Archive Hint",
    missing: "Missing",
    unknown: "Unknown",
  };

  return (language === "zh-CN" ? zhMap : enMap)[key] ?? key;
}

export function autoRenameStatusLabel(status: string, language: UiLanguage): string {
  const zhMap: Record<string, string> = {
    skip: "跳过",
    suggest: "建议",
    apply: "应用",
  };
  const enMap: Record<string, string> = {
    skip: "Skip",
    suggest: "Suggest",
    apply: "Apply",
  };
  return (language === "zh-CN" ? zhMap : enMap)[status] ?? status;
}

export function autoRenameReasonLabel(reason: string, language: UiLanguage): string {
  const zhMap: Record<string, string> = {
    frozen: "已冻结",
    max_auto_renames_reached: "已达到自动重命名上限",
    rename_cooldown: "处于重命名冷却期",
    candidate_ready: "已达到生成候选阈值",
    finalize_ready: "已达到最终应用阈值",
    discovered: "内容不足",
    active: "仍在活跃更新",
    applied: "当前已命名",
    idle: "空闲中",
    archived_hint: "疑似归档",
    missing: "会话缺失",
  };
  const enMap: Record<string, string> = {
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
  return (language === "zh-CN" ? zhMap : enMap)[reason] ?? reason;
}

export function booleanLabel(
  value: boolean,
  language: UiLanguage,
  labels?: { yes: string; no: string },
): string {
  if (labels) {
    return value ? labels.yes : labels.no;
  }
  return language === "zh-CN" ? (value ? "是" : "否") : value ? "Yes" : "No";
}
