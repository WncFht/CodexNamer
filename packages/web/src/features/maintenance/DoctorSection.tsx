import type { DoctorResponse } from "../../types.js";

export function DoctorSection(props: {
  inline: (zh: string, en: string) => string;
  doctor: DoctorResponse | null;
}) {
  return (
    <section className="detail-panel">
      <p className="panel-kicker">{props.inline("诊断", "Diagnostics")}</p>
      <h3>{props.inline("运行时原始信息", "Raw runtime details")}</h3>
      <p className="settings-copy">
        {props.inline(
          "保留原始 doctor 输出，方便核对 runtime 与面板摘要是否一致。",
          "Keeps the raw doctor payload available when you need to compare runtime facts with the summarized dashboard."
        )}
      </p>
      <details className="settings-disclosure ops-disclosure">
        <summary>{props.inline("查看原始诊断 JSON", "Inspect raw doctor JSON")}</summary>
        <pre className="settings-json">{JSON.stringify(props.doctor ?? {}, null, 2)}</pre>
      </details>
    </section>
  );
}
