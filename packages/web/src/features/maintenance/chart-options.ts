import { autoRenameReasonLabel, autoRenameStatusLabel, formatUiNumber, type UiLanguage } from "../../i18n.js";
import type { AutoRenamePreviewResponse, OverviewResponse } from "../../types.js";
import type { ChartBuilder, ChartOption, ChartTheme } from "./charting.js";

type InlineText = (zh: string, en: string) => string;

function buildChartTooltip(theme: ChartTheme, axisPointer?: Record<string, unknown>) {
  return {
    trigger: axisPointer ? "axis" : "item",
    ...(axisPointer ? { axisPointer } : {}),
    confine: true,
    backgroundColor: theme.tooltipBg,
    borderColor: theme.tooltipBorder,
    borderWidth: 1,
    textStyle: {
      color: theme.tooltipText,
      fontSize: 12
    }
  };
}

function buildSliderDataZoom(theme: ChartTheme, startValue: number, endValue: number, zoomLock: boolean) {
  return [
    {
      type: "inside",
      filterMode: "none",
      zoomLock,
      startValue,
      endValue
    },
    {
      type: "slider",
      filterMode: "none",
      height: 18,
      bottom: 18,
      borderColor: "transparent",
      backgroundColor: theme.surface,
      fillerColor: theme.accentTint,
      handleStyle: {
        color: theme.accent,
        borderColor: theme.border
      },
      moveHandleStyle: {
        color: theme.accent
      },
      textStyle: {
        color: theme.muted
      },
      startValue,
      endValue
    }
  ];
}

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
    tooltip: buildChartTooltip(theme, { type: "line" }),
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
    dataZoom: buildSliderDataZoom(
      theme,
      Math.max(0, overview.activity.buckets.length - 8),
      Math.max(0, overview.activity.buckets.length - 1),
      overview.activity.buckets.length <= 8
    ),
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
          color: theme.success
        },
        itemStyle: {
          color: theme.success
        },
        areaStyle: {
          color: new echartsLib.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: theme.successAreaStart },
            { offset: 1, color: theme.successAreaEnd }
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
          color: theme.note
        },
        itemStyle: {
          color: theme.note
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

  return (theme: ChartTheme): ChartOption => ({
    backgroundColor: "transparent",
    tooltip: buildChartTooltip(theme, { type: "shadow" }),
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
      data: [
        inline("刚发现", "Discovered"),
        inline("活跃中", "Active"),
        inline("候选就绪", "Candidate ready"),
        inline("可终稿", "Finalize ready"),
        inline("已应用", "Applied")
      ],
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
        data: [
          { value: overview.pipeline.discovered, itemStyle: { color: theme.muted, borderRadius: [0, 10, 10, 0] } },
          { value: overview.pipeline.active, itemStyle: { color: theme.warning, borderRadius: [0, 10, 10, 0] } },
          { value: overview.pipeline.candidateReady, itemStyle: { color: theme.note, borderRadius: [0, 10, 10, 0] } },
          { value: overview.pipeline.finalizeReady, itemStyle: { color: theme.accent, borderRadius: [0, 10, 10, 0] } },
          { value: overview.pipeline.applied, itemStyle: { color: theme.success, borderRadius: [0, 10, 10, 0] } }
        ],
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
    tooltip: buildChartTooltip(theme),
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
                  ? theme.note
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
    tooltip: buildChartTooltip(theme, { type: "line" }),
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
    dataZoom: buildSliderDataZoom(theme, startIndex, recentSweeps.length - 1, recentSweeps.length <= 10),
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
            { offset: 0, color: theme.accentAreaStart },
            { offset: 1, color: theme.accentAreaEnd }
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
          color: theme.warning
        },
        itemStyle: {
          color: theme.warning
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
          color: theme.note
        },
        itemStyle: {
          color: theme.note
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
    tooltip: buildChartTooltip(theme, { type: "shadow" }),
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
    dataZoom: buildSliderDataZoom(theme, startIndex, recentSweeps.length - 1, recentSweeps.length <= 10),
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
          color: theme.note,
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

  return (theme: ChartTheme): ChartOption => ({
    backgroundColor: "transparent",
    tooltip: buildChartTooltip(theme, { type: "shadow" }),
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
      data: [
        inline("最新规则", "Latest"),
        inline("规则落后", "Outdated"),
        inline("手动命名", "Manual"),
        inline("未知签名", "Unknown")
      ],
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
        data: [
          { value: overview.ruleCoverage.latest, itemStyle: { color: theme.success, borderRadius: [0, 10, 10, 0] } },
          { value: overview.ruleCoverage.outdated, itemStyle: { color: theme.danger, borderRadius: [0, 10, 10, 0] } },
          { value: overview.ruleCoverage.manual, itemStyle: { color: theme.manual, borderRadius: [0, 10, 10, 0] } },
          { value: overview.ruleCoverage.unknown, itemStyle: { color: theme.warning, borderRadius: [0, 10, 10, 0] } }
        ],
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
