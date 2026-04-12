import type { DoctorResponse } from "../../types.js";

export function DoctorSection(props: {
  inline: (zh: string, en: string) => string;
  doctor: DoctorResponse | null;
}) {
  return (
    <section className="detail-panel">
      <p className="panel-kicker">{props.inline("诊断", "Diagnostics")}</p>
      <h3>{props.inline("运行时原始信息", "Raw runtime details")}</h3>
      <p className="settings-copy">{props.inline("查看原始 doctor 输出。", "View the raw doctor output.")}</p>
      <details className="settings-disclosure ops-disclosure">
        <summary>{props.inline("查看原始诊断 JSON", "Inspect raw doctor JSON")}</summary>
        <pre className="settings-json">{JSON.stringify(props.doctor ?? {}, null, 2)}</pre>
      </details>
    </section>
  );
}
