import * as React from "react";

import { formatWhen } from "./browser-utils.js";
import { autoRenameReasonLabel, autoRenameStatusLabel, formatUiNumber, t, type UiLanguage } from "./i18n.js";
import type { AiRequestLogResponse, AutoRenamePreviewResponse, DoctorResponse, OverviewResponse } from "./types.js";

type ChartTheme = {
  text: string;
  muted: string;
  border: string;
  surface: string;
  surfaceAlt: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  manual: string;
};

type ChartOption = Record<string, unknown>;
type LoadedChart = {
  container: HTMLDivElement;
  instance: any;
  echartsLib: any;
};

function readChartTheme(): ChartTheme {
  const rootStyle = getComputedStyle(document.documentElement);
  return {
    text: rootStyle.getPropertyValue("--text-secondary").trim() || "#5e5d59",
    muted: rootStyle.getPropertyValue("--text-muted").trim() || "#87867f",
    border: rootStyle.getPropertyValue("--border-strong").trim() || "#e8e6dc",
    surface: rootStyle.getPropertyValue("--bg-secondary").trim() || "#faf9f5",
    surfaceAlt: rootStyle.getPropertyValue("--bg-elevated").trim() || "#ffffff",
    accent: rootStyle.getPropertyValue("--accent").trim() || "#c96442",
    success: rootStyle.getPropertyValue("--success").trim() || "#6b7a45",
    warning: rootStyle.getPropertyValue("--warning").trim() || "#a57533",
    danger: rootStyle.getPropertyValue("--danger").trim() || "#b53333",
    manual: rootStyle.getPropertyValue("--manual").trim() || "#8e5a4f"
  };
}

