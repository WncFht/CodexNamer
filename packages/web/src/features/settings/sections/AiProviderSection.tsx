import { useMemo } from "react";

import {
  asRecord,
  firstNonEmptyString,
  type AiBackend,
  type DraftFieldUpdater,
  type DraftStateUpdater,
  type ProviderSource,
  type SettingsDraft,
  updateSelectedProfile
} from "../../../settings-model.js";
import type {
  ConfigView,
  ProviderProfile,
  ProviderResponse,
  ProviderTestResponse
} from "../../../types.js";
import { SelectField, SettingsSectionFrame, type TextTools } from "../shared.js";

export function AiProviderSection(props: {
  draft: SettingsDraft;
  providers: ProviderResponse | null;
  providerTestResult: ProviderTestResponse | null;
  providerTesting: boolean;
  configView: ConfigView;
  text: TextTools;
  updateDraftState: DraftStateUpdater;
  updateDraftField: DraftFieldUpdater;
  onParseCodex: () => Promise<void>;
  onTestProvider: () => Promise<void>;
}) {
  const effective = asRecord(props.configView.effectiveConfig);
  const inheritedCodex = asRecord(effective.inheritedCodex);
  const resolvedProvider = asRecord(props.providers?.resolvedProvider);
  const selectedProfile = useMemo(
    () => props.draft.providerProfiles.find((profile) => profile.profileId === props.draft.selectedProfileId),
    [props.draft]
  );
  const usingManualSource = props.draft.aiProviderSource === "manual";
  const selectedProfileLabel = usingManualSource
    ? firstNonEmptyString(selectedProfile?.profileId, props.draft.aiProfile) ?? props.text.tt("nA")
    : props.text.inline("Codex 配置", "Codex config");
  const selectedBaseUrl =
    firstNonEmptyString(
      ...(usingManualSource
        ? [selectedProfile?.baseUrl, props.providers?.resolvedProvider?.baseUrl, inheritedCodex.baseUrl]
        : [props.providers?.resolvedProvider?.baseUrl, inheritedCodex.baseUrl, selectedProfile?.baseUrl])
    ) ?? props.text.tt("nA");
  const selectedModel =
    firstNonEmptyString(
      ...(usingManualSource
        ? [selectedProfile?.model, props.providers?.resolvedProvider?.model, inheritedCodex.model]
        : [props.providers?.resolvedProvider?.model, inheritedCodex.model, selectedProfile?.model])
    ) ?? props.text.tt("nA");
  const selectedRequestType =
    firstNonEmptyString(
      ...(usingManualSource
        ? [selectedProfile?.requestType, resolvedProvider.requestType, inheritedCodex.wireApi]
        : [resolvedProvider.requestType, inheritedCodex.wireApi, selectedProfile?.requestType])
    ) ?? props.text.tt("nA");
  const resolvedRequestedBackend = firstNonEmptyString(resolvedProvider.requestedBackend, props.draft.aiBackend) ?? props.text.tt("nA");
  const resolvedTransport = firstNonEmptyString(resolvedProvider.preferredTransport, resolvedProvider.transport) ?? props.text.tt("nA");
  const resolvedCredential = resolvedProvider.hasCredential
    ? firstNonEmptyString(resolvedProvider.credentialSource, resolvedProvider.credentialKind) ?? props.text.inline("已配置", "Configured")
    : props.text.inline("未配置", "Missing");
  const directHttpLabel = resolvedProvider.canDirectHttp
    ? props.text.inline("可直接 HTTP", "Direct HTTP ready")
    : props.text.inline("配置不完整", "Configuration incomplete");
  const requestPath = [props.draft.aiBackend, props.draft.aiProviderSource, selectedProfileLabel, resolvedTransport].filter(Boolean);
  const timeoutOptions = Array.from(new Set([props.draft.aiTimeoutSeconds, "15", "30", "45", "60", "90"])).filter(Boolean);
  const temperatureOptions = Array.from(new Set([props.draft.aiTemperature, "0", "0.2", "0.4", "0.7", "1"])).filter(Boolean);
  const sourceDetailTitle = usingManualSource
    ? props.text.inline("手动配置", "Manual config")
    : props.text.inline("Codex 配置", "Codex config");
  const sourceDetailCopy = usingManualSource
    ? props.text.inline(
        "当来源为 `manual` 时，rename 和测试都会使用这里选中的手动配置。",
        "When the source is `manual`, rename and provider tests use the selected manual profile here."
      )
    : props.text.inline(
        "当来源为 `codex-config` 时，rename 和测试都会直接读取当前 Codex 配置与鉴权。",
        "When the source is `codex-config`, rename and provider tests read the current Codex config and auth directly."
      );
  const connectivityTone = props.providerTestResult
    ? props.providerTestResult.ok
      ? "success"
      : "danger"
    : "idle";
  const connectivityStatus = props.providerTestResult
    ? props.providerTestResult.ok
      ? props.text.inline("通过", "Passed")
      : props.text.inline("失败", "Failed")
    : props.text.inline("未测试", "Not tested");
  const connectivityLatency = props.providerTestResult?.latencyMs ? `${props.providerTestResult.latencyMs} ms` : props.text.tt("nA");
  const connectivitySummary =
    firstNonEmptyString(props.providerTestResult?.responseText, props.providerTestResult?.error) ??
    props.text.inline("还没有测试结果，先重新解析或手动调整配置后再测。", "No connectivity result yet. Reload or adjust the config, then run a test.");

  return (
    <SettingsSectionFrame
      kicker={props.text.tt("provider")}
      title={props.text.inline("把命名请求走向讲清楚", "Make the naming request path easy to inspect")}
      copy={props.text.inline(
        "先确定请求类型与配置来源，再看当前实际命中的 provider、凭证和连通性。这里只保留 builder + AI 路径，不再做静默回退。",
        "Choose the request type and config source first, then inspect the provider, credentials, and connectivity actually in effect. This panel only supports the builder plus AI path, with no silent fallback."
      )}
    >
      <div className="settings-stage-grid settings-stage-grid-wide">
        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.tt("ai")}</p>
              <h4>{props.text.inline("请求类型与配置来源", "Request type and config source")}</h4>
            </div>
          </div>
          <div className="settings-two-up">
            <SelectField
              label={props.text.tt("requestType")}
              onChange={(value) => {
                props.updateDraftField("aiBackend", value);
              }}
              options={[
                { value: "responses", label: "responses" },
                { value: "openai-compatible", label: "openai-compatible" },
                { value: "none", label: "none" }
              ]}
              value={props.draft.aiBackend as AiBackend}
            />
            <SelectField
              label={props.text.tt("providerSource")}
              onChange={(value) => {
                props.updateDraftField("aiProviderSource", value);
              }}
              options={[
                { value: "codex-config", label: "codex-config" },
                { value: "manual", label: "manual" }
              ]}
              value={props.draft.aiProviderSource as ProviderSource}
            />
            <SelectField
              label={props.text.inline("并发数", "Max concurrency")}
              onChange={(value) => {
                props.updateDraftField("aiMaxConcurrency", value);
              }}
              options={[
                { value: "1", label: "1" },
                { value: "2", label: "2" },
                { value: "4", label: "4" },
                { value: "6", label: "6" },
                { value: "8", label: "8" }
              ]}
              value={props.draft.aiMaxConcurrency}
            />
            <SelectField
              label={props.text.tt("timeoutSeconds")}
              onChange={(value) => {
                props.updateDraftField("aiTimeoutSeconds", value);
              }}
              options={timeoutOptions.map((value) => ({ value, label: value }))}
              value={props.draft.aiTimeoutSeconds}
            />
            <SelectField
              label={props.text.tt("temperature")}
              onChange={(value) => {
                props.updateDraftField("aiTemperature", value);
              }}
              options={temperatureOptions.map((value) => ({ value, label: value }))}
              value={props.draft.aiTemperature}
            />
          </div>
          <div className="settings-action-row">
            <button className="btn-sm" onClick={() => void props.onParseCodex()} type="button">
              {usingManualSource
                ? props.text.inline("从 Codex 配置导入当前手动配置", "Import Codex config into manual profile")
                : props.text.inline("重新解析 Codex 配置", "Reload Codex config")}
            </button>
            <button className="btn-sm primary" disabled={props.providerTesting} onClick={() => void props.onTestProvider()} type="button">
              {props.providerTesting ? props.text.inline("测试中...", "Testing...") : props.text.inline("测试 URL + API Key", "Test URL + API key")}
            </button>
          </div>
          <div className="settings-provider-flow">
            {requestPath.map((step, index) => (
              <div className="settings-provider-step" key={`${index}-${step}`}>
                <span>{index + 1}</span>
                <strong>{step}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="settings-surface-card">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Resolved route", "Resolved route")}</p>
              <h4>{props.text.inline("当前请求会怎么走", "How requests will actually flow")}</h4>
            </div>
          </div>
          <dl className="settings-runtime-grid compact">
            <div>
              <dt>{props.text.tt("requestType")}</dt>
              <dd>{resolvedRequestedBackend}</dd>
            </div>
            <div>
              <dt>{props.text.inline("传输方式", "Transport")}</dt>
              <dd>{resolvedTransport}</dd>
            </div>
            <div>
              <dt>{props.text.inline("凭证", "Credential")}</dt>
              <dd>{resolvedCredential}</dd>
            </div>
            <div>
              <dt>{props.text.inline("HTTP 直连", "Direct HTTP")}</dt>
              <dd>{directHttpLabel}</dd>
            </div>
          </dl>
        </article>

        <article className="settings-surface-card">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Resolved target", "Resolved target")}</p>
              <h4>{props.text.inline("当前会打到哪个 provider", "Which provider is in effect right now")}</h4>
            </div>
          </div>
          <dl className="settings-runtime-grid compact">
            <div>
              <dt>{usingManualSource ? props.text.tt("selectedProfile") : props.text.inline("配置来源", "Config source")}</dt>
              <dd>{selectedProfileLabel}</dd>
            </div>
            <div>
              <dt>{props.text.tt("baseUrl")}</dt>
              <dd>{selectedBaseUrl}</dd>
            </div>
            <div>
              <dt>{props.text.tt("model")}</dt>
              <dd>{selectedModel}</dd>
            </div>
            <div>
              <dt>{props.text.tt("requestType")}</dt>
              <dd>{selectedRequestType}</dd>
            </div>
            <div>
              <dt>{props.text.tt("providerRef")}</dt>
              <dd>{String(resolvedProvider.providerRef ?? selectedProfile?.providerRef ?? props.text.tt("nA"))}</dd>
            </div>
            <div>
              <dt>{props.text.inline("requires auth", "Requires auth")}</dt>
              <dd>{resolvedProvider.requiresOpenaiAuth ? props.text.inline("是", "Yes") : props.text.inline("否", "No")}</dd>
            </div>
          </dl>
          <details className="settings-disclosure">
            <summary>{props.text.tt("inspectResolvedProvider")}</summary>
            <pre className="settings-json">{JSON.stringify(props.providers?.resolvedProvider ?? {}, null, 2)}</pre>
          </details>
        </article>

        <article className={`settings-surface-card settings-span-two settings-connectivity-card ${connectivityTone}`}>
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Connectivity", "Connectivity")}</p>
              <h4>{props.text.inline("测试结果与延迟", "Test result and latency")}</h4>
            </div>
          </div>
          <div className="settings-connectivity-layout">
            <section className="settings-connectivity-hero">
              <span className={`settings-status-pill ${connectivityTone}`}>{connectivityStatus}</span>
              <strong>{connectivityLatency}</strong>
              <p>{connectivitySummary}</p>
            </section>
            <dl className="settings-runtime-grid compact settings-connectivity-grid">
              <div>
                <dt>{props.text.inline("状态", "Status")}</dt>
                <dd>{connectivityStatus}</dd>
              </div>
              <div>
                <dt>{props.text.inline("Ping", "Ping")}</dt>
                <dd>{connectivityLatency}</dd>
              </div>
              <div>
                <dt>{props.text.inline("测试时间", "Tested at")}</dt>
                <dd>{props.providerTestResult?.testedAt ?? props.text.tt("nA")}</dd>
              </div>
              <div>
                <dt>{props.text.inline("结果摘要", "Summary")}</dt>
                <dd>{connectivitySummary}</dd>
              </div>
            </dl>
          </div>
        </article>

        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Source detail", "Source detail")}</p>
              <h4>{sourceDetailTitle}</h4>
              <p className="settings-copy">{sourceDetailCopy}</p>
            </div>
          </div>

          {usingManualSource && selectedProfile ? (
            <>
              <div className="settings-provider-groups">
                <section className="settings-provider-group">
                  <div className="settings-card-header">
                    <div>
                      <p className="panel-kicker">{props.text.inline("Profile", "Profile")}</p>
                      <h4>{props.text.inline("选择并标识手动配置", "Select and identify the manual profile")}</h4>
                    </div>
                  </div>
                  <div className="settings-two-up">
                    <label className="settings-field">
                      <span>{props.text.tt("activeProfile")}</span>
                      <select
                        onChange={(event) => {
                          const nextProfileId = event.target.value;
                          props.updateDraftState((current) => ({
                            ...current,
                            aiProfile: nextProfileId,
                            selectedProfileId: nextProfileId
                          }));
                        }}
                        value={props.draft.aiProfile}
                      >
                        {props.draft.providerProfiles.map((profile) => (
                          <option key={profile.profileId} value={profile.profileId}>
                            {profile.profileId}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="settings-field">
                      <span>{props.text.tt("editProfile")}</span>
                      <select
                        onChange={(event) => {
                          props.updateDraftField("selectedProfileId", event.target.value, {
                            dirty: false
                          });
                        }}
                        value={props.draft.selectedProfileId}
                      >
                        {props.draft.providerProfiles.map((profile) => (
                          <option key={profile.profileId} value={profile.profileId}>
                            {profile.profileId}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="settings-field">
                      <span>{props.text.tt("displayName")}</span>
                      <input
                        onChange={(event) => {
                          props.updateDraftState((current) => ({
                            ...current,
                            providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                              displayName: event.target.value
                            })
                          }));
                        }}
                        value={selectedProfile.displayName ?? ""}
                      />
                    </label>
                    <SelectField<NonNullable<ProviderProfile["requestType"]>>
                      label={props.text.tt("requestType")}
                      onChange={(value) => {
                        props.updateDraftState((current) => ({
                          ...current,
                          providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                            requestType: value
                          })
                        }));
                      }}
                      options={[
                        { value: "responses", label: "responses" },
                        { value: "openai-compatible", label: "openai-compatible" }
                      ]}
                      value={selectedProfile.requestType ?? "responses"}
                    />
                    <label className="settings-field">
                      <span>{props.text.tt("providerRef")}</span>
                      <input
                        onChange={(event) => {
                          props.updateDraftState((current) => ({
                            ...current,
                            providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                              providerRef: event.target.value
                            })
                          }));
                        }}
                        value={selectedProfile.providerRef ?? ""}
                      />
                    </label>
                  </div>
                </section>

                <section className="settings-provider-group">
                  <div className="settings-card-header">
                    <div>
                      <p className="panel-kicker">{props.text.inline("Endpoint", "Endpoint")}</p>
                      <h4>{props.text.inline("接口与模型", "Endpoint and model")}</h4>
                    </div>
                  </div>
                  <div className="settings-two-up">
                    <label className="settings-field">
                      <span>{props.text.tt("baseUrl")}</span>
                      <input
                        onChange={(event) => {
                          props.updateDraftState((current) => ({
                            ...current,
                            providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                              baseUrl: event.target.value
                            })
                          }));
                        }}
                        value={selectedProfile.baseUrl ?? ""}
                      />
                    </label>
                    <label className="settings-field">
                      <span>{props.text.tt("model")}</span>
                      <input
                        onChange={(event) => {
                          props.updateDraftState((current) => ({
                            ...current,
                            providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                              model: event.target.value
                            })
                          }));
                        }}
                        value={selectedProfile.model ?? ""}
                      />
                    </label>
                  </div>
                </section>

                <section className="settings-provider-group">
                  <div className="settings-card-header">
                    <div>
                      <p className="panel-kicker">{props.text.inline("Credentials", "Credentials")}</p>
                      <h4>{props.text.inline("鉴权与启停", "Authentication and toggles")}</h4>
                    </div>
                  </div>
                  <div className="settings-two-up">
                    <label className="settings-field">
                      <span>{props.text.tt("apiKey")}</span>
                      <input
                        onChange={(event) => {
                          props.updateDraftState((current) => ({
                            ...current,
                            providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                              apiKey: event.target.value
                            })
                          }));
                        }}
                        value={selectedProfile.apiKey ?? ""}
                      />
                    </label>
                    <label className="settings-field">
                      <span>{props.text.tt("apiKeyRef")}</span>
                      <input
                        onChange={(event) => {
                          props.updateDraftState((current) => ({
                            ...current,
                            providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                              apiKeyRef: event.target.value
                            })
                          }));
                        }}
                        value={selectedProfile.apiKeyRef ?? ""}
                      />
                    </label>
                  </div>
                  <div className="settings-checks">
                    <label className="toggle">
                      <input
                        checked={selectedProfile.enabled ?? true}
                        onChange={(event) => {
                          props.updateDraftState((current) => ({
                            ...current,
                            providerProfiles: updateSelectedProfile(current.providerProfiles, current.selectedProfileId, {
                              enabled: event.target.checked
                            })
                          }));
                        }}
                        type="checkbox"
                      />
                      {props.text.tt("enabled")}
                    </label>
                    <label className="toggle">
                      <input
                        checked={selectedProfile.isDefault ?? false}
                        onChange={(event) => {
                          props.updateDraftState((current) => ({
                            ...current,
                            providerProfiles: current.providerProfiles.map((profile) => ({
                              ...profile,
                              isDefault: profile.profileId === current.selectedProfileId ? event.target.checked : false
                            }))
                          }));
                        }}
                        type="checkbox"
                      />
                      {props.text.tt("defaultProfile")}
                    </label>
                  </div>
                </section>
              </div>
            </>
          ) : !usingManualSource ? (
            <div className="settings-provider-groups">
              <section className="settings-provider-group">
                <div className="settings-card-header">
                  <div>
                    <p className="panel-kicker">{props.text.inline("Inherited provider", "Inherited provider")}</p>
                    <h4>{props.text.inline("当前读取到的 Codex 配置", "Codex config currently in effect")}</h4>
                  </div>
                </div>
                <dl className="settings-runtime-grid compact">
                  <div>
                    <dt>{props.text.inline("模型提供方", "Model provider")}</dt>
                    <dd>{String(inheritedCodex.modelProvider ?? props.text.tt("nA"))}</dd>
                  </div>
                  <div>
                    <dt>{props.text.tt("requestType")}</dt>
                    <dd>{String(inheritedCodex.wireApi ?? props.text.tt("nA"))}</dd>
                  </div>
                  <div>
                    <dt>{props.text.tt("baseUrl")}</dt>
                    <dd>{String(inheritedCodex.baseUrl ?? resolvedProvider.baseUrl ?? props.text.tt("nA"))}</dd>
                  </div>
                  <div>
                    <dt>{props.text.tt("model")}</dt>
                    <dd>{String(inheritedCodex.model ?? props.text.tt("nA"))}</dd>
                  </div>
                </dl>
              </section>
            </div>
          ) : (
            <div className="settings-empty-state">
              {props.text.inline(
                "当前没有可编辑的手动配置，请先创建或选择一个 profile。",
                "There is no editable manual config yet. Create or select a profile first."
              )}
            </div>
          )}
        </article>
      </div>
    </SettingsSectionFrame>
  );
}
