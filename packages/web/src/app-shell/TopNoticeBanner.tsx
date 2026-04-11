import type { UiNotice } from "../control-deck-model.js";

export function TopNoticeBanner(props: {
  notice: UiNotice | null;
}) {
  if (!props.notice) {
    return null;
  }

  return (
    <div
      aria-live={props.notice.tone === "error" ? "assertive" : "polite"}
      className={`notice-banner app-notice ${props.notice.tone}`}
      role={props.notice.tone === "error" ? "alert" : "status"}
    >
      {props.notice.text}
    </div>
  );
}
