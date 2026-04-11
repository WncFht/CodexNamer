import * as React from "react";

export type ChartTheme = {
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
