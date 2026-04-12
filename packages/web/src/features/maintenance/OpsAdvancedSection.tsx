import type { AiRequestLogsSectionProps } from "./AiRequestLogsSection.js";
import { AiRequestLogsSection } from "./AiRequestLogsSection.js";
import { ChartCard, type ChartBuilder } from "./charting.js";
import { DoctorSection } from "./DoctorSection.js";

export function OpsAdvancedSection(props: {
  inline: (zh: string, en: string) => string;
  activityOption?: ChartBuilder;
  pipelineOption?: ChartBuilder;
  flowOption?: ChartBuilder;
  sweepActionOption?: ChartBuilder;
  aiRequestLogsSectionProps: AiRequestLogsSectionProps;
  doctor: Parameters<typeof DoctorSection>[0]["doctor"];
}) {
  return (
    <div className="ops-disclosure-stack">
      <div className="ops-disclosure-grid">
        <ChartCard
          buildOption={props.sweepActionOption}
          copy={props.inline(
            "展示每轮 sweep 的 suggest、apply、skip 和 auto-apply 分布。",
            "Shows the suggest, apply, skip, and auto-apply distribution of each sweep."
          )}
          title={props.inline("Sweep 动作拆分", "Sweep action breakdown")}
        />
        <ChartCard
          buildOption={props.pipelineOption}
          copy={props.inline(
            "展示会话在各个阶段的分布。",
            "Shows the distribution of sessions across pipeline stages."
          )}
          title={props.inline("会话阶段分布", "Session stage distribution")}
        />
        <ChartCard
          buildOption={props.flowOption}
          copy={props.inline(
            "展示预览原因与动作之间的对应关系。",
            "Shows how preview reasons map to actions."
          )}
          runtime="sankey"
          title={props.inline("原因到动作的流向", "Reason to action flow")}
        />
        <ChartCard
          buildOption={props.activityOption}
          copy={props.inline(
            "展示最近 14 天的命名活动。",
            "Shows rename activity over the last 14 days."
          )}
          title={props.inline("近期重命名活动", "Recent rename activity")}
        />
      </div>

      <AiRequestLogsSection {...props.aiRequestLogsSectionProps} />

      <DoctorSection doctor={props.doctor} inline={props.inline} />
    </div>
  );
}
