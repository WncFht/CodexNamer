import { formatWhen } from "../../browser-utils.js";
import type { DaemonControlStatus } from "../../types.js";

export function DaemonTechnicalDetails(props: {
  inline: (zh: string, en: string) => string;
  daemon: DaemonControlStatus | null;
  uiLanguage: "en-US" | "zh-CN";
}) {
  return (
    <section className="detail-panel ops-span-wide">
      <div className="panel-topline">
        <div>
          <p className="panel-kicker">{props.inline("高级", "Advanced")}</p>
          <h3>{props.inline("技术细节与日志", "Technical details and logs")}</h3>
          <p className="settings-copy">
            {props.inline(
              "PID、启动命令和日志都保留，但默认收起，避免后台页看起来像纯运维面板。",
              "PID, launch command, and log tail are still available, but folded by default so this page does not read like a pure ops console."
            )}
          </p>
        </div>
      </div>
      <details className="settings-disclosure ops-disclosure">
        <summary>{props.inline("展开技术细节", "Show technical details")}</summary>
        <div className="daemon-advanced-grid">
          <article className="settings-surface-card daemon-command-card">
            <p className="panel-kicker">{props.inline("Process", "Process")}</p>
            <h4>{props.inline("进程与启动参数", "Process and launch details")}</h4>
            <dl className="settings-runtime-grid compact">
              <div>
                <dt>PID</dt>
                <dd>{props.daemon?.pid ?? props.inline("未启动", "stopped")}</dd>
              </div>
              <div>
                <dt>{props.inline("API 进程", "API pid")}</dt>
                <dd>{props.daemon?.apiProcessId ?? "--"}</dd>
              </div>
              <div>
                <dt>{props.inline("停止时间", "Stopped")}</dt>
                <dd>{formatWhen(props.daemon?.stoppedAt, props.uiLanguage)}</dd>
              </div>
              <div>
                <dt>{props.inline("退出状态", "Exit")}</dt>
                <dd>
                  {props.daemon?.lastExitCode ?? "--"}
                  {props.daemon?.lastExitSignal ? ` / ${props.daemon.lastExitSignal}` : ""}
                </dd>
              </div>
            </dl>
            <p className="daemon-mono">
              {props.daemon?.command.executable ?? "node"} {props.daemon?.command.scriptPath ?? "--"}{" "}
              {props.daemon?.command.args.join(" ") ?? ""}
            </p>
            <p className="settings-copy">
              {props.inline("工作目录：", "Working directory: ")}
              <span className="daemon-mono">{props.daemon?.command.cwd ?? "--"}</span>
            </p>
            {props.daemon?.lastError ? (
              <p className="settings-copy daemon-error">
                {props.inline("最近错误：", "Last error: ")}
                {props.daemon.lastError}
              </p>
            ) : null}
          </article>

          <article className="settings-surface-card daemon-log-card">
            <p className="panel-kicker">{props.inline("Logs", "Logs")}</p>
            <h4>{props.inline("最近日志", "Recent log tail")}</h4>
            <div className="daemon-log">
              {props.daemon?.recentLogs?.length ? (
                props.daemon.recentLogs.map((entry, index) => (
                  <div className={`daemon-log-line ${entry.stream}`} key={`${entry.at}-${index}`}>
                    <span className="daemon-log-time">{formatWhen(entry.at, props.uiLanguage)}</span>
                    <span className="daemon-log-stream">{entry.stream}</span>
                    <code>{entry.line}</code>
                  </div>
                ))
              ) : (
                <p className="settings-copy">{props.inline("还没有 daemon 日志。", "No daemon logs yet.")}</p>
              )}
            </div>
          </article>
        </div>
      </details>
    </section>
  );
}
