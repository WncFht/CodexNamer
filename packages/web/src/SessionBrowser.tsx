import { formatWhen, groupSessionsByTime, sessionDisplayTitle, toneForSession } from "./browser-utils.js";
import { TranscriptPanel } from "./TranscriptPanel.js";
import type { SessionDetail, SessionSummary } from "./types.js";

export function SessionBrowser(props: {
  sessions: SessionSummary[];
  selectedWorkspaceLabel: string;
  selectedId?: string;
  detail: SessionDetail | null;
  loadingSessions: boolean;
  loadingDetail: boolean;
  actioning: boolean;
  search: string;
  dirtyOnly: boolean;
  showHiddenTranscript: boolean;
  error: string | null;
  onSearchChange: (value: string) => void;
  onDirtyOnlyChange: (value: boolean) => void;
  onToggleShowHiddenTranscript: (value: boolean) => void;
  onRefresh: () => void;
  onSelectSession: (threadId: string) => void;
  onSuggest: () => void | Promise<void>;
  onApply: () => void | Promise<void>;
  onToggleFreeze: () => void | Promise<void>;
  onToggleManualOverride: () => void | Promise<void>;
}) {
  const groupedSessions = groupSessionsByTime(props.sessions);

  return (
    <section className="history-layout">
      <section className="session-list-view">
        <header className="view-header session-list-header">
          <div>
            <h2>{props.selectedWorkspaceLabel}</h2>
            <span className="badge">{props.sessions.length} sessions</span>
          </div>
          <div className="header-actions">
            <button className="btn-refresh" onClick={props.onRefresh} title="Refresh" type="button">
              &#8635; Refresh
            </button>
            <label className="checkbox-inline">
              <input
                checked={props.dirtyOnly}
                onChange={(event) => props.onDirtyOnlyChange(event.target.checked)}
                type="checkbox"
              />
              Dirty only
            </label>
            <input
              className="filter-input"
              onChange={(event) => props.onSearchChange(event.target.value)}
              placeholder="Filter sessions..."
              value={props.search}
            />
          </div>
        </header>

        <div className="session-list">
          {props.loadingSessions ? <div className="loading-state history-empty">Loading sessions...</div> : null}
          {!props.loadingSessions && props.sessions.length === 0 ? (
            <div className="history-empty">
              {props.error ? "API not ready yet. The dashboard will retry automatically." : "No sessions matched the current filter."}
            </div>
          ) : null}
          {groupedSessions.map((group) => (
            <section className="session-group-block" key={group.label}>
              <div className="time-group-header">
                <span>{group.label}</span>
                <span>{group.items.length}</span>
              </div>
              {group.items.map((session) => (
                <button
                  className={props.selectedId === session.threadId ? "session-item active" : "session-item"}
                  key={session.threadId}
                  onClick={() => props.onSelectSession(session.threadId)}
                  type="button"
                >
                  <div className="session-item-topline">
                    <span className={`session-status-dot ${toneForSession(session)}`} />
                    <span className="session-updated">{formatWhen(session.updatedAt)}</span>
                    <span className="session-state-label">{session.statusEstimate ?? "unknown"}</span>
                  </div>
                  <div className="session-item-title">{sessionDisplayTitle(session)}</div>
                  <div className="session-item-subtitle">{session.candidateName ?? session.threadId}</div>
                  <div className="session-item-meta">
                    <span>{session.workspaceLabel}</span>
                    <span>{session.provider ?? "unknown provider"}</span>
                    <span>{session.taskCompleteCount} tasks</span>
                  </div>
                </button>
              ))}
            </section>
          ))}
        </div>
      </section>

      <section className="chat-view">
        {props.detail ? (
          <>
            <header className="view-header chat-header">
              <div className="chat-title-wrap">
                <div className="chat-title-block">
                  <h2 className="editable-title">{sessionDisplayTitle(props.detail)}</h2>
                  <div className="chat-meta-bar">
                    <span>{props.detail.cwd ?? props.detail.workspaceLabel}</span>
                    <span>{props.detail.provider ?? "unknown provider"}</span>
                    <span>{props.detail.model ?? "unknown model"}</span>
                    <span>{props.detail.tokenTotal} tokens</span>
                  </div>
                </div>
                <div className="chat-header-right">
                  {props.detail.dirty ? <span className="chip danger">dirty</span> : <span className="chip success">clean</span>}
                  {props.detail.frozen ? <span className="chip warning">frozen</span> : null}
                  {props.detail.manualOverride ? <span className="chip manual">manual</span> : null}
                  <button className="btn-sm" disabled={props.actioning} onClick={props.onSuggest} type="button">
                    Suggest
                  </button>
                  <button className="btn-sm" disabled={props.actioning} onClick={props.onApply} type="button">
                    Apply
                  </button>
                  <button className="btn-sm" disabled={props.actioning} onClick={props.onToggleFreeze} type="button">
                    {props.detail.frozen ? "Unfreeze" : "Freeze"}
                  </button>
                  <button className="btn-sm" disabled={props.actioning} onClick={props.onToggleManualOverride} type="button">
                    {props.detail.manualOverride ? "Clear Manual" : "Manual Override"}
                  </button>
                </div>
              </div>
            </header>

            {props.loadingDetail ? <div className="loading-state chat-loading">Loading session detail...</div> : null}

            <TranscriptPanel
              detail={props.detail}
              showHiddenTranscript={props.showHiddenTranscript}
              onToggleShowHiddenTranscript={props.onToggleShowHiddenTranscript}
            />

            <div className="chat-footer-panels">
              <section className="detail-panel">
                <h3>Signals</h3>
                <dl className="signal-grid">
                  <div>
                    <dt>Workspace</dt>
                    <dd>{props.detail.workspaceLabel}</dd>
                  </div>
                  <div>
                    <dt>Project</dt>
                    <dd>{props.detail.projectName ?? "n/a"}</dd>
                  </div>
                  <div>
                    <dt>First User</dt>
                    <dd>{props.detail.firstUserMessage ?? "n/a"}</dd>
                  </div>
                  <div>
                    <dt>Last Agent</dt>
                    <dd>{props.detail.lastAgentMessage ?? "n/a"}</dd>
                  </div>
                </dl>
              </section>

              <section className="detail-panel">
                <h3>Rename history</h3>
                <div className="history-stack">
                  {(props.detail.renameHistory ?? []).slice(0, 10).map((entry, index) => (
                    <article className="history-row" key={`${index}-${entry.appliedAt}-${entry.newName}`}>
                      <div>
                        <strong>{entry.newName}</strong>
                        <p>
                          {entry.kind} / {entry.source} / {entry.status}
                        </p>
                      </div>
                      <span>{formatWhen(entry.appliedAt)}</span>
                    </article>
                  ))}
                  {(props.detail.renameHistory ?? []).length === 0 ? (
                    <div className="history-empty">No rename history yet.</div>
                  ) : null}
                </div>
              </section>
            </div>
          </>
        ) : (
          <div className="history-empty">Select a session to inspect transcript and rename history.</div>
        )}
      </section>
    </section>
  );
}
