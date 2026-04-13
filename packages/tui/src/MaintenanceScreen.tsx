import { Box, Text } from "ink";
import type React from "react";
import type { UiLanguage } from "./i18n.js";
import { autoRenameReasonLabel, autoRenameStatusLabel, formatUiWhen } from "./i18n.js";
import type { TerminalLayout } from "./layout.js";
import { truncateDisplayText } from "./layout.js";
import {
  deriveRuntimeDisplay,
  runtimeDaemonStatusLabel,
  runtimeExecutionLabel,
} from "./runtime-display.js";
import type {
  AiRequestLogResponse,
  AutoRenamePreviewResponse,
  DaemonControlStatus,
  DoctorResponse,
  OverviewResponse,
} from "./types.js";

const TONE = {
  accent: "#c96442",
  text: "#efe6d8",
  muted: "#a79d89",
  border: "#6f675d",
  success: "#9bb06f",
  warning: "#d7a15b",
  danger: "#d26a55",
} as const;

function inline(language: UiLanguage, zh: string, en: string): string {
  return language === "zh-CN" ? zh : en;
}

function fitLine(value: string, width: number): string {
  return truncateDisplayText(value, width, "");
}

function formatNumber(value: number | undefined, language: UiLanguage): string {
  return new Intl.NumberFormat(language).format(value ?? 0);
}

function formatDuration(durationMs: number | undefined, language: UiLanguage): string {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return inline(language, "无", "n/a");
  }
  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
  }
  return `${Math.round(durationMs)}ms`;
}

function Surface(props: {
  title: string;
  subtitle?: string;
  width: number;
  height?: number;
  children: React.ReactNode;
}) {
  return (
    <Box flexDirection="column" width={props.width} height={props.height}>
      <Box justifyContent="space-between" width={props.width}>
        <Text color={TONE.accent}>{props.title}</Text>
        {props.subtitle ? (
          <Text color={TONE.muted}>
            {truncateDisplayText(props.subtitle, Math.max(10, props.width - 20))}
          </Text>
        ) : null}
      </Box>
      <Box
        borderStyle="round"
        borderColor={TONE.border}
        flexDirection="column"
        paddingX={1}
        width={props.width}
        height={props.height ? Math.max(4, props.height - 1) : undefined}
        overflow="hidden"
      >
        {props.children}
      </Box>
    </Box>
  );
}

