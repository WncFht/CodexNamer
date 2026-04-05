import type { SessionDetail, SessionSummary } from "./types.js";

export function formatWhen(value?: string | null): string {
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

export function toneForSession(session: SessionSummary): string {
  if (session.manualOverride) {
    return "manual";
  }
  if (session.frozen) {
    return "frozen";
  }
  if (session.dirty) {
    return "dirty";
  }
  return "clean";
}

export function transcriptTone(role: string): string {
  if (role === "user") {
    return "user";
  }
  if (role === "assistant") {
    return "assistant";
  }
  if (role === "tool") {
    return "tool";
  }
  return "system";
}

type TimeGroupLabel = "Today" | "Yesterday" | "This Week" | "This Month" | "Earlier";

const TIME_GROUP_ORDER: TimeGroupLabel[] = ["Today", "Yesterday", "This Week", "This Month", "Earlier"];

function getTimeGroup(value?: string): TimeGroupLabel {
  if (!value) {
    return "Earlier";
  }

  const target = new Date(value);
  if (Number.isNaN(target.getTime())) {
    return "Earlier";
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const subject = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const diffDays = Math.floor((today.getTime() - subject.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays <= 0) {
    return "Today";
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  if (diffDays < 7) {
    return "This Week";
  }
  if (diffDays < 30) {
    return "This Month";
  }
  return "Earlier";
}

export function groupSessionsByTime(sessions: SessionSummary[]): Array<{ label: TimeGroupLabel; items: SessionSummary[] }> {
  const groups = new Map<TimeGroupLabel, SessionSummary[]>();
  for (const label of TIME_GROUP_ORDER) {
    groups.set(label, []);
  }

  for (const session of sessions) {
    groups.get(getTimeGroup(session.updatedAt))?.push(session);
  }

  return TIME_GROUP_ORDER.map((label) => ({
    label,
    items: groups.get(label) ?? []
  })).filter((group) => group.items.length > 0);
}

export function sessionDisplayTitle(session: SessionSummary | SessionDetail): string {
  return session.officialName ?? session.candidateName ?? session.threadId;
}
