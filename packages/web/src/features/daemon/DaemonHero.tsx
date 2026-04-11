export function DaemonHero(props: {
  inline: (zh: string, en: string) => string;
  running: boolean;
  actioning: "start" | "stop" | null;
  onRefresh: () => void;
  onStart: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
}) {
  return (
    <div className="settings-hero daemon-hero">
      <div className="settings-hero-copy">
        <p className="panel-kicker">{props.inline("后台自动命名", "Background automation")}</p>
        <h2>{props.inline("默认随 API 启动，通常只需要看它是否在正常跑", "Usually you only need to know whether it is running")}</h2>
        <p>
          {props.inline(
            "这里控制的是 session sweep daemon。默认会随 Local API 拉起，所以主界面只保留运行状态、下一轮时间和当前队列；更技术的进程细节收进下面的折叠区。",
            "This controls the session sweep daemon. It starts with the Local API by default, so the main view stays focused on status, next sweep timing, and the current queue while deeper process details stay folded below."
          )}
        </p>
      </div>
      <div className="daemon-actions">
        <button className="btn-sm" onClick={props.onRefresh} type="button">
          {props.inline("刷新状态", "Refresh")}
        </button>
        {props.running ? (
          <button
            className="btn-sm"
            disabled={props.actioning === "stop"}
            onClick={() => void props.onStop()}
            type="button"
          >
            {props.actioning === "stop" ? props.inline("停止中...", "Stopping...") : props.inline("停止后台", "Stop background worker")}
          </button>
        ) : (
          <button
            className="btn-sm primary"
            disabled={props.actioning === "start"}
            onClick={() => void props.onStart()}
            type="button"
          >
            {props.actioning === "start" ? props.inline("启动中...", "Starting...") : props.inline("启动后台", "Start background worker")}
          </button>
        )}
      </div>
    </div>
  );
}