export function MaintenanceScreen(props: {
  layout: TerminalLayout;
  uiLanguage: UiLanguage;
  overview: OverviewResponse | null;
  doctor: DoctorResponse | null;
  daemon: DaemonControlStatus | null;
  aiRequestLogs: AiRequestLogResponse | null;
  preview: AutoRenamePreviewResponse["items"];
  replayBasis: "session-updated-at" | "last-applied-at";
  refreshing: boolean;
}) {
  const runtimeDisplay = deriveRuntimeDisplay(props.overview, props.daemon);
  const lastSweep = props.overview?.runtime.lastSweepSummary;
  const replayRuns = props.overview?.replay.recentRuns ?? [];
  const previewSuggestCount = props.preview.filter((item) => item.status === "suggest").length;
  const previewApplyCount = props.preview.filter((item) => item.status === "apply").length;
  const previewSkipCount = props.preview.filter((item) => item.status === "skip").length;
  const skipReasons = new Map<string, number>();
  for (const item of props.preview) {
    if (item.status !== "skip") {
      continue;
    }
    skipReasons.set(item.reason, (skipReasons.get(item.reason) ?? 0) + 1);
  }
  const skipSummary = [...skipReasons.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6);
  const logItems =
    props.aiRequestLogs?.items.slice(0, Math.max(5, props.layout.visiblePreviewCount + 2)) ?? [];
  const topWidth = props.layout.stacked ? props.layout.columns - 4 : props.layout.listWidth;
  const rightWidth = props.layout.stacked ? props.layout.columns - 4 : props.layout.detailWidth;
  const topInnerWidth = Math.max(24, topWidth - 4);
  const rightInnerWidth = Math.max(24, rightWidth - 4);

  return (
    <Box marginTop={1} flexDirection="column" gap={1}>
      <Surface
        title={inline(props.uiLanguage, "Rename Ops / 状态页", "Rename Ops")}
        subtitle={
          props.refreshing
            ? inline(props.uiLanguage, "刷新中", "refreshing")
            : `${runtimeExecutionLabel(runtimeDisplay.execution, props.uiLanguage)} · ${runtimeDaemonStatusLabel(runtimeDisplay.daemonStatus, props.uiLanguage)}`
        }
        width={props.layout.columns - 2}
      >
        <Text color={TONE.text} wrap="truncate-end">
          {fitLine(
            `${inline(props.uiLanguage, "策略", "policy")}: ${props.overview?.runtime.configuredAutoApply ?? "n/a"} | ${inline(props.uiLanguage, "最近 sweep", "last sweep")}: ${formatUiWhen(props.overview?.runtime.lastSweepAt, props.uiLanguage)} | ${inline(props.uiLanguage, "最近应用", "last apply")}: ${formatUiWhen(props.overview?.renameHistory.lastAppliedAt, props.uiLanguage)}`,
            props.layout.columns - 6,
          )}
        </Text>
        <Text color={TONE.muted} wrap="truncate-end">
          {fitLine(
            `${inline(props.uiLanguage, "说明", "explain")}: ${props.overview?.runtime.explain ?? inline(props.uiLanguage, "暂无", "n/a")}`,
            props.layout.columns - 6,
          )}
        </Text>
        <Text color={TONE.success} wrap="truncate-end">
          {fitLine(
            `${inline(props.uiLanguage, "Sweep", "Sweep")}: total ${formatNumber(lastSweep?.total, props.uiLanguage)} | suggest ${formatNumber(lastSweep?.suggest, props.uiLanguage)} | apply ${formatNumber(lastSweep?.apply, props.uiLanguage)} | skip ${formatNumber(lastSweep?.skip, props.uiLanguage)} | auto ${formatNumber(lastSweep?.autoApplied, props.uiLanguage)}`,
            props.layout.columns - 6,
          )}
        </Text>
        <Text color={TONE.warning} wrap="truncate-end">
          {fitLine(
            `${inline(props.uiLanguage, "队列", "Queue")}: suggest ${formatNumber(previewSuggestCount, props.uiLanguage)} | apply ${formatNumber(previewApplyCount, props.uiLanguage)} | skip ${formatNumber(previewSkipCount, props.uiLanguage)} | ${inline(props.uiLanguage, "活跃 AI 请求", "active AI requests")} ${formatNumber(props.aiRequestLogs?.activeCount, props.uiLanguage)}`,
            props.layout.columns - 6,
          )}
        </Text>
        <Text color={TONE.muted} wrap="truncate-end">
          {fitLine(
            `${inline(props.uiLanguage, "会话", "Sessions")}: ${formatNumber(props.overview?.sessions.total, props.uiLanguage)} total / ${formatNumber(props.overview?.sessions.dirty, props.uiLanguage)} dirty / ${formatNumber(props.overview?.sessions.frozen, props.uiLanguage)} frozen | ${inline(props.uiLanguage, "Pipeline", "Pipeline")}: active ${formatNumber(props.overview?.pipeline.active, props.uiLanguage)} / candidate ${formatNumber(props.overview?.pipeline.candidateReady, props.uiLanguage)} / finalize ${formatNumber(props.overview?.pipeline.finalizeReady, props.uiLanguage)} / applied ${formatNumber(props.overview?.pipeline.applied, props.uiLanguage)}`,
            props.layout.columns - 6,
          )}
        </Text>
      </Surface>

      <Box flexDirection={props.layout.stacked ? "column" : "row"} gap={1}>
        <Box flexDirection="column" width={topWidth} gap={1}>
          <Surface
            title={inline(props.uiLanguage, "待处理队列", "Action queue")}
            subtitle={inline(
              props.uiLanguage,
              "即时评估，不是 daemon 快照",
              "live preview, not daemon snapshot",
            )}
            width={topWidth}
          >
            {props.preview.length === 0 ? (
              <Text color={TONE.muted}>
                {inline(props.uiLanguage, "还没有加载预览。", "No preview loaded.")}
              </Text>
            ) : null}
            {props.preview
              .slice(0, Math.max(6, props.layout.visibleSessionCount))
              .map((item, index) => (
                <Text
                  color={
                    item.status === "apply"
                      ? TONE.success
                      : item.status === "suggest"
                        ? TONE.warning
                        : TONE.muted
                  }
                  key={`${item.threadId}-${index}`}
                  wrap="truncate-end"
                >
                  {fitLine(
                    `${autoRenameStatusLabel(item.status, props.uiLanguage)} | ${truncateDisplayText(item.candidateName ?? item.threadId, Math.max(12, topInnerWidth - 28))} | ${autoRenameReasonLabel(item.reason, props.uiLanguage)}`,
                    topInnerWidth,
                  )}
                </Text>
              ))}
          </Surface>

          <Surface
            title={inline(props.uiLanguage, "Replay / 重新入队", "Replay")}
            subtitle={props.replayBasis}
            width={topWidth}
          >
            <Text color={TONE.muted} wrap="truncate-end">
              {fitLine(
                `${inline(props.uiLanguage, "最近 replay", "last replay")}: ${formatUiWhen(props.overview?.replay.lastRunAt, props.uiLanguage)} | ${inline(props.uiLanguage, "当前基准", "basis")}: ${props.replayBasis}`,
                topInnerWidth,
              )}
            </Text>
            {replayRuns.length === 0 ? (
              <Text color={TONE.muted}>
                {inline(props.uiLanguage, "还没有 replay 记录。", "No replay runs yet.")}
              </Text>
            ) : null}
            {replayRuns.slice(0, 4).map((run, index) => (
              <Text color={TONE.text} key={`${run.requestedAt}-${index}`} wrap="truncate-end">
                {fitLine(
                  `${formatUiWhen(run.requestedAt, props.uiLanguage)} | ${run.basis} | queued ${formatNumber(run.queued, props.uiLanguage)} | cleared ${formatNumber(run.clearedCandidates, props.uiLanguage)}`,
                  topInnerWidth,
                )}
              </Text>
            ))}
          </Surface>

          <Surface
            title={inline(props.uiLanguage, "Doctor 摘要", "Doctor summary")}
            subtitle={props.doctor?.dbPath ?? inline(props.uiLanguage, "无数据库", "no db")}
            width={topWidth}
          >
            <Text color={TONE.text} wrap="truncate-end">
              {fitLine(
                `${inline(props.uiLanguage, "索引", "index")}: ${props.doctor?.sessionIndexReadable ? "readable" : "unreadable"} / ${props.doctor?.sessionIndexWritable ? "writable" : "readonly"} | db ${props.doctor?.dbExists ? "ok" : "missing"}`,
                topInnerWidth,
              )}
            </Text>
            <Text color={TONE.muted} wrap="truncate-end">
              {fitLine(
                `${inline(props.uiLanguage, "统计", "stats")}: lines ${formatNumber(props.doctor?.stats.totalLines, props.uiLanguage)} | unique ${formatNumber(props.doctor?.stats.uniqueThreadIds, props.uiLanguage)} | dup ${formatNumber(props.doctor?.stats.duplicateThreadIds, props.uiLanguage)} | bytes ${formatNumber(props.doctor?.stats.sizeBytes, props.uiLanguage)}`,
                topInnerWidth,
              )}
            </Text>
            <Text color={TONE.muted} wrap="truncate-end">
              {fitLine(
                `${inline(props.uiLanguage, "跳过最多的原因", "top skip reasons")}: ${skipSummary.length ? skipSummary.map(([reason, count]) => `${autoRenameReasonLabel(reason, props.uiLanguage)} ${formatNumber(count, props.uiLanguage)}`).join(" · ") : inline(props.uiLanguage, "当前没有跳过项", "no skipped items")}`,
                topInnerWidth,
              )}
            </Text>
          </Surface>
        </Box>

        <Box flexDirection="column" width={rightWidth} gap={1}>
          <Surface
            title={inline(props.uiLanguage, "最近 AI 请求", "Recent AI requests")}
            subtitle={`${inline(props.uiLanguage, "最近完成", "last finished")}: ${formatUiWhen(props.aiRequestLogs?.lastFinishedAt, props.uiLanguage)}`}
            width={rightWidth}
          >
            <Text color={TONE.muted} wrap="truncate-end">
              {fitLine(
                `${inline(props.uiLanguage, "状态计数", "status counts")}: running ${formatNumber(props.aiRequestLogs?.statusCounts.running, props.uiLanguage)} | succeeded ${formatNumber(props.aiRequestLogs?.statusCounts.succeeded, props.uiLanguage)} | failed ${formatNumber(props.aiRequestLogs?.statusCounts.failed, props.uiLanguage)}`,
                rightInnerWidth,
              )}
            </Text>
            {logItems.length === 0 ? (
              <Text color={TONE.muted}>
                {inline(props.uiLanguage, "还没有 AI 请求日志。", "No AI request logs yet.")}
              </Text>
            ) : null}
            {logItems.map((item) => (
              <Box flexDirection="column" key={item.id} marginBottom={1}>
                <Text
                  color={
                    item.status === "failed"
                      ? TONE.danger
                      : item.status === "running"
                        ? TONE.warning
                        : TONE.success
                  }
                  wrap="truncate-end"
                >
                  {fitLine(
                    `${formatUiWhen(item.startedAt, props.uiLanguage)} | ${item.status} | ${item.transport} | ${item.projectName ?? item.threadId}`,
                    rightInnerWidth,
                  )}
                </Text>
                <Text color={TONE.muted} wrap="truncate-end">
                  {fitLine(
                    `${item.model ?? "n/a"} | ${formatDuration(item.durationMs, props.uiLanguage)} | ${truncateDisplayText(item.error ?? item.baseUrl ?? "", Math.max(12, rightInnerWidth - 24), inline(props.uiLanguage, "无附加信息", "n/a"))}`,
                    rightInnerWidth,
                  )}
                </Text>
              </Box>
            ))}
          </Surface>
        </Box>
      </Box>
    </Box>
  );
}
