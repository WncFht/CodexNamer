import * as React from "react";

import { THEME_CHANGE_EVENT } from "../../app-shell/useThemePreference.js";

export type ChartTheme = {
  text: string;
  muted: string;
  border: string;
  surface: string;
  surfaceAlt: string;
  accent: string;
  accentRgb: string;
  accentTint: string;
  accentAreaStart: string;
  accentAreaEnd: string;
  success: string;
  successRgb: string;
  successAreaStart: string;
  successAreaEnd: string;
  warning: string;
  danger: string;
  manual: string;
  note: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
};

export type ChartOption = Record<string, unknown>;
export type ChartBuilder = (theme: ChartTheme, echartsLib: any) => ChartOption;
export type ChartRuntime = "basic" | "sankey";

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

let basicRuntimePromise: Promise<any> | null = null;
let sankeyRuntimePromise: Promise<any> | null = null;

function normalizeColorToRgb(color: string, fallback: string): string {
  const trimmed = color.trim();
  const rgbMatch = trimmed.match(/rgba?\(([^)]+)\)/i);
  if (rgbMatch) {
    const rgbValues = (rgbMatch[1] ?? "")
      .split(",")
      .map((part) => part.trim())
      .slice(0, 3);
    const [r = "0", g = "0", b = "0"] = rgbValues;
    return `${r}, ${g}, ${b}`;
  }

  const hex = trimmed.replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const r = hex.charAt(0);
    const g = hex.charAt(1);
    const b = hex.charAt(2);
    return `${parseInt(r + r, 16)}, ${parseInt(g + g, 16)}, ${parseInt(b + b, 16)}`;
  }

  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return `${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}`;
  }

  return fallback;
}

