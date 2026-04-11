import { autoRenameReasonLabel, autoRenameStatusLabel, formatUiNumber, type UiLanguage } from "../../i18n.js";
import type { AutoRenamePreviewResponse, OverviewResponse } from "../../types.js";
import type { ChartBuilder, ChartOption, ChartTheme } from "./charting.js";

type InlineText = (zh: string, en: string) => string;

function sweepAxisLabel(value: string, language: UiLanguage): string {
  return new Intl.DateTimeFormat(language, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function buildRenameActivityOption(params: {
  overview: OverviewResponse | null;
  appliedLabel: string;
  previewLabel: string;
  skippedLabel: string;
}): ChartBuilder | undefined {
  const { overview, appliedLabel, previewLabel, skippedLabel } = params;
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
}

export function buildPipelineOption(params: {
  overview: OverviewResponse | null;
  inline: InlineText;
  uiLanguage: UiLanguage;
}): ChartBuilder | undefined {
  const { overview, inline, uiLanguage } = params;
  if (!overview) {
    return undefined;
  }

  const stages = [
    { label: inline("刚发现", "Discovered"), value: overview.pipeline.discovered, color: "#b7b3a7" },
    { label: inline("活跃中", "Active"), value: overview.pipeline.active, color: "#a57533" },
    { label: inline("候选就绪", "Candidate ready"), value: overview.pipeline.candidateReady, color: "#6f8a53" },
    { label: inline("可终稿", "Finalize ready"), value: overview.pipeline.finalizeReady, color: "#c96442" },
    { label: inline("已应用", "Applied"), value: overview.pipeline.applied, color: "#4f7d66" }
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
          formatter(chartParams: { value: number }) {
            return formatUiNumber(chartParams.value, uiLanguage);
          }
        }
      }
    ]
  });
}

export function buildFlowOption(params: {
  previewItems: AutoRenamePreviewResponse["items"];
  uiLanguage: UiLanguage;
}): ChartBuilder | undefined {
  const { previewItems, uiLanguage } = params;
  if (previewItems.length === 0) {
    return undefined;
  }

  const linkCounts = new Map<string, number>();
  for (const item of previewItems) {
    const source = autoRenameReasonLabel(item.reason || item.status, uiLanguage);
    const target = autoRenameStatusLabel(item.status, uiLanguage);
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
              name === autoRenameStatusLabel("apply", uiLanguage)
                ? theme.accent
                : name === autoRenameStatusLabel("suggest", uiLanguage)
                  ? theme.warning
                  : name === autoRenameStatusLabel("skip", uiLanguage)
                    ? theme.muted
                    : theme.manual
          }
        })),
        links
      }
    ]
  });
}

export function buildSweepTrendOption(params: {
  recentSweeps: OverviewResponse["runtime"]["recentSweeps"];
  inline: InlineText;
  uiLanguage: UiLanguage;
}): ChartBuilder | undefined {
  const { recentSweeps, inline, uiLanguage } = params;
  if (recentSweeps.length === 0) {
    return undefined;
  }

  const labels = recentSweeps.map((item) => sweepAxisLabel(item.at, uiLanguage));
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
}

export function buildSweepActionOption(params: {
  recentSweeps: OverviewResponse["runtime"]["recentSweeps"];
  inline: InlineText;
  uiLanguage: UiLanguage;
}): ChartBuilder | undefined {
  const { recentSweeps, inline, uiLanguage } = params;
  if (recentSweeps.length === 0) {
    return undefined;
  }

  const labels = recentSweeps.map((item) => sweepAxisLabel(item.at, uiLanguage));
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
}

export function buildRuleCoverageOption(params: {
  overview: OverviewResponse | null;
  inline: InlineText;
  uiLanguage: UiLanguage;
}): ChartBuilder | undefined {
  const { overview, inline, uiLanguage } = params;
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
          formatter(chartParams: { value: number }) {
            return formatUiNumber(chartParams.value, uiLanguage);
          }
        }
      }
    ]
  });
}