function formatCompactNumber(value: number, language: UiLanguage): string {
  return new Intl.NumberFormat(language, {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatDurationMs(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  if (value < 1000) {
    return `${Math.max(0, Math.round(value))}ms`;
  }
  return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
}

function useChart(
  ref: React.RefObject<HTMLDivElement | null>,
  buildOption: ((theme: ChartTheme, echartsLib: any) => ChartOption) | undefined
): void {
  const chartRef = React.useRef<LoadedChart | null>(null);

  React.useEffect(() => {
    const container = ref.current;
    if (!container) {
      return;
    }

    let observer: ResizeObserver | undefined;
    let disposed = false;

    void import("echarts").then((echartsLib) => {
      if (disposed) {
        return;
      }

      const instance =
        echartsLib.getInstanceByDom(container) ??
        echartsLib.init(container, undefined, {
          renderer: "canvas"
        });
      chartRef.current = {
        container,
        instance,
        echartsLib
      };

      observer = new ResizeObserver(() => {
        chartRef.current?.instance.resize();
      });
      observer.observe(container);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      if (chartRef.current?.container === container) {
        chartRef.current.instance.dispose();
        chartRef.current = null;
      }
    };
  }, [ref]);

  React.useEffect(() => {
    const container = ref.current;
    if (!container) {
      return;
    }

    if (!buildOption) {
      chartRef.current?.instance.clear();
      return;
    }

    let disposed = false;

    void import("echarts").then((echartsLib) => {
      if (disposed) {
        return;
      }

      const chart =
        chartRef.current?.container === container
          ? chartRef.current
          : {
              container,
              instance:
                echartsLib.getInstanceByDom(container) ??
                echartsLib.init(container, undefined, {
                  renderer: "canvas"
                }),
              echartsLib
            };

      chartRef.current = chart;
      chart.instance.setOption(buildOption(readChartTheme(), chart.echartsLib), true);
    });

    return () => {
      disposed = true;
    };
  }, [buildOption, ref]);
}

function ChartCard(props: {
  title: string;
  copy: string;
  buildOption?: (theme: ChartTheme, echartsLib: any) => ChartOption;
}) {
  const chartRef = React.useRef<HTMLDivElement | null>(null);
  useChart(chartRef, props.buildOption);

  return (
    <section className="detail-panel ops-chart-panel">
      <div className="ops-chart-header">
        <div>
          <h3>{props.title}</h3>
          <p className="settings-copy">{props.copy}</p>
        </div>
      </div>
      <div className="ops-chart-canvas" ref={chartRef} />
    </section>
  );
}

function runtimeBadgeTone(label: string): "success" | "warning" | "manual" {
  if (label === "preview-only") {
    return "warning";
  }
  if (label === "disabled") {
    return "manual";
  }
  return "success";
}

function daemonStatusTone(status: string | undefined): "success" | "warning" | "manual" {
  if (status === "running") {
    return "success";
  }
  if (status === "stale") {
    return "warning";
  }
  return "manual";
}

function daemonStatusLabel(status: string | undefined, language: UiLanguage): string {
  if (language === "zh-CN") {
    if (status === "running") {
      return "运行中";
    }
    if (status === "stale") {
      return "心跳过期";
    }
    return "未检测到";
  }

  if (status === "running") {
    return "running";
  }
  if (status === "stale") {
    return "stale";
  }
  return "not seen";
}

function aiRequestStatusTone(status: string | undefined): "success" | "warning" | "danger" | "manual" {
  if (status === "succeeded") {
    return "success";
  }
  if (status === "running") {
    return "warning";
  }
  if (status === "failed") {
    return "danger";
  }
  return "manual";
}

function aiRequestStatusLabel(status: string | undefined, language: UiLanguage): string {
  if (language === "zh-CN") {
    switch (status) {
      case "running":
        return "进行中";
      case "succeeded":
        return "成功";
      case "failed":
        return "失败";
      default:
        return "未知";
    }
  }

  switch (status) {
    case "running":
      return "running";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    default:
      return "unknown";
  }
}

function replayBasisLabel(
  basis: "session-updated-at" | "last-applied-at",
  language: UiLanguage
): string {
  if (language === "zh-CN") {
    return basis === "last-applied-at" ? "按上次正式命名时间" : "按会话更新时间";
  }
  return basis === "last-applied-at" ? "last applied at" : "session updated at";
}

function reasonTone(reason: string): "warning" | "manual" | "success" {
  if (reason === "candidate_ready" || reason === "finalize_ready") {
    return "success";
  }
  if (
    reason === "manual_override" ||
    reason === "frozen" ||
    reason === "max_auto_renames_reached" ||
    reason === "rename_cooldown"
  ) {
    return "manual";
  }
  return "warning";
}

export function RenameOpsPanel(props: {
  aiRequestLogs: AiRequestLogResponse | null;
  overview: OverviewResponse | null;
  preview: AutoRenamePreviewResponse | null;
  previewRefreshing: boolean;
  doctor: DoctorResponse | null;
  uiLanguage: UiLanguage;
  onRefreshRuntime: () => void | Promise<void>;
  onRefreshPreview: (options?: { includeCandidateNames?: boolean; urgent?: boolean }) => void | Promise<void>;
  onReplayRenames: (params: {
    since: string;
    basis: "session-updated-at" | "last-applied-at";
  }) => Promise<unknown> | unknown;
}) {
  const [logQuery, setLogQuery] = React.useState("");
  const [logStatusFilter, setLogStatusFilter] = React.useState<"all" | "running" | "succeeded" | "failed">("all");
  const [logTransportFilter, setLogTransportFilter] = React.useState<"all" | "responses" | "chat_completions" | "codex-exec">("all");
  const [replaySince, setReplaySince] = React.useState("");
  const [replayBasis, setReplayBasis] = React.useState<"session-updated-at" | "last-applied-at">("session-updated-at");
  const [replaying, setReplaying] = React.useState(false);
  const tt = (key: Parameters<typeof t>[1]) => t(props.uiLanguage, key);
  const isChinese = props.uiLanguage === "zh-CN";
  const inline = (zh: string, en: string) => (props.uiLanguage === "zh-CN" ? zh : en);
  const appliedLabel = isChinese ? "已应用" : "Applied";
  const previewLabel = isChinese ? "仅预览" : "Preview";
  const skippedLabel = isChinese ? "已跳过" : "Skipped";
  const manualSourceLabel = isChinese ? "手动" : "Manual";
  const noDataLabel = isChinese ? "暂无数据" : "No data";
  const overview = props.overview;
  const aiRequestLogs = props.aiRequestLogs;
  const previewItems = props.preview?.items ?? [];
  const previewApplyCount = previewItems.filter((item) => item.status === "apply").length;
  const previewSuggestCount = previewItems.filter((item) => item.status === "suggest").length;
  const previewSkipCount = previewItems.filter((item) => item.status === "skip").length;
  const previewHasCandidateNames = previewItems.some((item) => typeof item.candidateName === "string");
  const actionablePreviewItems = React.useMemo(
    () => previewItems.filter((item) => item.status === "apply" || item.status === "suggest"),
    [previewItems]
  );
  const skipReasonSummary = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of previewItems) {
      if (item.status !== "skip") {
        continue;
      }
      const key = item.reason || "skip";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count);
  }, [previewItems]);
  const lastSweepSummary = overview?.runtime.lastSweepSummary;
  const latestAiRequest = aiRequestLogs?.items[0];
  const replayRuns = overview?.replay.recentRuns ?? [];
  const stateGuide = [
    {
      key: "skip",
      title: autoRenameStatusLabel("skip", props.uiLanguage),
      count: previewSkipCount,
      tone: "warning" as const,
      copy: inline("被活跃中、冻结、手动覆盖或冷却等保护条件挡住。", "Blocked by guards such as active updates, frozen state, manual override, or cooldown.")
    },
    {
      key: "suggest",
      title: autoRenameStatusLabel("suggest", props.uiLanguage),
      count: previewSuggestCount,
      tone: "manual" as const,
      copy: inline("已经达到候选阈值，会先生成候选名，但还不到正式落盘时机。", "Past the candidate threshold, so a candidate title is generated, but it is not ready to land yet.")
    },
    {
      key: "apply",
      title: autoRenameStatusLabel("apply", props.uiLanguage),
      count: previewApplyCount,
      tone: "success" as const,
      copy: inline("已经达到最终应用阈值；如果 daemon 正在 auto-apply，就会正式写回。", "Past the finalize threshold; if the daemon is auto-applying, this is eligible to land as the official title.")
    }
  ];
  const filteredAiRequests = React.useMemo(() => {
    const query = logQuery.trim().toLowerCase();
    return (aiRequestLogs?.items ?? []).filter((item) => {
      if (logStatusFilter !== "all" && item.status !== logStatusFilter) {
        return false;
      }
      if (logTransportFilter !== "all" && item.transport !== logTransportFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [
        item.projectName,
        item.threadId,
        item.model,
        item.backend,
        item.transport,
        item.baseUrl,
        item.error,
        item.metadata ? Object.values(item.metadata).join(" ") : undefined
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [aiRequestLogs?.items, logQuery, logStatusFilter, logTransportFilter]);
  const filteredRunningCount = filteredAiRequests.filter((item) => item.status === "running").length;
  const filteredFailedCount = filteredAiRequests.filter((item) => item.status === "failed").length;
  const filteredSucceededCount = filteredAiRequests.filter((item) => item.status === "succeeded").length;

  const handleReplay = async () => {
    if (!replaySince || replaying) {
      return;
    }
    setReplaying(true);
    try {
      await props.onReplayRenames({
        since: new Date(replaySince).toISOString(),
        basis: replayBasis
      });
    } finally {
      setReplaying(false);
    }
  };

  const activityOption = React.useMemo(() => {
    if (!overview) {
      return undefined;
    }

    const labels = overview.activity.buckets.map((bucket) => bucket.label);
    const applied = overview.activity.buckets.map((bucket) => bucket.applied);
    const previewOnly = overview.activity.buckets.map((bucket) => bucket.previewOnly);
    const skipped = overview.activity.buckets.map((bucket) => bucket.skipped);

    return (theme: ChartTheme, echartsLib: any): ChartOption => ({
      backgroundColor: "transparent",
      animationDuration: 280,
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        borderColor: "rgba(255, 255, 255, 0.1)",
        textStyle: {
          color: "#fff",
          fontSize: 12
        }
      },
      legend: {
        top: 8,
        left: 16,
        right: 16,
        data: [appliedLabel, previewLabel, skippedLabel],
        textStyle: {
          color: theme.text,
          fontSize: 11
        },
        type: "scroll",
        pageIconColor: theme.text,
        pageIconInactiveColor: theme.muted,
        pageTextStyle: {
          color: theme.text
        }
      },
      grid: {
        left: 16,
        right: 20,
        top: 54,
        bottom: 72,
        containLabel: true
      },
      dataZoom: [
        {
          type: "inside",
          filterMode: "none",
          zoomLock: overview.activity.buckets.length <= 8,
          startValue: Math.max(0, overview.activity.buckets.length - 8),
          endValue: Math.max(0, overview.activity.buckets.length - 1)
        },
        {
          type: "slider",
          filterMode: "none",
          height: 18,
          bottom: 18,
          borderColor: "transparent",
          backgroundColor: theme.surface,
          fillerColor: "rgba(201, 100, 66, 0.18)",
          handleStyle: {
            color: theme.accent,
            borderColor: theme.surfaceAlt
          },
          moveHandleStyle: {
            color: theme.accent
          },
          textStyle: {
            color: theme.muted
          },
          startValue: Math.max(0, overview.activity.buckets.length - 8),
          endValue: Math.max(0, overview.activity.buckets.length - 1)
        }
      ],
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: labels,
        axisLine: {
          lineStyle: {
            color: theme.border
          }
        },
        axisLabel: {
          color: theme.text,
          fontSize: 11
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: theme.border,
            type: "dashed"
          }
        }
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLine: {
          show: false
        },
        axisTick: {
          show: false
        },
        axisLabel: {
          color: theme.text,
          fontSize: 11
        },
        splitLine: {
          lineStyle: {
            color: theme.border,
            type: "dashed"
          }
        }
      },
      series: [
        {
          name: appliedLabel,
          type: "line",
          smooth: true,
          symbolSize: 7,
          data: applied,
          lineStyle: {
            width: 2,
            color: theme.accent
          },
          itemStyle: {
            color: theme.accent
          },
          areaStyle: {
            color: new echartsLib.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(201, 100, 66, 0.28)" },
              { offset: 1, color: "rgba(201, 100, 66, 0.03)" }
            ])
          }
        },
        {
          name: previewLabel,
          type: "line",
          smooth: true,
          symbolSize: 6,
          data: previewOnly,
          lineStyle: {
            width: 2,
            color: theme.warning
          },
          itemStyle: {
            color: theme.warning
          }
        },
        {
          name: skippedLabel,
          type: "line",
          smooth: true,
          symbolSize: 6,
          data: skipped,
          lineStyle: {
            width: 2,
            color: theme.muted
          },
          itemStyle: {
            color: theme.muted
          }
        }
      ]
    });
  }, [appliedLabel, overview, previewLabel, skippedLabel]);

  const sourceOption = React.useMemo(() => {
    if (!overview) {
      return undefined;
    }

    const sourceSeries = [
      { name: "AI", value: overview.renameHistory.aiApplied, colorKey: "accent" as const },
      { name: manualSourceLabel, value: overview.renameHistory.manualApplied, colorKey: "manual" as const }
    ].filter((item) => item.value > 0);

    return (theme: ChartTheme): ChartOption => ({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        borderColor: "rgba(255, 255, 255, 0.1)",
        textStyle: { color: "#fff", fontSize: 12 },
        formatter(params: { name: string; value: number; percent: number }) {
          return `${params.name}<br/>${formatCompactNumber(params.value, props.uiLanguage)} (${formatPercent(params.percent)})`;
        }
      },
      legend: {
        type: "scroll",
        orient: "vertical",
        right: 10,
        top: 16,
        bottom: 16,
        textStyle: {
          color: theme.text,
          fontSize: 11
        },
        pageIconColor: theme.text,
        pageIconInactiveColor: theme.muted,
        pageTextStyle: {
          color: theme.text
        }
      },
      series: [
        {
          type: "pie",
          radius: ["42%", "70%"],
          center: ["34%", "52%"],
          avoidLabelOverlap: true,
          label: {
            show: false
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 12,
              fontWeight: "bold",
              formatter(params: { percent: number }) {
                return formatPercent(params.percent);
              }
            }
          },
          itemStyle: {
            borderRadius: 4,
            borderColor: theme.surfaceAlt,
            borderWidth: 2
          },
          data:
            sourceSeries.length > 0
              ? sourceSeries.map((item) => ({
                  name: item.name,
                  value: item.value,
                  itemStyle: {
                    color: theme[item.colorKey]
                  }
                }))
              : [
                  {
                    name: noDataLabel,
                    value: 1,
                    itemStyle: {
                      color: theme.border
                    }
                  }
                ]
        }
      ]
    });
  }, [manualSourceLabel, noDataLabel, overview, props.uiLanguage]);

  const pipelineOption = React.useMemo(() => {
    if (!overview) {
      return undefined;
    }

    const stages = [
      { key: "discovered", label: inline("刚发现", "Discovered"), value: overview.pipeline.discovered, color: "#b7b3a7" },
      { key: "active", label: inline("活跃中", "Active"), value: overview.pipeline.active, color: "#a57533" },
      { key: "candidate", label: inline("候选就绪", "Candidate ready"), value: overview.pipeline.candidateReady, color: "#6f8a53" },
      { key: "finalize", label: inline("可终稿", "Finalize ready"), value: overview.pipeline.finalizeReady, color: "#c96442" },
      { key: "applied", label: inline("已应用", "Applied"), value: overview.pipeline.applied, color: "#4f7d66" }
    ];

    return (theme: ChartTheme): ChartOption => ({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow"
        },
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        borderColor: "rgba(255, 255, 255, 0.1)",
        textStyle: { color: "#fff", fontSize: 12 }
      },
      grid: {
        left: 20,
        right: 20,
        top: 16,
        bottom: 16,
        containLabel: true
      },
      xAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: {
          color: theme.text,
          fontSize: 11
        },
        splitLine: {
          lineStyle: {
            color: theme.border,
            type: "dashed"
          }
        }
      },
      yAxis: {
        type: "category",
        data: stages.map((item) => item.label),
        axisLabel: {
          color: theme.text,
          fontSize: 11
        },
        axisLine: {
          show: false
        },
        axisTick: {
          show: false
        }
      },
      series: [
        {
          type: "bar",
          data: stages.map((item) => ({
            value: item.value,
            itemStyle: {
              color: item.color,
              borderRadius: [0, 10, 10, 0]
            }
          })),
          barWidth: 18,
          label: {
            show: true,
            position: "right",
            color: theme.text,
            fontSize: 11,
            formatter(params: { value: number }) {
              return formatUiNumber(params.value, props.uiLanguage);
            }
          }
        }
      ]
    });
  }, [inline, overview, props.uiLanguage]);

  const flowOption = React.useMemo(() => {
    if (previewItems.length === 0) {
      return undefined;
    }

    const linkCounts = new Map<string, number>();
    for (const item of previewItems) {
      const source = autoRenameReasonLabel(item.reason || item.status, props.uiLanguage);
      const target = autoRenameStatusLabel(item.status, props.uiLanguage);
      const key = `${source}→${target}`;
      linkCounts.set(key, (linkCounts.get(key) ?? 0) + 1);
    }

    const links = Array.from(linkCounts.entries()).map(([key, value]) => {
      const [source, target] = key.split("→");
      return {
        source,
        target,
        value
      };
    });
    const nodeNames = Array.from(new Set(links.flatMap((item) => [item.source, item.target])));

    return (theme: ChartTheme): ChartOption => ({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        borderColor: "rgba(255, 255, 255, 0.1)",
        textStyle: {
          color: "#fff",
          fontSize: 12
        }
      },
      series: [
        {
          type: "sankey",
          left: 16,
          right: 18,
          top: 16,
          bottom: 16,
          emphasis: {
            focus: "adjacency"
          },
          lineStyle: {
            color: "gradient",
            curveness: 0.5,
            opacity: 0.35
          },
          nodeGap: 16,
          nodeWidth: 14,
          label: {
            color: theme.text,
            fontSize: 11
          },
          itemStyle: {
            borderColor: theme.surfaceAlt,
            borderWidth: 1
          },
          data: nodeNames.map((name) => ({
            name,
            itemStyle: {
              color:
                name === autoRenameStatusLabel("apply", props.uiLanguage)
                  ? theme.accent
                  : name === autoRenameStatusLabel("suggest", props.uiLanguage)
                    ? theme.warning
                    : name === autoRenameStatusLabel("skip", props.uiLanguage)
                      ? theme.muted
                      : theme.manual
            }
          })),
          links
        }
      ]
    });
  }, [previewItems, props.uiLanguage]);

  return (
    <section className="panel-grid ops-layout">
      <section className="detail-panel ops-runtime-panel ops-span-wide">
        <div className="panel-topline ops-runtime-header">
          <div>
            <p className="panel-kicker">{inline("执行状态", "Execution")}</p>
            <h3>{inline("自动重命名运行态", "Auto rename runtime")}</h3>
            <p className="settings-copy">
              {overview?.runtime.explain ??
                inline(
                  "当前 daemon 只做 scan + preview。`finalize_ready` 表示允许应用，不表示已经自动落盘。",
                  "The current daemon only scans and previews. `finalize_ready` means eligible to apply, not already auto-applied."
                )}
            </p>
          </div>
          <div className="header-actions">
            <button
              className="btn-sm"
              onClick={() => {
                void props.onRefreshRuntime();
              }}
              type="button"
            >
              {tt("refresh")}
            </button>
            <button
              className="btn-sm"
              onClick={() => {
                void props.onRefreshPreview({ includeCandidateNames: true, urgent: true });
              }}
              type="button"
            >
              {props.previewRefreshing
                ? inline("候选名载入中...", "Loading candidate names...")
                : inline("按需载入候选名", "Load candidate names")}
            </button>
          </div>
        </div>

        <div className="ops-runtime-badges">
          <span className={`chip ${runtimeBadgeTone(overview?.runtime.actualExecution ?? "preview-only")}`}>
            {inline("实际执行", "Execution")}: {overview?.runtime.actualExecution ?? "preview-only"}
          </span>
          <span className="chip manual">
            {inline("配置策略", "Configured policy")}: {overview?.runtime.configuredAutoApply ?? tt("nA")}
          </span>
          <span className={`chip ${daemonStatusTone(overview?.runtime.daemonStatus)}`}>
            {inline("Daemon 状态", "Daemon status")}: {daemonStatusLabel(overview?.runtime.daemonStatus, props.uiLanguage)}
          </span>
          <span className={`chip ${overview?.runtime.daemonAutoApply ? "success" : "warning"}`}>
            {inline("Daemon 自动应用", "Daemon auto apply")}: {overview?.runtime.daemonAutoApply ? inline("生效中", "active") : inline("未生效", "inactive")}
          </span>
          <span className="chip manual">
            {inline("最近一轮 Sweep", "Last sweep")}: {formatWhen(overview?.runtime.lastSweepAt, props.uiLanguage)}
          </span>
          <span className="chip success">
            {inline("最近应用", "Last apply")}: {formatWhen(overview?.renameHistory.lastAppliedAt, props.uiLanguage)}
          </span>
          <span className="chip manual">
            {inline("最近重入队", "Last replay")}: {formatWhen(overview?.replay.lastRunAt, props.uiLanguage)}
          </span>
          <span className={`chip ${aiRequestLogs?.activeCount ? "warning" : "manual"}`}>
            {inline("活跃 AI 请求", "Active AI requests")}: {formatUiNumber(aiRequestLogs?.activeCount, props.uiLanguage)}
          </span>
          <span className="chip manual">
            {inline("最近 AI 完成", "Last AI finish")}: {formatWhen(aiRequestLogs?.lastFinishedAt, props.uiLanguage)}
          </span>
        </div>

        <div className="settings-metrics-grid ops-kpis">
          <article className="metric-card">
            <span className="metric-label">{inline("上一轮后台 Sweep", "Last daemon sweep")}</span>
            <strong>{formatUiNumber(lastSweepSummary?.total, props.uiLanguage)}</strong>
            <p>
              {formatUiNumber(lastSweepSummary?.suggest, props.uiLanguage)} {inline("建议", "suggest")} / {formatUiNumber(lastSweepSummary?.apply, props.uiLanguage)} {inline("待应用", "apply")} / {formatUiNumber(lastSweepSummary?.skip, props.uiLanguage)} {inline("跳过", "skip")}
            </p>
          </article>
          <article className="metric-card">
            <span className="metric-label">{inline("Sweep 落盘结果", "Sweep apply result")}</span>
            <strong>{formatUiNumber(lastSweepSummary?.autoApplied, props.uiLanguage)}</strong>
            <p>
              {formatUiNumber(lastSweepSummary?.unchanged, props.uiLanguage)} {inline("未变化", "unchanged")} / {lastSweepSummary?.execution ?? "preview-only"}
            </p>
          </article>
          <article className="metric-card">
            <span className="metric-label">{inline("总 Token", "Total tokens")}</span>
            <strong>{formatCompactNumber(overview?.workload.totalTokens ?? 0, props.uiLanguage)}</strong>
            <p>
              {formatCompactNumber(overview?.workload.dirtyTokens ?? 0, props.uiLanguage)} {inline("来自 dirty 会话", "from dirty sessions")}
            </p>
          </article>
          <article className="metric-card">
            <span className="metric-label">{inline("任务完成数", "Task completions")}</span>
            <strong>{formatUiNumber(overview?.workload.totalTasks, props.uiLanguage)}</strong>
            <p>
              {formatCompactNumber(overview?.workload.averageTokensPerSession ?? 0, props.uiLanguage)} {inline("平均 tokens / 会话", "avg tokens / session")}
            </p>
          </article>
          <article className="metric-card">
            <span className="metric-label">{inline("已应用重命名", "Applied renames")}</span>
            <strong>{formatUiNumber(overview?.renameHistory.applied, props.uiLanguage)}</strong>
            <p>
              {formatUiNumber(overview?.renameHistory.autoApplied, props.uiLanguage)} {inline("自动应用", "auto")} / {formatUiNumber(overview?.renameHistory.manualApplied, props.uiLanguage)} {inline("手动应用", "manual")}
            </p>
          </article>
          <article className="metric-card">
            <span className="metric-label">{inline("平均标题字数", "Average title length")}</span>
            <strong>{formatUiNumber(overview?.workload.averageTitleLength, props.uiLanguage)}</strong>
            <p>
              {formatUiNumber(overview?.sessions.named, props.uiLanguage)} {inline("个正式标题参与统计", "official titles in sample")}
            </p>
          </article>
          <article className="metric-card">
            <span className="metric-label">{inline("当前即时评估", "Live preview queue")}</span>
            <strong>
              {formatUiNumber(previewApplyCount + previewSuggestCount, props.uiLanguage)}
            </strong>
            <p>
              {formatUiNumber(previewApplyCount, props.uiLanguage)} {inline("待应用", "apply")} / {formatUiNumber(previewSuggestCount, props.uiLanguage)} {inline("待建议", "suggest")}
            </p>
          </article>
          <article className="metric-card">
            <span className="metric-label">{inline("最近 AI 请求", "Latest AI request")}</span>
            <strong>{latestAiRequest ? formatDurationMs(latestAiRequest.durationMs) : "--"}</strong>
            <p>
              {latestAiRequest
                ? `${latestAiRequest.transport} / ${latestAiRequest.status}`
                : inline("还没有请求日志", "No request logs yet")}
            </p>
          </article>
        </div>
      </section>

      <ChartCard
        buildOption={pipelineOption}
        copy={inline("会话会先落在活跃、候选就绪、可终稿这些阶段里。这里回答的是：现在整体卡在哪一段。", "Sessions first land in stages like active, candidate-ready, and finalize-ready. This chart answers where the system is currently sitting." )}
        title={inline("会话阶段分布", "Session stage distribution")}
      />
      <ChartCard
        buildOption={flowOption}
        copy={inline("把当前预览队列里的“原因”映射到“动作”。这里回答的是：为什么是跳过、建议还是应用。", "Maps the current preview reasons to scheduling actions. This answers why items are skipping, suggesting, or applying." )}
        title={inline("原因到动作的流向", "Reason to action flow")}
      />
      <ChartCard
        buildOption={activityOption}
        copy={inline("最近 14 天的 rename 活动，用来区分真正落盘、仅预览和跳过。", "Rename activity over the last 14 days, separating landed applies, preview-only passes, and skips.")}
        title={inline("近期重命名活动", "Recent rename activity")}
      />
      <ChartCard
        buildOption={sourceOption}
        copy={inline("真正算作正式命名的来源分布，现在只统计 AI 和手动命名。", "Distribution of accepted rename sources. Only AI and manual names count as official now.")}
        title={inline("应用来源分布", "Applied source mix")}
      />

      <section className="detail-panel ops-span-wide ops-state-guide">
        <div className="panel-topline">
          <div>
            <p className="panel-kicker">{inline("状态说明", "State guide")}</p>
            <h3>{inline("现在的命名动作是怎么判出来的", "How the rename actions are decided")}</h3>
          </div>
        </div>
        <div className="ops-state-guide-grid">
          {stateGuide.map((item) => (
            <article className="ops-state-card" data-tone={item.tone} key={item.key}>
              <span className="metric-label">{item.title}</span>
              <strong>{formatUiNumber(item.count, props.uiLanguage)}</strong>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="detail-panel">
        <div className="panel-topline">
          <div>
            <p className="panel-kicker">{tt("scheduler")}</p>
            <h3>{inline("待处理队列", "Action queue")}</h3>
            <p className="settings-copy">
              {inline(
                "这里是当前页面触发的即时评估，不是 daemon 上一轮 sweep 的快照，所以和顶部后台 Sweep 统计可能不同。",
                "This is the current on-demand evaluation from the page, not the last daemon sweep snapshot, so it can differ from the daemon totals above."
              )}
            </p>
          </div>
          <span className="chip manual">
            {previewHasCandidateNames ? inline("含候选名", "with names") : inline("仅状态", "status only")}
          </span>
        </div>
        <div className="settings-inline-stats">
          <div>
            <dt>{autoRenameStatusLabel("suggest", props.uiLanguage)}</dt>
            <dd>{formatUiNumber(previewSuggestCount, props.uiLanguage)}</dd>
          </div>
          <div>
            <dt>{autoRenameStatusLabel("apply", props.uiLanguage)}</dt>
            <dd>{formatUiNumber(previewApplyCount, props.uiLanguage)}</dd>
          </div>
          <div>
            <dt>{autoRenameStatusLabel("skip", props.uiLanguage)}</dt>
            <dd>{formatUiNumber(previewSkipCount, props.uiLanguage)}</dd>
          </div>
          <div>
            <dt>{inline("AI 应用", "AI applies")}</dt>
            <dd>{formatUiNumber(overview?.renameHistory.aiApplied, props.uiLanguage)}</dd>
          </div>
        </div>
        <div className="history-stack">
          {previewItems.length === 0 ? <div className="history-empty">{tt("noPreviewLoaded")}</div> : null}
          {actionablePreviewItems.length === 0 && previewItems.length > 0 ? (
            <div className="ops-queue-empty">
              {inline("当前没有待建议或待应用的会话。", "There are no actionable suggest/apply items right now.")}
            </div>
          ) : null}
          {actionablePreviewItems.slice(0, 16).map((item) => (
            <article className="history-row" key={`${item.threadId}-${item.status}-${item.reason}`}>
              <div>
                <strong>{item.candidateName ?? item.threadId}</strong>
                <p>{item.threadId}</p>
              </div>
              <span>
                {autoRenameStatusLabel(item.status, props.uiLanguage)}
              </span>
            </article>
          ))}
        </div>
        <div className="ops-skip-summary">
          <div className="panel-topline">
            <div>
              <p className="panel-kicker">{inline("跳过摘要", "Skip summary")}</p>
              <h3>{inline("为什么没进队", "Why items were skipped")}</h3>
            </div>
          </div>
          <div className="ops-reason-grid">
            {skipReasonSummary.length === 0 ? (
              <span className="ops-log-summary-chip">{inline("当前没有跳过项", "No skipped items right now")}</span>
            ) : null}
            {skipReasonSummary.slice(0, 8).map((item) => (
              <article className="ops-reason-card" data-tone={reasonTone(item.reason)} key={item.reason}>
                <span className="metric-label">{autoRenameReasonLabel(item.reason, props.uiLanguage)}</span>
                <strong>{formatUiNumber(item.count, props.uiLanguage)}</strong>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="detail-panel ops-replay-panel">
        <div className="panel-topline">
          <div>
            <p className="panel-kicker">{inline("Replay", "Replay")}</p>
            <h3>{inline("规则变更后的重新入队", "Rename replay after rule changes")}</h3>
            <p className="settings-copy">
              {inline(
                "当你改了命名规则，可以把某个时间点之后的会话重新打回命名队列。它不会改配置，只会清空旧 candidate 并重新排队。",
                "After changing naming logic, you can push sessions after a chosen time back into the rename queue. This does not touch config; it only clears stale candidates and requeues them."
              )}
            </p>
          </div>
          <span className="chip manual">
            {inline("最近执行", "Last run")}: {formatWhen(overview?.replay.lastRunAt, props.uiLanguage)}
          </span>
        </div>

        <div className="ops-replay-form">
          <label className="ops-log-filter">
            <span>{inline("起始时间", "Since")}</span>
            <input
              type="datetime-local"
              value={replaySince}
              onChange={(event) => setReplaySince(event.target.value)}
            />
          </label>
          <label className="ops-log-filter">
            <span>{inline("基准", "Basis")}</span>
            <select
              value={replayBasis}
              onChange={(event) =>
                setReplayBasis(event.target.value as "session-updated-at" | "last-applied-at")
              }
            >
              <option value="session-updated-at">{inline("按会话更新时间", "Session updated at")}</option>
              <option value="last-applied-at">{inline("按上次正式命名时间", "Last applied at")}</option>
            </select>
          </label>
          <button className="btn-sm" type="button" disabled={!replaySince || replaying} onClick={() => void handleReplay()}>
            {replaying ? inline("重新入队中...", "Requeueing...") : inline("重新入队", "Requeue")}
          </button>
        </div>

        <div className="ops-log-summary-row">
          <span className="ops-log-summary-chip">
            {inline("最近记录", "Recent runs")}: {formatUiNumber(replayRuns.length, props.uiLanguage)}
          </span>
          <span className="ops-log-summary-chip">
            {inline("最近一轮清空 candidate", "Last cleared candidates")}: {formatUiNumber(replayRuns[0]?.clearedCandidates, props.uiLanguage)}
          </span>
        </div>

        <div className="history-stack">
          {replayRuns.length === 0 ? (
            <div className="ops-queue-empty">
              {inline("还没有 replay 记录。", "No replay runs have been recorded yet.")}
            </div>
          ) : null}
          {replayRuns.map((run) => (
            <article className="history-row" key={`${run.requestedAt}-${run.since}-${run.basis}`}>
              <div>
                <strong>{replayBasisLabel(run.basis, props.uiLanguage)}</strong>
                <p>
                  {inline("起点", "Since")}: {formatWhen(run.since, props.uiLanguage)}
                </p>
              </div>
              <div className="ops-replay-run-meta">
                <span>{formatUiNumber(run.queued, props.uiLanguage)} {inline("个会话入队", "queued")}</span>
                <span>{formatUiNumber(run.clearedCandidates, props.uiLanguage)} {inline("个 candidate 清空", "candidates cleared")}</span>
                <span>{formatWhen(run.requestedAt, props.uiLanguage)}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="detail-panel ops-span-wide ops-log-panel">
        <div className="panel-topline ops-log-panel-header">
          <div>
            <p className="panel-kicker">AI</p>
            <h3>{inline("模型请求日志", "Model request logs")}</h3>
            <p className="settings-copy">
              {inline(
                "按日志面板的方式看最近请求：先筛选，再扫表格。这里重点回答三件事：现在有没有请求、最近慢在哪、失败落在哪一层。",
                "Read recent rename requests like an ops log surface: filter first, then scan the table. This answers three questions quickly: is anything active now, where is latency accumulating, and which layer is failing."
              )}
            </p>
          </div>
          <span className={`chip ${aiRequestLogs?.activeCount ? "warning" : "manual"}`}>
            {inline("活跃中", "Active")}: {formatUiNumber(aiRequestLogs?.activeCount, props.uiLanguage)}
          </span>
        </div>

        <div className="ops-log-toolbar">
          <label className="ops-log-filter ops-log-filter-search">
            <span>{inline("搜索", "Search")}</span>
            <input
              onChange={(event) => setLogQuery(event.target.value)}
              placeholder={inline("项目 / thread / 模型 / 错误", "project / thread / model / error")}
              type="search"
              value={logQuery}
            />
          </label>
          <label className="ops-log-filter">
            <span>{inline("状态", "Status")}</span>
            <select
              onChange={(event) =>
                setLogStatusFilter(event.target.value as "all" | "running" | "succeeded" | "failed")
              }
              value={logStatusFilter}
            >
              <option value="all">{inline("全部", "All")}</option>
              <option value="running">{inline("进行中", "Running")}</option>
              <option value="succeeded">{inline("成功", "Succeeded")}</option>
              <option value="failed">{inline("失败", "Failed")}</option>
            </select>
          </label>
          <label className="ops-log-filter">
            <span>{inline("传输", "Transport")}</span>
            <select
              onChange={(event) =>
                setLogTransportFilter(
                  event.target.value as "all" | "responses" | "chat_completions" | "codex-exec"
                )
              }
              value={logTransportFilter}
            >
              <option value="all">{inline("全部", "All")}</option>
              <option value="responses">responses</option>
              <option value="chat_completions">chat_completions</option>
              <option value="codex-exec">codex-exec</option>
            </select>
          </label>
          <button className="btn-sm" onClick={() => void props.onRefreshRuntime()} type="button">
            {tt("refresh")}
          </button>
        </div>

        <div className="ops-log-summary-row">
          <span className="ops-log-summary-chip">
            {inline("筛选结果", "Filtered")}: {formatUiNumber(filteredAiRequests.length, props.uiLanguage)}
          </span>
          <span className="ops-log-summary-chip">
            {inline("进行中", "Running")}: {formatUiNumber(filteredRunningCount, props.uiLanguage)}
          </span>
          <span className="ops-log-summary-chip">
            {inline("成功", "Succeeded")}: {formatUiNumber(filteredSucceededCount, props.uiLanguage)}
          </span>
          <span className="ops-log-summary-chip">
            {inline("失败", "Failed")}: {formatUiNumber(filteredFailedCount, props.uiLanguage)}
          </span>
          <span className="ops-log-summary-chip">
            {inline("最近完成", "Last finished")}: {formatWhen(aiRequestLogs?.lastFinishedAt, props.uiLanguage)}
          </span>
        </div>

        <div className="ops-log-table-container">
          <table className="ops-log-table">
            <thead>
              <tr>
                <th>{inline("时间", "Time")}</th>
                <th>{inline("项目", "Project")}</th>
                <th>Thread</th>
                <th>{inline("模型", "Model")}</th>
                <th>{inline("状态", "Status")}</th>
                <th>{inline("耗时", "Duration")}</th>
                <th>{inline("字符", "Chars")}</th>
                <th>{inline("传输", "Transport")}</th>
                <th>{inline("接口", "Endpoint")}</th>
                <th>{inline("信息", "Info")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredAiRequests.length === 0 ? (
                <tr>
                  <td className="ops-log-empty" colSpan={10}>
                    {aiRequestLogs ? inline("当前筛选条件下没有日志。", "No logs matched the current filters.") : inline("还没有 AI 请求日志。", "No AI request logs yet.")}
                  </td>
                </tr>
              ) : null}
              {filteredAiRequests.map((item) => (
                <tr className="ops-log-row" data-status={item.status} key={item.id}>
                  <td className="ops-log-col-time">
                    <div className="ops-log-primary ops-log-nowrap" title={item.startedAt}>{formatWhen(item.startedAt, props.uiLanguage)}</div>
                    <div className="ops-log-secondary ops-log-nowrap" title={item.finishedAt ?? ""}>{formatWhen(item.finishedAt, props.uiLanguage)}</div>
                  </td>
                  <td className="ops-log-col-project">
                    <div className="ops-log-primary ops-log-nowrap" title={item.projectName ?? ""}>{item.projectName ?? noDataLabel}</div>
                    <div className="ops-log-secondary ops-log-nowrap" title={item.backend}>{item.backend}</div>
                  </td>
                  <td className="ops-log-mono ops-log-col-thread" title={item.threadId}>{item.threadId}</td>
                  <td className="ops-log-col-model">
                    <div className="ops-log-primary ops-log-nowrap" title={item.model ?? ""}>{item.model ?? noDataLabel}</div>
                    <div className="ops-log-secondary ops-log-nowrap" title={item.metadata?.providerRef ?? ""}>{item.metadata?.providerRef ?? noDataLabel}</div>
                  </td>
                  <td>
                    <span className={`chip ${aiRequestStatusTone(item.status)}`}>
                      {aiRequestStatusLabel(item.status, props.uiLanguage)}
                    </span>
                  </td>
                  <td className="ops-log-col-duration">
                    <div className="ops-log-primary ops-log-nowrap">{formatDurationMs(item.durationMs)}</div>
                    <div className="ops-log-secondary">{latestAiRequest?.id === item.id ? inline("最新", "latest") : "\u00A0"}</div>
                  </td>
                  <td className="ops-log-col-chars">
                    <div className="ops-log-primary ops-log-nowrap">
                      {formatUiNumber(item.promptChars, props.uiLanguage)} / {formatUiNumber(item.responseChars, props.uiLanguage)}
                    </div>
                    <div className="ops-log-secondary ops-log-nowrap">{inline("prompt / response", "prompt / response")}</div>
                  </td>
                  <td className="ops-log-col-transport">
                    <div className="ops-log-primary ops-log-nowrap" title={item.transport}>{item.transport}</div>
                    <div className="ops-log-secondary ops-log-nowrap" title={item.metadata?.requestedBackend ?? item.backend}>{item.metadata?.requestedBackend ?? item.backend}</div>
                  </td>
                  <td className="ops-log-mono ops-log-col-endpoint" title={item.baseUrl ?? ""}>{item.baseUrl ?? noDataLabel}</td>
                  <td className="ops-log-col-info">
                    <div className={item.error ? "ops-log-primary ops-log-clamp" : "ops-log-primary ops-log-nowrap"} title={item.error ?? ""}>{item.error ?? noDataLabel}</div>
                    <div className="ops-log-secondary ops-log-nowrap" title={item.error ? inline("错误", "error") : item.metadata?.profile ?? ""}>
                      {item.error ? inline("错误", "error") : item.metadata?.profile ?? noDataLabel}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="detail-panel">
        <p className="panel-kicker">{inline("诊断", "Diagnostics")}</p>
        <h3>{inline("运行时原始信息", "Raw runtime details")}</h3>
        <p className="settings-copy">
          {inline("这里保留原始 doctor 输出，但默认收起，不再作为维护页主体。", "The raw doctor payload is still available here, but it is no longer the main maintenance surface.")}
        </p>
        <details className="settings-disclosure ops-disclosure">
          <summary>{inline("查看原始诊断 JSON", "Inspect raw doctor JSON")}</summary>
          <pre className="settings-json">{JSON.stringify(props.doctor ?? {}, null, 2)}</pre>
        </details>
      </section>
    </section>
  );
}
