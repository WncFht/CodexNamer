import type { ChartBuilder } from "./charting.js";
import { ChartCard } from "./charting.js";

export function OpsPrimaryChartsSection(props: {
  inline: (zh: string, en: string) => string;
  sweepTrendOption?: ChartBuilder;
  ruleCoverageOption?: ChartBuilder;
}) {
  return (
    <>
      <ChartCard
        buildOption={props.sweepTrendOption}
        copy={props.inline(
          "展示每轮 sweep 的处理量、待处理量和失败趋势。",
          "Shows handled volume, pending volume, and failure trend for each sweep.",
        )}
        title={props.inline("后台 Sweep 趋势", "Daemon sweep trend")}
      />
      <ChartCard
        buildOption={props.ruleCoverageOption}
        copy={props.inline(
          "展示正式标题的规则签名分布。",
          "Shows the distribution of rule signatures for official titles.",
        )}
        title={props.inline("规则覆盖分布", "Rule coverage")}
      />
    </>
  );
}