async function loadBasicRuntime(): Promise<any> {
  if (!basicRuntimePromise) {
    basicRuntimePromise = Promise.all([
      import("echarts/charts"),
      import("echarts/components"),
      import("echarts/core"),
      import("echarts/renderers")
    ]).then(([charts, components, core, renderers]) => {
      const { BarChart, LineChart } = charts as any;
      const { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } = components as any;
      const { getInstanceByDom, graphic, init, use: registerCharts } = core as any;
      const { CanvasRenderer } = renderers as any;
      registerCharts([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);
      return { getInstanceByDom, graphic, init };
    });
  }
  return basicRuntimePromise;
}

async function loadSankeyRuntime(): Promise<any> {
  if (!sankeyRuntimePromise) {
    sankeyRuntimePromise = Promise.all([
      import("echarts/charts"),
      import("echarts/components"),
      import("echarts/core"),
      import("echarts/renderers")
    ]).then(([charts, components, core, renderers]) => {
      const { SankeyChart } = charts as any;
      const { TooltipComponent } = components as any;
      const { getInstanceByDom, init, use: registerCharts } = core as any;
      const { CanvasRenderer } = renderers as any;
      registerCharts([SankeyChart, TooltipComponent, CanvasRenderer]);
      return { getInstanceByDom, init };
    });
  }
  return sankeyRuntimePromise;
}

function readChartTheme(): ChartTheme {
  const rootStyle = getComputedStyle(document.documentElement);
  const accentRgbValue = rootStyle.getPropertyValue("--color-accent-rgb").trim() || "251 143 104";
  const accentRgb = accentRgbValue.includes(",") ? accentRgbValue : accentRgbValue.split(/\s+/).join(", ");
  const successColor = rootStyle.getPropertyValue("--color-success").trim() || rootStyle.getPropertyValue("--success").trim() || "#4f8b63";
  const successRgb = normalizeColorToRgb(successColor, "79, 139, 99");
  return {
    text:
      rootStyle.getPropertyValue("--color-text-secondary").trim() ||
      rootStyle.getPropertyValue("--text-secondary").trim() ||
      "#46342a",
    muted:
      rootStyle.getPropertyValue("--color-text-muted").trim() ||
      rootStyle.getPropertyValue("--text-muted").trim() ||
      "#5f4d42",
    border:
      rootStyle.getPropertyValue("--color-border-strong").trim() ||
      rootStyle.getPropertyValue("--border-strong").trim() ||
      "#cbb69d",
    surface:
      rootStyle.getPropertyValue("--color-bg-muted").trim() ||
      rootStyle.getPropertyValue("--bg-secondary").trim() ||
      "#f8efe4",
    surfaceAlt:
      rootStyle.getPropertyValue("--color-bg-surface").trim() ||
      rootStyle.getPropertyValue("--bg-elevated").trim() ||
      "#ffffff",
    accent:
      rootStyle.getPropertyValue("--color-accent").trim() ||
      rootStyle.getPropertyValue("--accent").trim() ||
      "#fb8f68",
    accentRgb,
    accentTint: `rgba(${accentRgb}, 0.18)`,
    accentAreaStart: `rgba(${accentRgb}, 0.24)`,
    accentAreaEnd: `rgba(${accentRgb}, 0.04)`,
    success: successColor,
    successRgb,
    successAreaStart: `rgba(${successRgb}, 0.22)`,
    successAreaEnd: `rgba(${successRgb}, 0.04)`,
    warning:
      rootStyle.getPropertyValue("--color-warning").trim() ||
      rootStyle.getPropertyValue("--warning").trim() ||
      "#d8871d",
    danger:
      rootStyle.getPropertyValue("--color-danger").trim() ||
      rootStyle.getPropertyValue("--danger").trim() ||
      "#c84c3a",
    manual:
      rootStyle.getPropertyValue("--color-note").trim() ||
      rootStyle.getPropertyValue("--manual").trim() ||
      "#8d7bd6",
    note:
      rootStyle.getPropertyValue("--color-note").trim() ||
      "#8d7bd6",
    tooltipBg:
      rootStyle.getPropertyValue("--color-bg-surface").trim() ||
      rootStyle.getPropertyValue("--bg-elevated").trim() ||
      "#ffffff",
    tooltipBorder:
      rootStyle.getPropertyValue("--color-border-subtle").trim() ||
      rootStyle.getPropertyValue("--border-subtle").trim() ||
      "rgba(42 28 23 / 0.12)",
    tooltipText:
      rootStyle.getPropertyValue("--color-text-primary").trim() ||
      rootStyle.getPropertyValue("--text").trim() ||
      "#2a1c17"
  };
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
      ...(typeof preserved.startValue === "number" ? { startValue: clampIndex(preserved.startValue, maxIndex) } : {}),
      ...(typeof preserved.endValue === "number" ? { endValue: clampIndex(preserved.endValue, maxIndex) } : {})
    };
  });

  return {
    ...option,
    dataZoom: nextDataZoom
  };
}

function useChart(
  ref: React.RefObject<HTMLDivElement | null>,
  buildOption: ChartBuilder | undefined,
  runtime: ChartRuntime
): void {
  const chartRef = React.useRef<LoadedChart | null>(null);
  const loadRuntime = React.useCallback(() => {
    return runtime === "sankey" ? loadSankeyRuntime() : loadBasicRuntime();
  }, [runtime]);

  React.useEffect(() => {
    const container = ref.current;
    if (!container) {
      return;
    }

    let observer: ResizeObserver | undefined;
    let disposed = false;

    void loadRuntime().then((echartsLib) => {
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
  }, [loadRuntime, ref]);

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

    void loadRuntime().then((echartsLib) => {
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
  }, [buildOption, loadRuntime, ref]);

  React.useEffect(() => {
    if (!buildOption) {
      return;
    }

    const handleThemeChange = () => {
      const chart = chartRef.current;
      if (!chart) {
        return;
      }
      const preservedDataZoom = readCurrentDataZoomState(chart.instance);
      const nextOption = applyPreservedDataZoom(buildOption(readChartTheme(), chart.echartsLib), preservedDataZoom);
      chart.instance.setOption(nextOption, true);
    };

    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange as EventListener);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange as EventListener);
    };
  }, [buildOption]);
}

export function ChartCard(props: {
  title: string;
  copy: string;
  buildOption?: ChartBuilder;
  runtime?: ChartRuntime;
}) {
  const chartRef = React.useRef<HTMLDivElement | null>(null);
  useChart(chartRef, props.buildOption, props.runtime ?? "basic");

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
