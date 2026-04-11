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
            "把每轮 sweep 拆成 suggest / apply / skip / auto-applied，先看 daemon 是在排队、跳过，还是已经落盘。",
            "Break each sweep into suggest / apply / skip / auto-applied so you can see whether the daemon is mostly queuing, skipping, or actually landing titles."
          )}
          title={props.inline("Sweep 动作拆分", "Sweep action breakdown")}
        />
        <ChartCard
          buildOption={props.pipelineOption}
          copy={props.inline(
            "会话会先落在活跃、候选就绪、可终稿这些阶段里，用来判断整体卡在哪一段。",
            "Sessions flow through stages like active, candidate-ready, and finalize-ready. Use this to see where the system is currently bottlenecked."
          )}
          title={props.inline("会话阶段分布", "Session stage distribution")}
        />
        <ChartCard
          buildOption={props.flowOption}
          copy={props.inline(
            "把当前预览队列里的原因映射到动作，用来解释为什么是跳过、建议还是应用。",
            "Maps current preview reasons to actions so you can explain why items are skipping, suggesting, or applying."
          )}
          runtime="sankey"
          title={props.inline("原因到动作的流向", "Reason to action flow")}
        />
        <ChartCard
          buildOption={props.activityOption}
          copy={props.inline(
            "最近 14 天的 rename 活动，用来区分真正落盘、仅预览和跳过。",
            "Rename activity across the last 14 days, separating landed applies, preview-only passes, and skips."
          )}
          title={props.inline("近期重命名活动", "Recent rename activity")}
        />
      </div>

      <AiRequestLogsSection {...props.aiRequestLogsSectionProps} />

      <DoctorSection doctor={props.doctor} inline={props.inline} />
    </div>
  );
}
