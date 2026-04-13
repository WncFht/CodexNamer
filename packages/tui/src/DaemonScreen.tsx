import { Box, Text } from "ink";
import type React from "react";
import type { UiLanguage } from "./i18n.js";
import { formatUiWhen } from "./i18n.js";
import type { TerminalLayout } from "./layout.js";
import { truncateDisplayText } from "./layout.js";
import {
  deriveRuntimeDisplay,
  runtimeDaemonStatusLabel,
  runtimeExecutionLabel,
} from "./runtime-display.js";
import type { AutoRenamePreviewResponse, DaemonControlStatus, OverviewResponse } from "./types.js";

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

function Surface(props: {
  title: string;
  subtitle?: string;
  width: number;
  children: React.ReactNode;
}) {
  return (
    <Box flexDirection="column" width={props.width}>
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
        overflow="hidden"
      >
        {props.children}
      </Box>
    </Box>
  );
}

export function DaemonScreen(props: {
  layout: TerminalLayout;
  uiLanguage: UiLanguage;
  daemon: DaemonControlStatus | null;
  overview: OverviewResponse | null;
  preview: AutoRenamePreviewResponse["items"];
  actioning: "start" | "stop" | null;
  refreshing: boolean;
}) {
  const runtimeDisplay = deriveRuntimeDisplay(props.overview, props.daemon);
  const previewSuggestCount = props.preview.filter((item) => item.status === "suggest").length;
  const previewApplyCount = props.preview.filter((item) => item.status === "apply").length;
  const lastSweep = props.overview?.runtime.lastSweepSummary;
  const leftWidth = props.layout.stacked ? props.layout.columns - 4 : props.layout.listWidth;
  const rightWidth = props.layout.stacked ? props.layout.columns - 4 : props.layout.detailWidth;
  const innerWidth = Math.max(24, props.layout.columns - 6);

  return (
    <Box marginTop={1} flexDirection="column" gap={1}>
      <Surface
        title={inline(props.uiLanguage, "Daemon / 控制页", "Daemon")}
        subtitle={
          props.actioning
            ? inline(
                props.uiLanguage,
                props.actioning === "start" ? "启动中" : "停止中",
                props.actioning === "start" ? "starting" : "stopping",
              )
            : props.refreshing
              ? inline(props.uiLanguage, "刷新中", "refreshing")
              : props.daemon?.running
                ? inline(props.uiLanguage, "运行中", "running")
                : inline(props.uiLanguage, "未启动", "stopped")
        }
        width={props.layout.columns - 2}
      >
        <Text color={props.daemon?.running ? TONE.success : TONE.warning} wrap="truncate-end">
          {fitLine(
            `${inline(props.uiLanguage, "控制器", "controller")}: ${props.daemon?.running ? inline(props.uiLanguage, "已启动", "running") : inline(props.uiLanguage, "未启动", "stopped")} | PID ${props.daemon?.pid ?? "--"} | ${inline(props.uiLanguage, "扫描间隔", "scan interval")} ${typeof props.daemon?.intervalSeconds === "number" ? `${props.daemon.intervalSeconds}s` : inline(props.uiLanguage, "跟随配置", "config default")}`,
            innerWidth,
          )}
        </Text>
        <Text color={TONE.muted} wrap="truncate-end">
          {fitLine(
            `${inline(props.uiLanguage, "运行态", "runtime")}: ${runtimeExecutionLabel(runtimeDisplay.execution, props.uiLanguage)} | ${runtimeDaemonStatusLabel(runtimeDisplay.daemonStatus, props.uiLanguage)} | ${inline(props.uiLanguage, "最近 sweep", "last sweep")} ${formatUiWhen(props.overview?.runtime.lastSweepAt, props.uiLanguage)}`,
            innerWidth,
          )}
        </Text>
        <Text color={TONE.muted} wrap="truncate-end">
          {fitLine(
            `${inline(props.uiLanguage, "命令", "command")}: ${props.daemon?.command.executable ?? "node"} ${props.daemon?.command.scriptPath ?? "--"} ${props.daemon?.command.args.join(" ") ?? ""}`,
            innerWidth,
          )}
        </Text>
        <Text color={props.daemon?.lastError ? TONE.danger : TONE.muted} wrap="truncate-end">
          {fitLine(
            `${inline(props.uiLanguage, "最近错误", "last error")}: ${props.daemon?.lastError ?? inline(props.uiLanguage, "无", "none")}`,
            innerWidth,
          )}
        </Text>
      </Surface>

      <Box flexDirection={props.layout.stacked ? "column" : "row"} gap={1}>
        <Box flexDirection="column" width={leftWidth} gap={1}>
          <Surface
            title={inline(props.uiLanguage, "进程与运行态", "Process and runtime")}
            subtitle={`${inline(props.uiLanguage, "API 进程", "API pid")}: ${props.daemon?.apiProcessId ?? "--"}`}
            width={leftWidth}
          >
            <Text color={TONE.text} wrap="truncate-end">
              {fitLine(
                `${inline(props.uiLanguage, "启动", "started")}: ${formatUiWhen(props.daemon?.startedAt, props.uiLanguage)} | ${inline(props.uiLanguage, "停止", "stopped")}: ${formatUiWhen(props.daemon?.stoppedAt, props.uiLanguage)}`,
                Math.max(24, leftWidth - 4),
              )}
            </Text>
            <Text color={TONE.muted} wrap="truncate-end">
              {fitLine(
                `${inline(props.uiLanguage, "退出状态", "exit")}: ${props.daemon?.lastExitCode ?? "--"}${props.daemon?.lastExitSignal ? ` / ${props.daemon.lastExitSignal}` : ""} | ${inline(props.uiLanguage, "配置策略", "policy")}: ${props.overview?.runtime.configuredAutoApply ?? "--"}`,
                Math.max(24, leftWidth - 4),
              )}
            </Text>
            <Text color={TONE.muted} wrap="truncate-end">
              {fitLine(
                `${inline(props.uiLanguage, "当前队列", "current queue")}: suggest ${formatNumber(previewSuggestCount, props.uiLanguage)} | apply ${formatNumber(previewApplyCount, props.uiLanguage)} | auto ${formatNumber(lastSweep?.autoApplied, props.uiLanguage)} | unchanged ${formatNumber(lastSweep?.unchanged, props.uiLanguage)}`,
                Math.max(24, leftWidth - 4),
              )}
            </Text>
          </Surface>

          <Surface
            title={inline(props.uiLanguage, "最近日志", "Recent logs")}
            subtitle={inline(props.uiLanguage, "stdout / stderr tail", "stdout / stderr tail")}
            width={leftWidth}
          >
            {props.daemon?.recentLogs?.length ? (
              props.daemon.recentLogs
                .slice(0, Math.max(6, props.layout.visiblePreviewCount + 2))
                .map((entry, index) => (
                  <Text
                    color={entry.stream === "stderr" ? TONE.danger : TONE.muted}
                    key={`${entry.at}-${index}`}
                    wrap="truncate-end"
                  >
                    {fitLine(
                      `${formatUiWhen(entry.at, props.uiLanguage)} | ${entry.stream} | ${entry.line}`,
                      Math.max(24, leftWidth - 4),
                    )}
                  </Text>
                ))
            ) : (
              <Text color={TONE.muted}>
                {inline(props.uiLanguage, "还没有 daemon 日志。", "No daemon logs yet.")}
              </Text>
            )}
          </Surface>
        </Box>

        <Box flexDirection="column" width={rightWidth}>
          <Surface
            title={inline(props.uiLanguage, "启动命令", "Launch command")}
            subtitle={props.daemon?.command.cwd ?? "--"}
            width={rightWidth}
          >
            <Text color={TONE.text} wrap="truncate-end">
              {fitLine(
                `${props.daemon?.command.executable ?? "node"} ${props.daemon?.command.scriptPath ?? "--"} ${props.daemon?.command.args.join(" ") ?? ""}`,
                Math.max(24, rightWidth - 4),
              )}
            </Text>
            <Text color={TONE.muted} wrap="truncate-end">
              {fitLine(
                `${inline(props.uiLanguage, "工作目录", "working directory")}: ${props.daemon?.command.cwd ?? "--"}`,
                Math.max(24, rightWidth - 4),
              )}
            </Text>
            <Box marginTop={1}>
              <Text color={TONE.accent}>{inline(props.uiLanguage, "操作提示", "Controls")}</Text>
            </Box>
            <Text color={TONE.muted} wrap="truncate-end">
              {fitLine(
                inline(
                  props.uiLanguage,
                  "s 启动 daemon  x 停止 daemon  R 刷新状态  esc 返回浏览",
                  "s start daemon  x stop daemon  R refresh  esc back",
                ),
                Math.max(24, rightWidth - 4),
              )}
            </Text>
          </Surface>
        </Box>
      </Box>
    </Box>
  );
}
