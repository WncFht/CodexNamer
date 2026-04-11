import { ChartCard, type ChartBuilder } from "./charting.js";

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
          "先看每轮 sweep 扫了多少 dirty、处理了多少、还剩多少待下一轮，以及失败有没有抬头。",
          "Start with how many dirty sessions each sweep saw, how much it handled, what remained for the next round, and whether failures are rising."
        )}
        title={props.inline("后台 Sweep 趋势", "Daemon sweep trend")}
      />
      <ChartCard
        buildOption={props.ruleCoverageOption}
        copy={props.inline(
          "正式标题按规则签名分成最新、落后、手动和未知四类，用来判断是否该去 requeue 补扫。",
          "Official titles are grouped into latest, outdated, manual, and unknown rule signatures so you can tell whether replay is the next step."
        )}
        title={props.inline("规则覆盖分布", "Rule coverage")}
      />
    </>
  );
}
