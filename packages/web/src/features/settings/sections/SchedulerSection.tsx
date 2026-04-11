import {
  type DraftFieldUpdater,
  type RenameAutoApply,
  type SettingsDraft
} from "../../../settings-model.js";
import { SelectField, SettingsSectionFrame, type TextTools } from "../shared.js";

export function SchedulerSection(props: {
  draft: SettingsDraft;
  text: TextTools;
  updateDraftField: DraftFieldUpdater;
}) {
  return (
    <SettingsSectionFrame
      kicker={props.text.tt("scheduler")}
      title={props.text.inline("控制什么时候建议、什么时候自动应用", "Control when to suggest and when to auto-apply")}
      copy={props.text.inline(
        "这里是自动 rename 的时间阈值和保护阈值。配置层允许自动应用，但真正是否执行，还要结合运行态里的 daemon 状态一起看。",
        "These are the timing and protection thresholds for auto rename. Config can allow auto apply, but actual execution still depends on daemon runtime state."
      )}
    >
      <div className="settings-stage-grid">
        <article className="settings-surface-card">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.inline("Apply policy", "Apply policy")}</p>
              <h4>{props.text.inline("自动应用开关", "Auto-apply policy")}</h4>
            </div>
          </div>
          <SelectField
            label={props.text.tt("autoApply")}
            onChange={(value) => {
              props.updateDraftField("renameAutoApply", value);
            }}
            options={[
              { value: "disabled", label: "disabled" },
              { value: "idle-finalize", label: "idle-finalize" }
            ]}
            value={props.draft.renameAutoApply as RenameAutoApply}
          />
        </article>

        <article className="settings-surface-card settings-span-two">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.tt("autoRenameWatch")}</p>
              <h4>{props.text.inline("Scan / idle 阈值", "Scan / idle thresholds")}</h4>
            </div>
          </div>
          <div className="settings-two-up">
            <label className="settings-field">
              <span>{props.text.tt("scanInterval")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("scanIntervalSeconds", event.target.value);
                }}
                value={props.draft.scanIntervalSeconds}
              />
            </label>
            <label className="settings-field">
              <span>{props.text.tt("candidateIdle")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("candidateIdleSeconds", event.target.value);
                }}
                value={props.draft.candidateIdleSeconds}
              />
            </label>
            <label className="settings-field">
              <span>{props.text.tt("finalizeIdle")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("finalizeIdleSeconds", event.target.value);
                }}
                value={props.draft.finalizeIdleSeconds}
              />
            </label>
            <label className="settings-field">
              <span>{props.text.tt("renameCooldown")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("renameCooldownSeconds", event.target.value);
                }}
                value={props.draft.renameCooldownSeconds}
              />
            </label>
            <label className="settings-field">
              <span>{props.text.tt("maxAutoRenames")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("maxAutoRenamesPerSession", event.target.value);
                }}
                value={props.draft.maxAutoRenamesPerSession}
              />
            </label>
          </div>
        </article>

        <article className="settings-surface-card">
          <div className="settings-card-header">
            <div>
              <p className="panel-kicker">{props.text.tt("housekeeping")}</p>
              <h4>{props.text.inline("压缩建议阈值", "Compaction guidance")}</h4>
            </div>
          </div>
          <div className="settings-two-up">
            <label className="settings-field">
              <span>{props.text.tt("suggestCompactMb")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("maintenanceCompactMb", event.target.value);
                }}
                value={props.draft.maintenanceCompactMb}
              />
            </label>
            <label className="settings-field">
              <span>{props.text.tt("suggestCompactLines")}</span>
              <input
                onChange={(event) => {
                  props.updateDraftField("maintenanceCompactLines", event.target.value);
                }}
                value={props.draft.maintenanceCompactLines}
              />
            </label>
          </div>
          <div className="settings-checks">
            <label className="toggle">
              <input
                checked={props.draft.maintenanceBackupBeforeCompact}
                onChange={(event) => {
                  props.updateDraftField("maintenanceBackupBeforeCompact", event.target.checked);
                }}
                type="checkbox"
              />
              {props.text.tt("backupBeforeCompact")}
            </label>
          </div>
        </article>
      </div>
    </SettingsSectionFrame>
  );
}
