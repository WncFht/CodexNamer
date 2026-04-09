import * as React from "react";

import { fetchAiRequestLogs } from "./api.js";
import { formatWhen } from "./browser-utils.js";
import { autoRenameReasonLabel, autoRenameStatusLabel, formatUiNumber, t, type UiLanguage } from "./i18n.js";
import {
  deriveRuntimeDisplay,
  runtimeDaemonStatusLabel,
  runtimeDaemonStatusTone,
  runtimeExecutionLabel,
  runtimeExecutionTone,
  runtimeProgressExplanation
} from "./runtime-display.js";
import type {
  AiRequestLogDetailResponse,
  AiRequestLogResponse,
  AutoRenamePreviewResponse,
  DaemonControlStatus,
  DoctorResponse,
  OverviewResponse
} from "./types.js";

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

type DataZoomState = {
  start?: number;
  end?: number;
  startValue?: number;
  endValue?: number;
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

function formatDurationMs(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  if (value < 1000) {
    return `${Math.max(0, Math.round(value))}ms`;
  }
  return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
}

function clampIndex(value: number | undefined, maxIndex: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  if (typeof maxIndex !== "number" || !Number.isFinite(maxIndex) || maxIndex < 0) {
    return value;
  }
  return Math.max(0, Math.min(maxIndex, Math.trunc(value)));
}

function categoryAxisLength(option: ChartOption): number | undefined {
  const axisConfig = Array.isArray(option.xAxis) ? option.xAxis : option.xAxis ? [option.xAxis] : [];
  for (const axis of axisConfig) {
    if (!axis || typeof axis !== "object") {
      continue;
    }
    const axisRecord = axis as { type?: string; data?: unknown };
    if (axisRecord.type === "category" && Array.isArray(axisRecord.data)) {
      return axisRecord.data.length;
    }
  }
  return undefined;
}

function readCurrentDataZoomState(instance: any): DataZoomState[] {
  const currentOption = instance?.getOption?.();
  if (!currentOption || !Array.isArray(currentOption.dataZoom)) {
    return [];
  }

  return currentOption.dataZoom.map((item: Record<string, unknown>) => ({
    start: typeof item.start === "number" ? item.start : undefined,
    end: typeof item.end === "number" ? item.end : undefined,
    startValue: typeof item.startValue === "number" ? item.startValue : undefined,
    endValue: typeof item.endValue === "number" ? item.endValue : undefined
  }));
}

function applyPreservedDataZoom(option: ChartOption, preservedState: DataZoomState[]): ChartOption {
  if (preservedState.length === 0 || !Array.isArray(option.dataZoom)) {
    return option;
  }

  const axisLength = categoryAxisLength(option);
  const maxIndex = typeof axisLength === "number" && axisLength > 0 ? axisLength - 1 : undefined;
  const nextDataZoom = option.dataZoom.map((item: unknown, index: number) => {
    if (!item || typeof item !== "object") {
      return item;
    }

    const preserved = preservedState[index];
    if (!preserved) {
      return item;
    }

    return {
      ...item,
      ...(typeof preserved.start === "number" ? { start: preserved.start } : {}),
      ...(typeof preserved.end === "number" ? { end: preserved.end } : {}),
      ...(typeof preserved.startValue === "number"
        ? { startValue: clampIndex(preserved.startValue, maxIndex) }
        : {}),
      ...(typeof preserved.endValue === "number"
        ? { endValue: clampIndex(preserved.endValue, maxIndex) }
        : {})
    };
  });

  return {
    ...option,
    dataZoom: nextDataZoom
  };
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
      const preservedDataZoom = readCurrentDataZoomState(chart.instance);
      const nextOption = applyPreservedDataZoom(buildOption(readChartTheme(), chart.echartsLib), preservedDataZoom);
      chart.instance.setOption(nextOption, true);
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

function shortRuleSignature(value: string | undefined): string {
  if (!value) {
    return "--";
  }
  if (value.length <= 16) {
    return value;
  }
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function sweepAxisLabel(value: string, language: UiLanguage): string {
  return new Intl.DateTimeFormat(language, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function RenameOpsPanel(props: {
  aiRequestLogs: AiRequestLogResponse | null;
  aiRequestLogDetail: AiRequestLogDetailResponse | null;
  overview: OverviewResponse | null;
  daemon: DaemonControlStatus | null;
  preview: AutoRenamePreviewResponse | null;
  previewRefreshing: boolean;
  doctor: DoctorResponse | null;
  uiLanguage: UiLanguage;
  selectedRequestLogId?: number;
  onSelectRequestLog: (id?: number) => void;
  onRefreshRuntime: () => void | Promise<void>;
  onRefreshPreview: (options?: { includeCandidateNames?: boolean; urgent?: boolean }) => void | Promise<void>;
}) {
  const {
    aiRequestLogs: initialAiRequestLogs,
    overview,
    daemon,
    preview,
    uiLanguage,
    selectedRequestLogId,
    onSelectRequestLog
  } = props;
  const LOGS_PER_PAGE = 10;
  const [logQuery, setLogQuery] = React.useState("");
  const [logProjectFilter, setLogProjectFilter] = React.useState("all");
  const [logStatusFilter, setLogStatusFilter] = React.useState<"all" | "running" | "succeeded" | "failed">("all");
  const [logTransportFilter, setLogTransportFilter] = React.useState<"all" | "responses" | "openai-compatible">("all");
  const [logPage, setLogPage] = React.useState(1);
  const [logPageInput, setLogPageInput] = React.useState("1");
  const [requestLogReport, setRequestLogReport] = React.useState<AiRequestLogResponse | null>(initialAiRequestLogs);
  const [requestLogLoading, setRequestLogLoading] = React.useState(false);
  const tt = React.useCallback((key: Parameters<typeof t>[1]) => t(uiLanguage, key), [uiLanguage]);
  const isChinese = uiLanguage === "zh-CN";
  const inline = React.useCallback((zh: string, en: string) => (isChinese ? zh : en), [isChinese]);
  const appliedLabel = isChinese ? "已应用" : "Applied";
  const previewLabel = isChinese ? "仅预览" : "Preview";
  const skippedLabel = isChinese ? "已跳过" : "Skipped";
  const noDataLabel = isChinese ? "暂无数据" : "No data";
  const runtimeDisplay = deriveRuntimeDisplay(overview, daemon);
  const aiRequestLogs = requestLogReport ?? initialAiRequestLogs;
  const previewItems = React.useMemo(() => preview?.items ?? [], [preview?.items]);
  const previewApplyCount = previewItems.filter((item) => item.status === "apply").length;
  const previewSuggestCount = previewItems.filter((item) => item.status === "suggest").length;
  const lastSweepSummary = overview?.runtime.lastSweepSummary;
  const recentSweeps = React.useMemo(
    () => (overview?.runtime.recentSweeps ?? []).slice().reverse(),
    [overview?.runtime.recentSweeps]
  );
  const latestAiRequest = aiRequestLogs?.items[0];
  const currentRuleSignature = overview?.runtime.currentRuleSignature || overview?.ruleCoverage.currentSignature || "";
  const requestLogRequestIdRef = React.useRef(0);
  const loadRequestLogPage = React.useCallback(async () => {
    const requestId = ++requestLogRequestIdRef.current;
    setRequestLogLoading(true);
    try {
      const payload = await fetchAiRequestLogs({
        page: logPage,
        pageSize: LOGS_PER_PAGE,
        search: logQuery.trim() || undefined,
        project:
          logProjectFilter === "all"
            ? undefined
            : logProjectFilter === "__none__"
              ? "__none__"
              : logProjectFilter,
        status: logStatusFilter === "all" ? undefined : logStatusFilter,
        transport: logTransportFilter === "all" ? undefined : logTransportFilter
      });
      if (requestId !== requestLogRequestIdRef.current) {
        return;
      }
      setRequestLogReport(payload);
      if (payload.page !== logPage) {
        setLogPage(payload.page);
      }
    } finally {
      if (requestId === requestLogRequestIdRef.current) {
        setRequestLogLoading(false);
      }
    }
  }, [LOGS_PER_PAGE, logPage, logProjectFilter, logQuery, logStatusFilter, logTransportFilter]);

  React.useEffect(() => {
    void loadRequestLogPage();
  }, [loadRequestLogPage]);

  const projectOptions = React.useMemo(() => {
    return (aiRequestLogs?.projects ?? [])
      .map((project) => ({
        value: project.trim() ? project : "__none__",
        label: project.trim() ? project : noDataLabel
      }))
      .sort((left, right) => left.label.localeCompare(right.label, uiLanguage));
  }, [aiRequestLogs?.projects, noDataLabel, uiLanguage]);
  const visibleAiRequests = React.useMemo(() => aiRequestLogs?.items ?? [], [aiRequestLogs?.items]);
  const totalFilteredAiRequests = aiRequestLogs?.total ?? 0;
  const totalLogPages = Math.max(
    1,
    aiRequestLogs?.totalPages ?? (Math.ceil(totalFilteredAiRequests / LOGS_PER_PAGE) || 1)
  );
  const filteredRunningCount = aiRequestLogs?.statusCounts.running ?? 0;
  const filteredFailedCount = aiRequestLogs?.statusCounts.failed ?? 0;
  const filteredSucceededCount = aiRequestLogs?.statusCounts.succeeded ?? 0;

  React.useEffect(() => {
    setLogPage(1);
  }, [logProjectFilter, logQuery, logStatusFilter, logTransportFilter]);

  React.useEffect(() => {
    setLogPageInput(String(logPage));
  }, [logPage]);

  React.useEffect(() => {
    if (!aiRequestLogs || !selectedRequestLogId) {
      return;
    }
    const stillVisible = visibleAiRequests.some((item) => item.id === selectedRequestLogId);
    if (!stillVisible) {
      onSelectRequestLog(undefined);
    }
  }, [aiRequestLogs, onSelectRequestLog, selectedRequestLogId, visibleAiRequests]);

  const handleLogPageJump = () => {
    const parsed = Number(logPageInput);
    if (!Number.isFinite(parsed)) {
      setLogPageInput(String(logPage));
      return;
    }
    const nextPage = Math.max(1, Math.min(totalLogPages, Math.trunc(parsed)));
    setLogPage(nextPage);
    setLogPageInput(String(nextPage));
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

  const sweepTrendOption = React.useMemo(() => {
    if (recentSweeps.length === 0) {
      return undefined;
    }

    const labels = recentSweeps.map((item) => sweepAxisLabel(item.at, props.uiLanguage));
    const startIndex = Math.max(0, recentSweeps.length - 10);
    const handledLabel = inline("本轮处理", "Handled");
    const dirtyLabel = inline("发现 dirty", "Dirty found");
    const pendingLabel = inline("剩余待扫", "Pending");
    const failedLabel = inline("建议失败", "Suggest failed");

    return (theme: ChartTheme, echartsLib: any): ChartOption => ({
      backgroundColor: "transparent",
      animationDuration: 280,
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        borderColor: "rgba(255, 255, 255, 0.1)",
        textStyle: { color: "#fff", fontSize: 12 }
      },
      legend: {
        top: 8,
        left: 16,
        right: 16,
        data: [handledLabel, dirtyLabel, pendingLabel, failedLabel],
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
          zoomLock: recentSweeps.length <= 10,
          startValue: startIndex,
          endValue: recentSweeps.length - 1
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
          startValue: startIndex,
          endValue: recentSweeps.length - 1
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
        axisLine: { show: false },
        axisTick: { show: false },
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
          name: handledLabel,
          type: "line",
          smooth: true,
          symbolSize: 7,
          data: recentSweeps.map((item) => item.total),
          lineStyle: {
            width: 2,
            color: theme.accent
          },
          itemStyle: {
            color: theme.accent
          },
          areaStyle: {
            color: new echartsLib.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(201, 100, 66, 0.26)" },
              { offset: 1, color: "rgba(201, 100, 66, 0.03)" }
            ])
          }
        },
        {
          name: dirtyLabel,
          type: "line",
          smooth: true,
          symbolSize: 6,
          data: recentSweeps.map((item) => item.dirtyTotal),
          lineStyle: {
            width: 2,
            color: theme.success
          },
          itemStyle: {
            color: theme.success
          }
        },
        {
          name: pendingLabel,
          type: "line",
          smooth: true,
          symbolSize: 6,
          data: recentSweeps.map((item) => item.pending),
          lineStyle: {
            width: 2,
            color: theme.warning
          },
          itemStyle: {
            color: theme.warning
          }
        },
        {
          name: failedLabel,
          type: "line",
          smooth: true,
          symbolSize: 6,
          data: recentSweeps.map((item) => item.failedSuggestions),
          lineStyle: {
            width: 2,
            color: theme.danger
          },
          itemStyle: {
            color: theme.danger
          }
        }
      ]
    });
  }, [inline, props.uiLanguage, recentSweeps]);

  const sweepActionOption = React.useMemo(() => {
    if (recentSweeps.length === 0) {
      return undefined;
    }

    const labels = recentSweeps.map((item) => sweepAxisLabel(item.at, props.uiLanguage));
    const startIndex = Math.max(0, recentSweeps.length - 10);
    const suggestLabel = inline("建议", "Suggest");
    const applyLabel = inline("待应用", "Apply");
    const skipLabel = inline("跳过", "Skip");
    const autoAppliedLabel = inline("自动落盘", "Auto applied");

    return (theme: ChartTheme): ChartOption => ({
      backgroundColor: "transparent",
      animationDuration: 280,
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow"
        },
        confine: true,
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        borderColor: "rgba(255, 255, 255, 0.1)",
        textStyle: { color: "#fff", fontSize: 12 }
      },
      legend: {
        top: 8,
        left: 16,
        right: 16,
        data: [suggestLabel, applyLabel, skipLabel, autoAppliedLabel],
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
          zoomLock: recentSweeps.length <= 10,
          startValue: startIndex,
          endValue: recentSweeps.length - 1
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
          startValue: startIndex,
          endValue: recentSweeps.length - 1
        }
      ],
      xAxis: {
        type: "category",
        data: labels,
        axisLine: {
          lineStyle: {
            color: theme.border
          }
        },
        axisLabel: {
          color: theme.text,
          fontSize: 11
        }
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLine: { show: false },
        axisTick: { show: false },
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
          name: suggestLabel,
          type: "bar",
          stack: "queue",
          barMaxWidth: 24,
          data: recentSweeps.map((item) => item.suggest),
          itemStyle: {
            color: theme.warning,
            borderRadius: [4, 4, 0, 0]
          }
        },
        {
          name: applyLabel,
          type: "bar",
          stack: "queue",
          barMaxWidth: 24,
          data: recentSweeps.map((item) => item.apply),
          itemStyle: {
            color: theme.accent,
            borderRadius: [4, 4, 0, 0]
          }
        },
        {
          name: skipLabel,
          type: "bar",
          stack: "queue",
          barMaxWidth: 24,
          data: recentSweeps.map((item) => item.skip),
          itemStyle: {
            color: theme.muted,
            borderRadius: [4, 4, 0, 0]
          }
        },
        {
          name: autoAppliedLabel,
          type: "line",
          smooth: true,
          symbolSize: 7,
          data: recentSweeps.map((item) => item.autoApplied),
          lineStyle: {
            width: 2,
            color: theme.success
          },
          itemStyle: {
            color: theme.success
          }
        }
      ]
    });
  }, [inline, props.uiLanguage, recentSweeps]);

  const ruleCoverageOption = React.useMemo(() => {
    if (!overview) {
      return undefined;
    }

    const coverageItems = [
      { label: inline("最新规则", "Latest"), value: overview.ruleCoverage.latest, color: "#4f7d66" },
      { label: inline("规则落后", "Outdated"), value: overview.ruleCoverage.outdated, color: "#c96442" },
      { label: inline("手动命名", "Manual"), value: overview.ruleCoverage.manual, color: "#8e5a4f" },
      { label: inline("未知签名", "Unknown"), value: overview.ruleCoverage.unknown, color: "#a57533" }
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
        data: coverageItems.map((item) => item.label),
        axisLabel: {
          color: theme.text,
          fontSize: 11
        },
        axisLine: { show: false },
        axisTick: { show: false }
      },
      series: [
        {
          type: "bar",
          barWidth: 18,
          data: coverageItems.map((item) => ({
            value: item.value,
            itemStyle: {
              color: item.color,
              borderRadius: [0, 10, 10, 0]
            }
          })),
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

  return (
    <section className="panel-grid ops-layout">
      <section className="detail-panel ops-runtime-panel ops-span-wide">
        <div className="panel-topline ops-runtime-header">
          <div>
            <p className="panel-kicker">{inline("执行状态", "Execution")}</p>
            <h3>{inline("自动重命名运行态", "Auto rename runtime")}</h3>
            <p className="settings-copy">
              {runtimeDisplay.sweepRunning
                ? runtimeProgressExplanation(props.uiLanguage)
                : overview?.runtime.explain ||
                  inline(
                    "还没有 sweep 摘要。启动 daemon 后，这里会明确告诉你扫了多少、剩了多少、有没有自动落盘。",
                    "No sweep summary has been recorded yet. Once the daemon runs, this section will show exactly how much was scanned, how much is left, and whether anything auto-applied."
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
          <span className={`chip ${runtimeExecutionTone(runtimeDisplay.execution)}`}>
            {inline("实际执行", "Execution")}: {runtimeExecutionLabel(runtimeDisplay.execution, props.uiLanguage)}
          </span>
          <span className="chip manual">
            {inline("配置策略", "Configured policy")}: {overview?.runtime.configuredAutoApply ?? tt("nA")}
          </span>
          <span className={`chip ${runtimeDaemonStatusTone(runtimeDisplay.daemonStatus)}`}>
            {inline("Daemon 状态", "Daemon status")}: {runtimeDaemonStatusLabel(runtimeDisplay.daemonStatus, props.uiLanguage)}
          </span>
          <span className={`chip ${overview?.runtime.daemonAutoApply ? "success" : "warning"}`}>
            {inline("Daemon 自动应用", "Daemon auto apply")}: {overview?.runtime.daemonAutoApply ? inline("生效中", "active") : inline("未生效", "inactive")}
          </span>
          <span className="chip manual">
            {inline("当前规则签名", "Current rule signature")}: {shortRuleSignature(currentRuleSignature)}
          </span>
          <span className="chip manual">
            {inline("最近一轮 Sweep", "Last sweep")}: {formatWhen(overview?.runtime.lastSweepAt, props.uiLanguage)}
          </span>
          <span className={`chip ${(lastSweepSummary?.pending ?? 0) > 0 ? "warning" : "success"}`}>
            {inline("本轮 dirty / 待扫", "Dirty / pending")}: {formatUiNumber(lastSweepSummary?.dirtyTotal, props.uiLanguage)} /{" "}
            {formatUiNumber(lastSweepSummary?.pending, props.uiLanguage)}
          </span>
          <span className="chip success">
            {inline("最近应用", "Last apply")}: {formatWhen(overview?.renameHistory.lastAppliedAt, props.uiLanguage)}
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
            <span className="metric-label">{inline("上一轮 Sweep 处理量", "Last sweep handled")}</span>
            <strong>{formatUiNumber(lastSweepSummary?.total, props.uiLanguage)}</strong>
            <p>
              {formatUiNumber(lastSweepSummary?.dirtyTotal, props.uiLanguage)} {inline("个 dirty 命中", "dirty found")} /{" "}
              {formatUiNumber(lastSweepSummary?.pending, props.uiLanguage)} {inline("个待下轮", "left pending")}
            </p>
          </article>
          <article className="metric-card">
            <span className="metric-label">{inline("Sweep 扫描触达", "Sweep scan touch")}</span>
            <strong>{formatUiNumber(lastSweepSummary?.scan.scannedRollouts, props.uiLanguage)}</strong>
            <p>
              {formatUiNumber(lastSweepSummary?.scan.updatedSessions, props.uiLanguage)} {inline("个会话内容更新", "sessions updated")}
            </p>
          </article>
          <article className="metric-card">
            <span className="metric-label">{inline("Sweep 落盘结果", "Sweep apply result")}</span>
            <strong>{formatUiNumber(lastSweepSummary?.autoApplied, props.uiLanguage)}</strong>
            <p>
              {formatUiNumber(lastSweepSummary?.unchanged, props.uiLanguage)} {inline("未变化", "unchanged")} /{" "}
              {formatUiNumber(lastSweepSummary?.failedSuggestions, props.uiLanguage)} {inline("建议失败", "suggest failed")}
            </p>
          </article>
          <article className="metric-card">
            <span className="metric-label">{inline("规则覆盖状态", "Rule coverage")}</span>
            <strong>{formatUiNumber(overview?.ruleCoverage.outdated, props.uiLanguage)}</strong>
            <p>
              {formatUiNumber(overview?.ruleCoverage.latest, props.uiLanguage)} {inline("已对齐最新规则", "already latest")}
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
              {formatUiNumber(overview?.renameHistory.autoApplied, props.uiLanguage)} {inline("自动应用", "auto")} /{" "}
              {formatUiNumber(overview?.renameHistory.manualApplied, props.uiLanguage)} {inline("手动应用", "manual")}
            </p>
          </article>
          <article className="metric-card">
            <span className="metric-label">{inline("当前即时评估", "Live preview queue")}</span>
            <strong>{formatUiNumber(previewApplyCount + previewSuggestCount, props.uiLanguage)}</strong>
            <p>
              {formatUiNumber(previewApplyCount, props.uiLanguage)} {inline("待应用", "apply")} /{" "}
              {formatUiNumber(previewSuggestCount, props.uiLanguage)} {inline("待建议", "suggest")}
            </p>
          </article>
        </div>
      </section>

      <ChartCard
        buildOption={sweepTrendOption}
        copy={inline(
          "这里直接回答后台每轮 sweep 扫了多少 dirty、真正处理了多少、还剩多少待下一轮，以及失败有没有在上升。",
          "This shows how many dirty sessions each daemon sweep saw, how many it actually handled, how much remained for the next round, and whether failures are climbing."
        )}
        title={inline("后台 Sweep 趋势", "Daemon sweep trend")}
      />
      <ChartCard
        buildOption={sweepActionOption}
        copy={inline(
          "把每轮 sweep 拆成 suggest / apply / skip / auto-applied，便于看出 daemon 是卡在排队、跳过还是已经开始落盘。",
          "Breaks each sweep into suggest / apply / skip / auto-applied so you can see whether the daemon is mostly queuing, skipping, or actually landing titles."
        )}
        title={inline("Sweep 动作拆分", "Sweep action breakdown")}
      />
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
        buildOption={ruleCoverageOption}
        copy={inline(
          "当前正式标题按规则签名分成已对齐、落后、手动和未知四类。这里能直接看出是不是该去新的 requeue 页面补扫。",
          "Official titles are grouped by rule signature into latest, outdated, manual, and unknown. This tells you immediately whether it is time to head to the new requeue page."
        )}
        title={inline("规则覆盖分布", "Rule coverage")}
      />

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
            <span>{inline("项目", "Project")}</span>
            <select onChange={(event) => setLogProjectFilter(event.target.value)} value={logProjectFilter}>
              <option value="all">{inline("全部", "All")}</option>
              {projectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
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
                  event.target.value as "all" | "responses" | "openai-compatible"
                )
              }
              value={logTransportFilter}
            >
              <option value="all">{inline("全部", "All")}</option>
              <option value="responses">responses</option>
              <option value="openai-compatible">openai-compatible</option>
            </select>
          </label>
          <button
            className="btn-sm"
            onClick={() => {
              void Promise.all([Promise.resolve(props.onRefreshRuntime()), loadRequestLogPage()]);
            }}
            type="button"
          >
            {tt("refresh")}
          </button>
        </div>

        <div className="ops-log-summary-row">
          <span className="ops-log-summary-chip">
            {inline("筛选结果", "Filtered")}: {formatUiNumber(totalFilteredAiRequests, props.uiLanguage)}
          </span>
          <span className="ops-log-summary-chip">
            {inline("页码", "Page")}: {formatUiNumber(logPage, props.uiLanguage)} / {formatUiNumber(totalLogPages, props.uiLanguage)}
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
          {requestLogLoading ? (
            <span className="ops-log-summary-chip">{inline("日志加载中...", "Loading logs...")}</span>
          ) : null}
        </div>

        {totalFilteredAiRequests > 0 ? (
          <div className="ops-log-pagination">
            <span className="ops-log-pagination-copy">
              {inline("每页 10 条", "10 rows per page")} · {inline("当前显示", "Showing")}{" "}
              {formatUiNumber((logPage - 1) * LOGS_PER_PAGE + 1, props.uiLanguage)}-
              {formatUiNumber((logPage - 1) * LOGS_PER_PAGE + visibleAiRequests.length, props.uiLanguage)} /{" "}
              {formatUiNumber(totalFilteredAiRequests, props.uiLanguage)}
            </span>
            <div className="ops-log-pagination-actions">
              <button className="btn-sm" disabled={logPage <= 1} onClick={() => setLogPage(1)} type="button">
                {inline("首页", "First")}
              </button>
              <button className="btn-sm" disabled={logPage <= 1} onClick={() => setLogPage((page) => Math.max(1, page - 1))} type="button">
                {inline("上一页", "Prev")}
              </button>
              <button className="btn-sm" disabled={logPage >= totalLogPages} onClick={() => setLogPage((page) => Math.min(totalLogPages, page + 1))} type="button">
                {inline("下一页", "Next")}
              </button>
              <button className="btn-sm" disabled={logPage >= totalLogPages} onClick={() => setLogPage(totalLogPages)} type="button">
                {inline("末页", "Last")}
              </button>
              <div className="ops-log-page-jump">
                <input
                  min={1}
                  onChange={(event) => setLogPageInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleLogPageJump();
                    }
                  }}
                  step={1}
                  type="number"
                  value={logPageInput}
                />
                <button className="btn-sm" onClick={handleLogPageJump} type="button">
                  {inline("跳转", "Go")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {props.aiRequestLogDetail ? (
          <div className="detail-panel">
            <div className="panel-topline">
              <div>
                <p className="panel-kicker">AI Trace</p>
                <h3>{inline("请求详情", "Request detail")}</h3>
              </div>
              <button className="btn-sm" onClick={() => props.onSelectRequestLog(undefined)} type="button">
                {inline("返回日志列表", "Back to logs")}
              </button>
            </div>
            <dl className="settings-runtime-grid compact ops-log-detail-grid">
              <div>
                <dt>ID</dt>
                <dd className="ops-log-mono">{props.aiRequestLogDetail.id}</dd>
              </div>
              <div>
                <dt>{inline("项目", "Project")}</dt>
                <dd>{props.aiRequestLogDetail.projectName ?? noDataLabel}</dd>
              </div>
              <div>
                <dt>Thread</dt>
                <dd className="ops-log-mono">{props.aiRequestLogDetail.threadId}</dd>
              </div>
              <div>
                <dt>{inline("状态", "Status")}</dt>
                <dd>{aiRequestStatusLabel(props.aiRequestLogDetail.status, props.uiLanguage)}</dd>
              </div>
              <div>
                <dt>{inline("开始时间", "Started at")}</dt>
                <dd title={props.aiRequestLogDetail.startedAt}>
                  {formatWhen(props.aiRequestLogDetail.startedAt, props.uiLanguage)}
                </dd>
              </div>
              <div>
                <dt>{inline("结束时间", "Finished at")}</dt>
                <dd title={props.aiRequestLogDetail.finishedAt ?? ""}>
                  {formatWhen(props.aiRequestLogDetail.finishedAt, props.uiLanguage)}
                </dd>
              </div>
              <div>
                <dt>{inline("耗时", "Duration")}</dt>
                <dd>{formatDurationMs(props.aiRequestLogDetail.durationMs)}</dd>
              </div>
              <div>
                <dt>{inline("模型", "Model")}</dt>
                <dd>{props.aiRequestLogDetail.model ?? noDataLabel}</dd>
              </div>
              <div>
                <dt>{inline("后端", "Backend")}</dt>
                <dd>{props.aiRequestLogDetail.backend}</dd>
              </div>
              <div>
                <dt>{inline("传输", "Transport")}</dt>
                <dd>{props.aiRequestLogDetail.transport}</dd>
              </div>
              <div>
                <dt>{inline("请求后端", "Requested backend")}</dt>
                <dd>{props.aiRequestLogDetail.metadata?.requestedBackend ?? props.aiRequestLogDetail.backend}</dd>
              </div>
              <div>
                <dt>{inline("接口", "Endpoint")}</dt>
                <dd className="ops-log-mono">{props.aiRequestLogDetail.baseUrl ?? noDataLabel}</dd>
              </div>
              <div>
                <dt>{inline("Provider ref", "Provider ref")}</dt>
                <dd className="ops-log-mono">{props.aiRequestLogDetail.metadata?.providerRef ?? noDataLabel}</dd>
              </div>
              <div>
                <dt>{inline("Profile", "Profile")}</dt>
                <dd className="ops-log-mono">{props.aiRequestLogDetail.metadata?.profile ?? noDataLabel}</dd>
              </div>
              <div>
                <dt>{inline("字符", "Chars")}</dt>
                <dd>
                  {formatUiNumber(props.aiRequestLogDetail.promptChars, props.uiLanguage)} /{" "}
                  {formatUiNumber(props.aiRequestLogDetail.responseChars, props.uiLanguage)}
                </dd>
              </div>
              <div>
                <dt>{inline("最终标题", "Final name")}</dt>
                <dd>{props.aiRequestLogDetail.finalName ?? props.aiRequestLogDetail.result?.composition?.finalName ?? noDataLabel}</dd>
              </div>
              <div>
                <dt>{inline("信息", "Info")}</dt>
                <dd>
                  {props.aiRequestLogDetail.status === "succeeded"
                    ? props.aiRequestLogDetail.finalName ??
                      props.aiRequestLogDetail.result?.composition?.finalName ??
                      noDataLabel
                    : props.aiRequestLogDetail.error ?? noDataLabel}
                </dd>
              </div>
            </dl>
            <details className="settings-disclosure" open>
              <summary>{inline("Prompt 输入", "Prompt input")}</summary>
              <pre className="settings-json settings-json-large">{props.aiRequestLogDetail.promptText ?? noDataLabel}</pre>
            </details>
            <details className="settings-disclosure">
              <summary>{inline("请求载荷", "Request payload")}</summary>
              <pre className="settings-json">{JSON.stringify(props.aiRequestLogDetail.requestPayload ?? {}, null, 2)}</pre>
            </details>
            <details className="settings-disclosure" open>
              <summary>{inline("模型原始输出", "Raw model output")}</summary>
              <pre className="settings-json settings-json-large">{props.aiRequestLogDetail.responseText ?? noDataLabel}</pre>
            </details>
            <details className="settings-disclosure">
              <summary>{inline("响应载荷", "Response payload")}</summary>
              <pre className="settings-json">{JSON.stringify(props.aiRequestLogDetail.responsePayload ?? {}, null, 2)}</pre>
            </details>
            <details className="settings-disclosure" open>
              <summary>{inline("解析后的结构化结果", "Parsed structured result")}</summary>
              <pre className="settings-json">{JSON.stringify(props.aiRequestLogDetail.result?.parsedModelOutput ?? {}, null, 2)}</pre>
            </details>
            <details className="settings-disclosure" open>
              <summary>{inline("Builder 到最终标题", "Builder to final title")}</summary>
              <pre className="settings-json">{JSON.stringify(props.aiRequestLogDetail.result?.composition ?? {}, null, 2)}</pre>
            </details>
          </div>
        ) : null}

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
              {visibleAiRequests.length === 0 ? (
                <tr>
                  <td className="ops-log-empty" colSpan={10}>
                    {aiRequestLogs ? inline("当前筛选条件下没有日志。", "No logs matched the current filters.") : inline("还没有 AI 请求日志。", "No AI request logs yet.")}
                  </td>
                </tr>
              ) : null}
              {visibleAiRequests.map((item) => (
                <tr
                  className="ops-log-row"
                  data-selected={props.selectedRequestLogId === item.id ? "true" : undefined}
                  data-status={item.status}
                  key={item.id}
                  onClick={() => props.onSelectRequestLog(item.id)}
                >
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
                    <div className="ops-log-primary" title={item.status === "succeeded" ? item.finalName ?? "" : item.error ?? ""}>
                      {item.status === "succeeded" ? item.finalName ?? noDataLabel : item.error ?? noDataLabel}
                    </div>
                    <div className="ops-log-secondary ops-log-nowrap" title={item.status === "succeeded" ? inline("输出标题", "final name") : item.error ? inline("错误", "error") : item.metadata?.profile ?? ""}>
                      {item.status === "succeeded"
                        ? inline("输出标题", "final name")
                        : item.error
                          ? inline("错误", "error")
                          : item.metadata?.profile ?? noDataLabel}
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
