import type { ReactNode } from "react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { fetchSessionTranscript } from "./api.js";
import { formatWhen, transcriptTone } from "./browser-utils.js";
import { t, transcriptRoleLabel, type UiLanguage } from "./i18n.js";
import type { SessionDetail, SessionTranscriptPage } from "./types.js";

type TranscriptRoleFilter = "all" | "user" | "assistant" | "tool" | "system";

const TRANSCRIPT_PAGE_SIZE = 30;

function highlightContent(content: string, query: string) {
  if (!query) {
    return [content];
  }

  const normalizedContent = content.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const fragments: Array<string | ReactNode> = [];
  let cursor = 0;

  while (cursor < content.length) {
    const matchAt = normalizedContent.indexOf(normalizedQuery, cursor);
    if (matchAt === -1) {
      fragments.push(content.slice(cursor));
      break;
    }
    if (matchAt > cursor) {
      fragments.push(content.slice(cursor, matchAt));
    }
    fragments.push(
      <mark className="transcript-highlight" key={`${matchAt}-${normalizedQuery}`}>
        {content.slice(matchAt, matchAt + normalizedQuery.length)}
      </mark>
    );
    cursor = matchAt + normalizedQuery.length;
  }

  return fragments;
}

export function TranscriptPanel(props: {
  detail: SessionDetail;
  showHiddenTranscript: boolean;
  onToggleShowHiddenTranscript: (value: boolean) => void;
  uiLanguage: UiLanguage;
}) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<TranscriptRoleFilter>("all");
  const [pageState, setPageState] = useState<SessionTranscriptPage | null>(null);
  const [items, setItems] = useState<SessionTranscriptPage["items"]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query.trim());

  useEffect(() => {
    setQuery("");
    setRole("all");
  }, [props.detail.threadId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void fetchSessionTranscript(props.detail.threadId, {
      page: 1,
      pageSize: TRANSCRIPT_PAGE_SIZE,
      includeHidden: props.showHiddenTranscript,
      role,
      query: deferredQuery || undefined
    })
      .then((payload) => {
        if (!active) {
          return;
        }
        setPageState(payload);
        setItems(payload.items);
      })
      .catch((nextError) => {
        if (!active) {
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "Failed to load transcript");
        setPageState(null);
        setItems([]);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [deferredQuery, props.detail.threadId, props.showHiddenTranscript, role]);

  const loadEarlier = async () => {
    if (!pageState?.hasMore || loading) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextPage = await fetchSessionTranscript(props.detail.threadId, {
        page: pageState.page + 1,
        pageSize: pageState.pageSize,
        includeHidden: props.showHiddenTranscript,
        role,
        query: deferredQuery || undefined
      });
      setItems((previous) => [...nextPage.items, ...previous]);
      setPageState(nextPage);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load transcript");
    } finally {
      setLoading(false);
    }
  };

  const totalShown = items.length;
  const hiddenOlderCount = Math.max(0, (pageState?.totalItems ?? 0) - totalShown);

  const renderedItems = useMemo(() => items, [items]);
  const tt = (key: Parameters<typeof t>[1]) => t(props.uiLanguage, key);

  return (
    <section className="chat-view-shell">
      <div className="chat-toolbar">
        <div className="chat-toolbar-copy">
          <p className="panel-kicker">{tt("transcript")}</p>
          <label className="chat-search">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tt("searchConversation")}
            />
          </label>
        </div>
        <div className="chat-toolbar-actions">
          {(["all", "user", "assistant", "tool", "system"] as const).map((item) => (
            <button
              className={role === item ? "btn-chip active" : "btn-chip"}
              key={item}
              onClick={() => setRole(item)}
              type="button"
            >
              {transcriptRoleLabel(item, props.uiLanguage)}
            </button>
          ))}
          <label className="toggle compact">
            <input
              checked={props.showHiddenTranscript}
              onChange={(event) => props.onToggleShowHiddenTranscript(event.target.checked)}
              type="checkbox"
            />
            {tt("showHidden")}
          </label>
        </div>
      </div>

      <div className="chat-meta-strip">
        <span>{pageState?.counts.visible ?? 0} {tt("visibleCount")}</span>
        <span>{pageState?.counts.hidden ?? 0} {tt("hiddenCount")}</span>
        <span>{pageState?.counts.tools ?? 0} {tt("toolEvents")}</span>
        <span>{pageState?.totalItems ?? 0} {tt("matched")}</span>
      </div>

      <div className="chat-messages">
        {pageState?.hasMore ? (
          <div className="load-more">
            <button className="btn-sm" onClick={() => void loadEarlier()} type="button">
              {loading ? tt("loading") : `${tt("loadEarlierMessages")} (${Math.min(hiddenOlderCount, pageState.pageSize)})`}
            </button>
          </div>
        ) : null}

        {error ? <div className="error-banner transcript-error">{error}</div> : null}
        {!loading && renderedItems.length === 0 ? (
          <div className="empty-note">{tt("noTranscript")}</div>
        ) : null}

        <div className="messages-container">
          {renderedItems.map((item) => (
            <article className="message-turn" data-role={item.role} key={item.id}>
              <div className="turn-header">
                <div className="turn-header-left">
                  <span className={`message-role ${transcriptTone(item.role)}`}>{transcriptRoleLabel(item.role, props.uiLanguage)}</span>
                  <span className="kind-pill">{item.kind}</span>
                  {item.name ? <span className="kind-pill">{item.name}</span> : null}
                  {item.hiddenReason ? <span className="kind-pill subtle">{item.hiddenReason}</span> : null}
                </div>
                <span className="message-time">{formatWhen(item.timestamp, props.uiLanguage)}</span>
              </div>
              <pre className="turn-body">{highlightContent(item.content, deferredQuery)}</pre>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
