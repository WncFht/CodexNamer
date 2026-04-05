import * as React from "react";

import { formatWhen } from "./browser-utils.js";
import { autoRenameReasonLabel, autoRenameStatusLabel, formatUiNumber, t, type UiLanguage } from "./i18n.js";
import type { AutoRenamePreviewResponse, DoctorResponse, OverviewResponse } from "./types.js";

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

function useChart(
  ref: React.RefObject<HTMLDivElement | null>,
  buildOption: ((theme: ChartTheme, echartsLib: any) => ChartOption) | undefined
): void {
  React.useEffect(() => {
    const container = ref.current;
    if (!container || !buildOption) {
      return;
    }

    let observer: ResizeObserver | undefined;
    let instance: any;
    let disposed = false;

    void import("echarts").then((echartsLib) => {
      if (disposed) {
        return;
      }

      instance =
        echartsLib.getInstanceByDom(container) ??
        echartsLib.init(container, undefined, {
          renderer: "canvas"
        });
      instance.setOption(buildOption(readChartTheme(), echartsLib), true);

      observer = new ResizeObserver(() => {
        instance?.resize();
      });
      observer.observe(container);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      instance?.dispose();
    };
  }, [ref, buildOption]);
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

export function RenameOpsPanel(props: {
  overview: OverviewResponse | null;
  preview: AutoRenamePreviewResponse | null;
  previewRefreshing: boolean;
  doctor: DoctorResponse | null;
  uiLanguage: UiLanguage;
  onRefreshPreview: (options?: { includeCandidateNames?: boolean; urgent?: boolean }) => void | Promise<void>;
}) {
  const tt = (key: Parameters<typeof t>[1]) => t(props.uiLanguage, key);
  const inline = (zh: string, en: string) => (props.uiLanguage === "zh-CN" ? zh : en);
  const overview = props.overview;
  const previewItems = props.preview?.items ?? [];
  const previewApplyCount = previewItems.filter((item) => item.status === "apply").length;
  const previewSuggestCount = previewItems.filter((item) => item.status === "suggest").length;
  const previewSkipCount = previewItems.filter((item) => item.status === "skip").length;
  const previewHasCandidateNames = previewItems.some((item) => typeof item.candidateName === "string");
  const sourceSeries = [
    { name: "AI", value: overview?.renameHistory.aiApplied ?? 0, colorKey: "accent" as const },
    { name: inline("启发式", "Heuristic"), value: overview?.renameHistory.heuristicApplied ?? 0, colorKey: "success" as const },
    { name: inline("混合", "Hybrid"), value: overview?.renameHistory.hybridApplied ?? 0, colorKey: "warning" as const },
    { name: inline("手动", "Manual"), value: overview?.renameHistory.manualApplied ?? 0, colorKey: "manual" as const },
    { name: inline("批量", "Batch"), value: overview?.renameHistory.batchApplied ?? 0, colorKey: "danger" as const }
  ].filter((item) => item.value > 0);

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
        data: [inline("已应用", "Applied"), inline("仅预览", "Preview"), inline("已跳过", "Skipped")],
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
          name: inline("已应用", "Applied"),
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
          name: inline("仅预览", "Preview"),
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
          name: inline("已跳过", "Skipped"),
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
  }, [inline, overview]);

  const sourceOption = React.useMemo(() => {
    if (!overview) {
      return undefined;
    }

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
                    name: inline("暂无数据", "No data"),
                    value: 1,
                    itemStyle: {
                      color: theme.border
                    }
                  }
                ]
        }
      ]
    });
  }, [inline, overview, props.uiLanguage, sourceSeries]);

  const workloadOption = React.useMemo(() => {
    if (!overview) {
      return undefined;
    }

    const bars = overview.workload.topWorkspacesByTokens
      .slice()
      .reverse()
      .map((item) => ({
        label: item.workspaceLabel,
        value: item.tokens,
        sessions: item.sessions
      }));

    return (theme: ChartTheme, echartsLib: any): ChartOption => ({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow"
        },
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        borderColor: "rgba(255, 255, 255, 0.1)",
        textStyle: { color: "#fff", fontSize: 12 },
        formatter(params: Array<{ value: number; dataIndex: number }>) {
          const entry = bars[params[0]?.dataIndex ?? 0];
          if (!entry) {
            return "";
          }
          return `${entry.label}<br/>${formatCompactNumber(entry.value, props.uiLanguage)} tokens<br/>${entry.sessions} ${inline("个会话", "sessions")}`;
        }
      },
      grid: {
        left: 12,
        right: 24,
        top: 12,
        bottom: 12,
        containLabel: true
      },
      xAxis: {
        type: "value",
        axisLabel: {
          color: theme.text,
          fontSize: 11,
          formatter(value: number) {
            return formatCompactNumber(value, props.uiLanguage);
          }
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
        data: bars.map((item) => item.label),
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
          data: bars.map((item) => item.value),
          barWidth: 16,
          itemStyle: {
            borderRadius: [0, 10, 10, 0],
            color: new echartsLib.graphic.LinearGradient(1, 0, 0, 0, [
              { offset: 0, color: "rgba(201, 100, 66, 0.95)" },
              { offset: 1, color: "rgba(201, 100, 66, 0.3)" }
            ])
          },
          label: {
            show: true,
            position: "right",
            color: theme.text,
            fontSize: 11,
            formatter(params: { value: number }) {
              return formatCompactNumber(params.value, props.uiLanguage);
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
              {inline(
                "当前 daemon 只做 scan + preview。`finalize_ready` 表示允许应用，不表示已经自动落盘。",
                "The current daemon only scans and previews. `finalize_ready` means eligible to apply, not already auto-applied."
              )}
            </p>
          </div>
          <div className="header-actions">
            <button
              className="btn-sm"
              onClick={() => {
                void props.onRefreshPreview({ urgent: true });
              }}
              type="button"
            >
              {props.previewRefreshing ? tt("refreshing") : tt("refresh")}
            </button>
            <button
              className="btn-sm"
              onClick={() => {
                void props.onRefreshPreview({ includeCandidateNames: true, urgent: true });
              }}
              type="button"
            >
              {inline("按需载入候选名", "Load candidate names")}
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
          <span className={`chip ${overview?.runtime.daemonAutoApply ? "success" : "warning"}`}>
            {inline("Daemon 自动应用", "Daemon auto apply")}: {overview?.runtime.daemonAutoApply ? inline("开启", "on") : inline("关闭", "off")}
          </span>
          <span className="chip success">
            {inline("最近应用", "Last apply")}: {formatWhen(overview?.renameHistory.lastAppliedAt, props.uiLanguage)}
          </span>
        </div>

        <div className="settings-metrics-grid ops-kpis">
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
            <span className="metric-label">{inline("当前队列", "Current queues")}</span>
            <strong>
              {formatUiNumber(previewApplyCount + previewSuggestCount, props.uiLanguage)}
            </strong>
            <p>
              {formatUiNumber(previewApplyCount, props.uiLanguage)} {inline("待应用", "apply")} / {formatUiNumber(previewSuggestCount, props.uiLanguage)} {inline("待建议", "suggest")}
            </p>
          </article>
        </div>
      </section>

      <ChartCard
        buildOption={activityOption}
        copy={inline("最近 14 天的 rename 活动，用来区分真正落盘、仅预览和跳过。", "Rename activity over the last 14 days, separating landed applies, preview-only passes, and skips.")}
        title={inline("近期重命名活动", "Recent rename activity")}
      />
      <ChartCard
        buildOption={sourceOption}
        copy={inline("真正应用成功的命名来源分布，帮助判断 AI、启发式和手动操作占比。", "Distribution of successfully applied rename sources across AI, heuristic, and manual flows.")}
        title={inline("应用来源分布", "Applied source mix")}
      />
      <ChartCard
        buildOption={workloadOption}
        copy={inline("按工作区观察当前 token 压力，确认高消耗主要集中在哪些目录。", "Current token load by workspace to see where the heaviest session cost is concentrated.")}
        title={inline("工作区 Token 压力", "Workspace token load")}
      />

      <section className="detail-panel">
        <div className="panel-topline">
          <div>
            <p className="panel-kicker">{tt("scheduler")}</p>
            <h3>{inline("预览队列", "Preview queue")}</h3>
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
          {previewItems.slice(0, 16).map((item) => (
            <article className="history-row" key={`${item.threadId}-${item.status}-${item.reason}`}>
              <div>
                <strong>{item.candidateName ?? item.threadId}</strong>
                <p>{item.threadId}</p>
              </div>
              <span>
                {autoRenameStatusLabel(item.status, props.uiLanguage)} / {autoRenameReasonLabel(item.reason, props.uiLanguage)}
              </span>
            </article>
          ))}
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
