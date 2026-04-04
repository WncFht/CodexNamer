import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";

import {
  applySession,
  fetchEvents,
  fetchAutoRenamePreview,
  fetchDoctor,
  fetchProviders,
  fetchSessionDetail,
  fetchSessions,
  freezeSession,
  suggestSession,
  toggleManualOverride
} from "./api.js";
import type {
  AutoRenamePreviewResponse,
  ApiEventsResponse,
  DoctorResponse,
  ProviderResponse,
  SessionDetail,
  SessionSummary
} from "./types.js";

type TabId = "sessions" | "providers" | "maintenance";

function formatWhen(value?: string): string {
  if (!value) {
    return "n/a";
  }
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function toneForSession(session: SessionSummary): string {
  if (session.manualOverride) {
    return "manual";
  }
  if (session.frozen) {
    return "frozen";
  }
  if (session.dirty) {
    return "dirty";
  }
  return "clean";
}

export function App() {
  const [tab, setTab] = useState<TabId>("sessions");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [providers, setProviders] = useState<ProviderResponse | null>(null);
  const [doctor, setDoctor] = useState<DoctorResponse | null>(null);
  const [preview, setPreview] = useState<AutoRenamePreviewResponse | null>(null);
  const [search, setSearch] = useState("");
  const [dirtyOnly, setDirtyOnly] = useState(true);
  const [loading, setLoading] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);
  const eventCursorRef = useRef(0);

  const reloadSidePanels = async () => {
    const [providerPayload, doctorPayload] = await Promise.all([fetchProviders(), fetchDoctor()]);
    setProviders(providerPayload);
    setDoctor(doctorPayload);
  };

  const reloadSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const [sessionPayload, previewPayload] = await Promise.all([
        fetchSessions({
          search: deferredSearch,
          dirtyOnly
        }),
        fetchAutoRenamePreview()
      ]);
      setSessions(sessionPayload.items);
      setPreview(previewPayload);
      setLastSyncAt(new Date().toISOString());
      if (!selectedId && sessionPayload.items[0]) {
        setSelectedId(sessionPayload.items[0].threadId);
      } else if (selectedId && !sessionPayload.items.some((item) => item.threadId === selectedId)) {
        setSelectedId(sessionPayload.items[0]?.threadId);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reloadSessions();
  }, [deferredSearch, dirtyOnly]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    let active = true;
    setActioning(true);
    setError(null);
    void fetchSessionDetail(selectedId)
      .then((payload) => {
        if (active) {
          setDetail(payload);
        }
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : "Unknown error");
        }
      })
      .finally(() => {
        if (active) {
          setActioning(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedId]);

  useEffect(() => {
    let active = true;
    void reloadSidePanels()
      .then(() => {
        if (active) {
          setLastSyncAt((previous) => previous ?? new Date().toISOString());
        }
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : "Unknown error");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!error) {
        return;
      }

      void reloadSessions();
      void reloadSidePanels().catch(() => undefined);
      if (selectedId) {
        void fetchSessionDetail(selectedId)
          .then(setDetail)
          .catch(() => undefined);
      }
    }, 3_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [error, selectedId, deferredSearch, dirtyOnly]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchEvents(eventCursorRef.current)
        .then((payload: ApiEventsResponse) => {
          eventCursorRef.current = payload.nextCursor;
          if (payload.items.length === 0) {
            return;
          }

          void reloadSessions();
          void reloadSidePanels().catch(() => undefined);
          if (selectedId) {
            void fetchSessionDetail(selectedId)
              .then(setDetail)
              .catch(() => undefined);
          }
        })
        .catch(() => {
          void reloadSessions();
        });
    }, 5_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [selectedId, deferredSearch, dirtyOnly]);

  const runAction = async (action: () => Promise<void>) => {
    if (!selectedId) {
      return;
    }
    setActioning(true);
    setError(null);
    try {
      await action();
      await Promise.all([
        reloadSessions(),
        fetchSessionDetail(selectedId).then(setDetail),
        reloadSidePanels()
      ]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setActioning(false);
    }
  };

  const selectedSummary = sessions.find((item) => item.threadId === selectedId);

  return (
    <div className="app-shell">
      <aside className="left-rail">
        <div className="brand">
          <p className="eyebrow">Codex Session Manager</p>
          <h1>Session Control Deck</h1>
          <p className="subtitle">Name drift, dirty queues, provider wiring.</p>
        </div>

        <nav className="nav-stack">
          {[
            ["sessions", "Sessions"],
            ["providers", "Providers"],
            ["maintenance", "Maintenance"]
          ].map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "nav-item active" : "nav-item"}
              onClick={() => setTab(id as TabId)}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>

        <section className="sidebar-card">
          <div className="sidebar-metric">
            <span>Visible</span>
            <strong>{sessions.length}</strong>
          </div>
          <div className="sidebar-metric">
            <span>Apply Queue</span>
            <strong>{preview?.items.filter((item) => item.status === "apply").length ?? 0}</strong>
          </div>
          <div className="sidebar-metric">
            <span>Selected</span>
            <strong>{selectedSummary?.projectName ?? "none"}</strong>
          </div>
          <div className="sidebar-metric">
            <span>Last Sync</span>
            <strong>{lastSyncAt ? formatWhen(lastSyncAt) : "pending"}</strong>
          </div>
        </section>
      </aside>

      <main className="main-stage">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local-first control surface</p>
            <h2>{tab === "sessions" ? "Session Queue" : tab === "providers" ? "Provider Wiring" : "Maintenance"}</h2>
          </div>
          <div className="toolbar">
            {tab === "sessions" && (
              <>
                <label className="search-box">
                  <span>Search</span>
                  <input
                    value={search}
                    onChange={(event) => {
                      const value = event.target.value;
                      startTransition(() => {
                        setSearch(value);
                      });
                    }}
                    placeholder="topic, project, message..."
                  />
                </label>
                <label className="toggle">
                  <input
                    checked={dirtyOnly}
                    onChange={(event) => setDirtyOnly(event.target.checked)}
                    type="checkbox"
                  />
                  Dirty only
                </label>
                <button className="ghost-button" onClick={() => void reloadSessions()} type="button">
                  Refresh
                </button>
              </>
            )}
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        {tab === "sessions" ? (
          <section className="sessions-grid">
            <div className="session-list">
              {loading ? <p className="loading-state">Loading sessions...</p> : null}
              {!loading && sessions.length === 0 ? (
                <div className="detail-card placeholder">
                  {error ? "API not ready yet. The dashboard will retry automatically." : "No sessions matched the current filter."}
                </div>
              ) : null}
              {sessions.map((session) => (
                <button
                  key={session.threadId}
                  className={selectedId === session.threadId ? "session-card active" : "session-card"}
                  onClick={() => setSelectedId(session.threadId)}
                  type="button"
                >
                  <div className="session-card-top">
                    <span className={`tone-dot ${toneForSession(session)}`} />
                    <span className="session-when">{formatWhen(session.updatedAt)}</span>
                    <span className="session-status">{session.statusEstimate ?? "unknown"}</span>
                  </div>
                  <h3>{session.officialName ?? session.candidateName ?? session.threadId}</h3>
                  <p>{session.candidateName ?? "No candidate yet"}</p>
                  <div className="session-meta">
                    <span>{session.projectName ?? "unknown project"}</span>
                    <span>{session.provider ?? "unknown provider"}</span>
                    <span>{session.taskCompleteCount} tasks</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="detail-panel">
              {detail ? (
                <>
                  <div className="detail-card hero">
                    <p className="eyebrow">Selected session</p>
                    <h3>{detail.officialName ?? detail.candidateName ?? detail.threadId}</h3>
                    <p className="detail-subtitle">{detail.candidateName ?? "No candidate staged"}</p>
                    <div className="pill-row">
                      {detail.dirty ? <span className="pill dirty">dirty</span> : <span className="pill clean">clean</span>}
                      {detail.frozen ? <span className="pill frozen">frozen</span> : null}
                      {detail.manualOverride ? <span className="pill manual">manual</span> : null}
                    </div>
                    <div className="action-row">
                      <button onClick={() => void runAction(() => suggestSession(detail.threadId))} type="button">
                        Suggest
                      </button>
                      <button onClick={() => void runAction(() => applySession(detail.threadId))} type="button">
                        Apply
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() => void runAction(() => freezeSession(detail.threadId, !detail.frozen))}
                        type="button"
                      >
                        {detail.frozen ? "Unfreeze" : "Freeze"}
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() =>
                          void runAction(() =>
                            toggleManualOverride(detail.threadId, !detail.manualOverride)
                          )
                        }
                        type="button"
                      >
                        {detail.manualOverride ? "Clear Manual" : "Manual Override"}
                      </button>
                    </div>
                  </div>

                  <div className="detail-card">
                    <h4>Signals</h4>
                    <dl className="signal-grid">
                      <div>
                        <dt>Project</dt>
                        <dd>{detail.projectName ?? "n/a"}</dd>
                      </div>
                      <div>
                        <dt>Provider</dt>
                        <dd>{detail.provider ?? "n/a"}</dd>
                      </div>
                      <div>
                        <dt>Model</dt>
                        <dd>{detail.model ?? "n/a"}</dd>
                      </div>
                      <div>
                        <dt>Tokens</dt>
                        <dd>{detail.tokenTotal}</dd>
                      </div>
                    </dl>
                    <div className="message-block">
                      <label>First user</label>
                      <p>{detail.firstUserMessage ?? "n/a"}</p>
                    </div>
                    <div className="message-block">
                      <label>Last user</label>
                      <p>{detail.lastUserMessage ?? "n/a"}</p>
                    </div>
                    <div className="message-block">
                      <label>Last agent</label>
                      <p>{detail.lastAgentMessage ?? "n/a"}</p>
                    </div>
                  </div>

                  <div className="detail-card">
                    <h4>Rename history</h4>
                    <div className="history-stack">
                      {(detail.renameHistory ?? []).slice(0, 6).map((entry, index) => (
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
                    </div>
                  </div>
                </>
              ) : (
                <div className="detail-card placeholder">{actioning ? "Loading session..." : "Select a session."}</div>
              )}
            </div>
          </section>
        ) : null}

        {tab === "providers" ? (
          <section className="panel-grid">
            <div className="detail-card">
              <h3>Resolved provider</h3>
              <pre>{JSON.stringify(providers?.resolvedProvider ?? {}, null, 2)}</pre>
            </div>
            <div className="detail-card">
              <h3>AI config</h3>
              <pre>{JSON.stringify(providers?.ai ?? {}, null, 2)}</pre>
            </div>
            <div className="detail-card">
              <h3>Inherited Codex</h3>
              <pre>{JSON.stringify(providers?.inheritedCodex ?? {}, null, 2)}</pre>
            </div>
          </section>
        ) : null}

        {tab === "maintenance" ? (
          <section className="panel-grid">
            <div className="detail-card">
              <h3>Doctor</h3>
              <pre>{JSON.stringify(doctor ?? {}, null, 2)}</pre>
            </div>
            <div className="detail-card">
              <h3>Auto rename preview</h3>
              <pre>{JSON.stringify(preview?.items ?? [], null, 2)}</pre>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
