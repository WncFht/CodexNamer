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
        <p className="panel-kicker">{props.inline("后台", "Background")}</p>
        <h2>{props.inline("先确认 daemon 存活，再看下一轮时间和队列", "Check daemon health, then the next sweep and queue")}</h2>
        <p>
          {props.inline(
            "大多数时候只需要确认三件事：进程在不在、下一轮何时触发、上一轮有没有留下积压。更技术的日志和启动参数放在下面折叠区。",
            "Most of the time you only need three facts: is the process alive, when will the next sweep fire, and did the last run leave backlog behind. Deeper logs and launch details stay in the folded technical section."
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
