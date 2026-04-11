import { asRecord } from "../../../settings-model.js";
import type { ConfigView, ProviderResponse } from "../../../types.js";
import { SettingsSectionFrame, type TextTools } from "../shared.js";

export function RuntimeSection(props: {
  configView: ConfigView;
  providers: ProviderResponse | null;
  text: TextTools;
}) {
  const effective = asRecord(props.configView.effectiveConfig);
  const inheritedCodex = asRecord(effective.inheritedCodex);

  return (
    <SettingsSectionFrame
      kicker={props.text.tt("runtime")}
      title={props.text.inline("运行时解析结果与 provider 路径", "Resolved runtime state and provider path")}
      copy={props.text.inline(
        "Prompt 已经移到命名策略区，这里只保留运行时路径、provider 解析和配置落点，方便排查真正会命中的后端。",
        "Prompt has moved into the Naming policy section. This view keeps runtime paths, provider resolution, and config locations so you can inspect the backend that is actually in effect."
      )}
    >
      <div className="settings-stage-grid settings-stage-grid-wide">
        <article className="settings-surface-card">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.tt("resolvedEnvironment")}</p>
              <h4>{props.text.inline("路径与 provider 解析", "Paths and provider resolution")}</h4>
            </div>
          </div>
          <dl className="settings-runtime-grid">
            <div>
              <dt>{props.text.tt("userConfig")}</dt>
              <dd>{props.configView.paths.userConfigPath || props.text.tt("nA")}</dd>
            </div>
            <div>
              <dt>{props.text.tt("projectOverride")}</dt>
              <dd>{props.configView.paths.projectConfigPath || props.text.tt("nA")}</dd>
            </div>
            <div>
              <dt>{props.text.tt("resolvedBackend")}</dt>
              <dd>{String(props.providers?.resolvedProvider?.resolvedBackend ?? props.text.tt("nA"))}</dd>
            </div>
            <div>
              <dt>{props.text.tt("resolvedTransport")}</dt>
              <dd>{String(props.providers?.resolvedProvider?.transport ?? props.text.tt("nA"))}</dd>
            </div>
            <div>
              <dt>{props.text.tt("inheritedModelProvider")}</dt>
              <dd>{String(inheritedCodex.modelProvider ?? props.text.tt("nA"))}</dd>
            </div>
            <div>
              <dt>{props.text.tt("inheritedModel")}</dt>
              <dd>{String(inheritedCodex.model ?? props.text.tt("nA"))}</dd>
            </div>
          </dl>
          <details className="settings-disclosure">
            <summary>{props.text.tt("inspectResolvedProvider")}</summary>
            <pre className="settings-json">{JSON.stringify(props.providers?.resolvedProvider ?? {}, null, 2)}</pre>
          </details>
        </article>
      </div>
    </SettingsSectionFrame>
  );
}
