import React from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import { useEffect, useMemo, useState } from "react";

import { LocalApiClient } from "./api.js";
import { computeTerminalLayout, truncateDisplayText } from "./layout.js";
import type {
  BatchApplyResponse,
  SessionDetail,
  SessionSummary,
  SessionTranscriptEntry,
  SessionTranscriptPage
} from "./types.js";

type InputMode = "normal" | "search" | "rename";
type FocusPane = "sessions" | "transcript";
type TranscriptRoleFilter = "all" | "user" | "assistant" | "tool" | "system";

const TRANSCRIPT_PAGE_SIZE = 18;

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

function compactWhitespace(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function windowItemsAround<T>(items: T[], selectedIndex: number, maxItems: number): Array<{ item: T; index: number }> {
  if (items.length === 0 || maxItems <= 0) {
    return [];
  }

  if (items.length <= maxItems) {
    return items.map((item, index) => ({ item, index }));
  }

  const half = Math.floor(maxItems / 2);
  let start = Math.max(0, selectedIndex - half);
  let end = Math.min(items.length, start + maxItems);
  start = Math.max(0, end - maxItems);

  return items.slice(start, end).map((item, offset) => ({
    item,
    index: start + offset
  }));
}

function useTerminalMetrics() {
  const { stdout } = useStdout();
  const readMetrics = () => ({
    columns: process.stdout.columns ?? stdout.columns ?? 120,
    rows: process.stdout.rows ?? stdout.rows ?? 40
  });
  const [metrics, setMetrics] = useState(readMetrics);

  useEffect(() => {
    const update = () => {
      setMetrics(readMetrics());
    };

    update();
    stdout.on("resize", update);
    process.stdout.on("resize", update);
    process.on("SIGWINCH", update);

    return () => {
      if (typeof stdout.off === "function") {
        stdout.off("resize", update);
      } else {
        stdout.removeListener("resize", update);
      }
      if (typeof process.stdout.off === "function") {
        process.stdout.off("resize", update);
      } else {
        process.stdout.removeListener("resize", update);
      }
      process.off("SIGWINCH", update);
    };
  }, [stdout]);

  return metrics;
}

function roleColor(role: SessionTranscriptEntry["role"]): "cyan" | "green" | "yellow" | "gray" {
  if (role === "user") {
    return "cyan";
  }
  if (role === "assistant") {
    return "green";
  }
  if (role === "tool") {
    return "yellow";
  }
  return "gray";
}

function SessionRow(props: {
  session: SessionSummary;
  active: boolean;
  width: number;
  compact: boolean;
}) {
  const title = props.session.officialName ?? props.session.candidateName ?? props.session.threadId;
  const meta = [
    props.session.projectName ?? "unknown",
    props.session.provider ?? "n/a",
    props.session.dirty ? "dirty" : "clean",
    props.session.frozen ? "frozen" : null,
    props.session.manualOverride ? "manual" : null
  ]
    .filter(Boolean)
    .join(" | ");
  const secondary = [formatWhen(props.session.updatedAt), `${props.session.taskCompleteCount}t`, props.session.statusEstimate ?? "unknown"]
    .filter(Boolean)
    .join(" | ");

  return (
    <Box flexDirection="column" width={props.width} marginBottom={props.compact ? 0 : 1}>
      <Box width={props.width} flexWrap="nowrap">
        <Box width={2}>
          <Text inverse={props.active} color={props.active ? "black" : undefined}>
            {props.active ? ">" : " "}
          </Text>
        </Box>
        <Box width={props.width - 2}>
          <Text inverse={props.active} color={props.active ? "black" : undefined} wrap="truncate-end">
            {title}
          </Text>
        </Box>
      </Box>
      <Box width={props.width} paddingLeft={2}>
        <Text color={props.active ? "yellow" : "gray"} wrap="truncate-end">
          {props.compact ? secondary : meta}
        </Text>
      </Box>
      {!props.compact ? (
        <Box width={props.width} paddingLeft={2}>
          <Text color="gray" wrap="truncate-end">
            {secondary}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function TranscriptRow(props: {
  entry: SessionTranscriptEntry;
  active: boolean;
  width: number;
  compact: boolean;
}) {
  const header = [
    props.entry.role,
    props.entry.kind,
    props.entry.name ?? props.entry.phase ?? props.entry.hiddenReason ?? null
  ]
    .filter(Boolean)
    .join(" · ");
  const content = compactWhitespace(props.entry.content) || "(empty)";

  return (
    <Box flexDirection="column" width={props.width} marginBottom={props.compact ? 0 : 1}>
      {props.compact ? (
        <Box width={props.width}>
          <Text color={roleColor(props.entry.role)} inverse={props.active} wrap="truncate-end">
            {truncateDisplayText(`[${props.entry.role}] ${content}`, props.width)}
          </Text>
        </Box>
      ) : (
        <>
          <Box justifyContent="space-between" width={props.width}>
            <Text color={roleColor(props.entry.role)} inverse={props.active}>
              {truncateDisplayText(header, Math.max(12, props.width - 15))}
            </Text>
            <Text color="gray" inverse={props.active}>
              {truncateDisplayText(formatWhen(props.entry.timestamp), 12, "")}
            </Text>
          </Box>
          <Box width={props.width}>
            <Text color={props.active ? "white" : undefined} inverse={props.active} wrap="truncate-end">
              {truncateDisplayText(content, props.width)}
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
}

function PreviewRow(props: { item: BatchApplyResponse["items"][number]; width: number }) {
  const tone = props.item.status === "apply" ? "green" : "gray";
  const content = `${truncateDisplayText(props.item.threadId, 12)} | ${props.item.status} | ${
    props.item.candidateName ?? props.item.reason
  }`;
  return (
    <Box width={props.width}>
      <Text color={tone} wrap="truncate-end">
        {content}
      </Text>
    </Box>
  );
}

export function App(props: { apiBase: string; interactive: boolean }) {
  const { exit } = useApp();
  const [client] = useState(() => new LocalApiClient(props.apiBase));
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dirtyOnly, setDirtyOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("normal");
  const [focusPane, setFocusPane] = useState<FocusPane>("sessions");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Loading sessions...");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<BatchApplyResponse["items"]>([]);
  const [transcriptPage, setTranscriptPage] = useState<SessionTranscriptPage | null>(null);
  const [transcriptItems, setTranscriptItems] = useState<SessionTranscriptEntry[]>([]);
  const [transcriptIndex, setTranscriptIndex] = useState(0);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [showHiddenTranscript, setShowHiddenTranscript] = useState(false);
  const [transcriptRole, setTranscriptRole] = useState<TranscriptRoleFilter>("all");
  const metrics = useTerminalMetrics();
  const layout = computeTerminalLayout(metrics);

  const selected = sessions[selectedIndex];
  const visibleSessions = windowItemsAround(sessions, selectedIndex, layout.visibleSessionCount);
  const visibleTranscriptCount = Math.max(
    3,
    Math.floor(Math.max(6, layout.detailHeight - (layout.compact ? 12 : 16)) / (layout.compact ? 2 : 3))
  );
  const visibleTranscript = windowItemsAround(transcriptItems, transcriptIndex, visibleTranscriptCount);

  const requestExit = () => {
    exit();
    const timer = setTimeout(() => {
      process.exit(0);
    }, 20);
    timer.unref?.();
  };

  const reloadSessions = async (nextSelectedId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await client.listSessions({
        dirtyOnly,
        search,
        limit: 80
      });
      setSessions(payload.items);
      const nextIndex = nextSelectedId
        ? payload.items.findIndex((item) => item.threadId === nextSelectedId)
        : selected
          ? payload.items.findIndex((item) => item.threadId === selected.threadId)
          : 0;
      setSelectedIndex(nextIndex >= 0 ? nextIndex : 0);
      setMessage(`Loaded ${payload.items.length} sessions (${payload.counts.dirty} dirty / ${payload.counts.frozen} frozen)`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
      setSessions([]);
      setSelectedIndex(0);
    } finally {
      setLoading(false);
    }
  };

  const reloadDetail = async (threadId: string | undefined) => {
    if (!threadId) {
      setDetail(null);
      return;
    }

    try {
      const payload = await client.getSession(threadId);
      setDetail(payload);
      setRenameDraft(payload.candidateName ?? payload.officialName ?? "");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
      setDetail(null);
    }
  };

  const reloadTranscript = async (threadId: string | undefined) => {
    if (!threadId) {
      setTranscriptPage(null);
      setTranscriptItems([]);
      setTranscriptIndex(0);
      return;
    }

    setTranscriptLoading(true);
    setTranscriptError(null);
    try {
      const payload = await client.getSessionTranscript(threadId, {
        page: 1,
        pageSize: TRANSCRIPT_PAGE_SIZE,
        includeHidden: showHiddenTranscript,
        role: transcriptRole
      });
      setTranscriptPage(payload);
      setTranscriptItems(payload.items);
      setTranscriptIndex(Math.max(0, payload.items.length - 1));
    } catch (nextError) {
      setTranscriptError(nextError instanceof Error ? nextError.message : "Unknown error");
      setTranscriptPage(null);
      setTranscriptItems([]);
      setTranscriptIndex(0);
    } finally {
      setTranscriptLoading(false);
    }
  };

  const loadOlderTranscript = async () => {
    if (!selected?.threadId || !transcriptPage?.hasMore || transcriptLoading) {
      return;
    }

    setTranscriptLoading(true);
    setTranscriptError(null);
    try {
      const payload = await client.getSessionTranscript(selected.threadId, {
        page: transcriptPage.page + 1,
        pageSize: transcriptPage.pageSize,
        includeHidden: showHiddenTranscript,
        role: transcriptRole
      });
      setTranscriptItems((previous) => [...payload.items, ...previous]);
      setTranscriptPage(payload);
      setTranscriptIndex((previous) => previous + payload.items.length);
      setMessage(`Loaded ${payload.items.length} earlier transcript events`);
    } catch (nextError) {
      setTranscriptError(nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setTranscriptLoading(false);
    }
  };

  const runAction = async (operation: () => Promise<unknown>, successMessage: string) => {
    if (!selected) {
      return;
    }

    setLoading(true);
    setError(null);
    setMessage("Running action...");
    try {
      await operation();
      await reloadSessions(selected.threadId);
      await reloadDetail(selected.threadId);
      setMessage(successMessage);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const refreshPreview = async () => {
    try {
      setMessage("Refreshing preview...");
      const payload = await client.batchApplyDirty(true);
      setPreview(payload.items.slice(0, 12));
      setMessage(`Preview refreshed: ${payload.items.filter((item) => item.status === "apply").length} ready`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
    }
  };

  useEffect(() => {
    void reloadSessions();
  }, [dirtyOnly, search]);

  useEffect(() => {
    void reloadDetail(selected?.threadId);
  }, [selected?.threadId]);

  useEffect(() => {
    void reloadTranscript(selected?.threadId);
  }, [selected?.threadId, showHiddenTranscript, transcriptRole]);

  useInput((input, key) => {
    if (!props.interactive) {
      return;
    }

    if (inputMode === "search") {
      if (key.escape) {
        setSearchDraft(search);
        setInputMode("normal");
      }
      return;
    }

    if (inputMode === "rename") {
      if (key.escape) {
        setRenameDraft(detail?.candidateName ?? detail?.officialName ?? "");
        setInputMode("normal");
      }
      return;
    }

    if ((key.ctrl && input === "c") || input === "q") {
      requestExit();
      return;
    }

    if (key.escape) {
      requestExit();
      return;
    }

    if (key.tab) {
      setFocusPane((current) => (current === "sessions" ? "transcript" : "sessions"));
      return;
    }

    if (input === "d") {
      setDirtyOnly((value) => !value);
      return;
    }

    if (input === "/") {
      setSearchDraft(search);
      setInputMode("search");
      return;
    }

    if (input === "r" && detail) {
      setRenameDraft(detail.candidateName ?? detail.officialName ?? "");
      setInputMode("rename");
      return;
    }

    if (input === "h") {
      setShowHiddenTranscript((value) => !value);
      return;
    }

    if (input === "1") {
      setTranscriptRole("all");
      return;
    }
    if (input === "2") {
      setTranscriptRole("user");
      return;
    }
    if (input === "3") {
      setTranscriptRole("assistant");
      return;
    }
    if (input === "4") {
      setTranscriptRole("tool");
      return;
    }
    if (input === "5") {
      setTranscriptRole("system");
      return;
    }

    if (input === "o") {
      void loadOlderTranscript();
      return;
    }

    if (key.upArrow || input === "k") {
      if (focusPane === "sessions") {
        setSelectedIndex((value) => Math.max(0, value - 1));
      } else {
        if (transcriptIndex <= 0 && transcriptPage?.hasMore) {
          void loadOlderTranscript();
        } else {
          setTranscriptIndex((value) => Math.max(0, value - 1));
        }
      }
      return;
    }

    if (key.downArrow || input === "j") {
      if (focusPane === "sessions") {
        setSelectedIndex((value) => Math.min(Math.max(0, sessions.length - 1), value + 1));
      } else {
        setTranscriptIndex((value) => Math.min(Math.max(0, transcriptItems.length - 1), value + 1));
      }
      return;
    }

    if (input === "g") {
      if (focusPane === "sessions") {
        setSelectedIndex(0);
      } else {
        setTranscriptIndex(0);
      }
      return;
    }

    if (input === "G") {
      if (focusPane === "sessions") {
        setSelectedIndex(Math.max(0, sessions.length - 1));
      } else {
        setTranscriptIndex(Math.max(0, transcriptItems.length - 1));
      }
      return;
    }

    if (input === "s" && selected) {
      void runAction(() => client.suggest(selected.threadId), `Suggested ${truncateDisplayText(selected.threadId, 12)}`);
      return;
    }

    if (input === "a" && selected) {
      void runAction(() => client.apply(selected.threadId), `Applied ${truncateDisplayText(selected.threadId, 12)}`);
      return;
    }

    if (input === "f" && detail) {
      void runAction(
        () => client.freeze(detail.threadId, !detail.frozen),
        `${detail.frozen ? "Unfroze" : "Froze"} ${truncateDisplayText(detail.threadId, 12)}`
      );
      return;
    }

    if (input === "m" && detail) {
      void runAction(
        () => client.setManualOverride(detail.threadId, !detail.manualOverride),
        `${detail.manualOverride ? "Cleared manual override for" : "Enabled manual override for"} ${truncateDisplayText(detail.threadId, 12)}`
      );
      return;
    }

    if (input === "p") {
      void refreshPreview();
      return;
    }

    if (input === "A") {
      setLoading(true);
      setError(null);
      setMessage("Applying batch rename...");
      void client
        .batchApplyDirty(false)
        .then(async (payload) => {
          setPreview(payload.items.slice(0, 12));
          setMessage(`Batch apply finished: ${payload.items.filter((item) => item.status === "apply").length} applied candidates`);
          await reloadSessions(selected?.threadId);
          await reloadDetail(selected?.threadId);
        })
        .catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : "Unknown error");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  });

  const transcriptSummary = useMemo(() => {
    if (!transcriptPage) {
      return "Transcript not loaded";
    }
    return `${transcriptItems.length}/${transcriptPage.totalItems} loaded · ${transcriptRole} · ${showHiddenTranscript ? "hidden:on" : "hidden:off"}`;
  }, [showHiddenTranscript, transcriptItems.length, transcriptPage, transcriptRole]);

  const selectedTranscript = transcriptItems[transcriptIndex];
  const detailTitle = detail ? detail.officialName ?? detail.candidateName ?? detail.threadId : "No session selected";

  const listPanel = (
    <Box flexDirection="column" width={layout.listWidth} height={layout.listHeight}>
      <Box justifyContent="space-between" width={layout.listWidth}>
        <Text color={focusPane === "sessions" ? "cyan" : "gray"}>Sessions [{sessions.length}]</Text>
        <Text color="gray">
          {layout.mode} {layout.columns}x{layout.rows}
        </Text>
      </Box>
      <Box
        borderStyle="round"
        flexDirection="column"
        paddingX={1}
        width={layout.listWidth}
        height={Math.max(4, layout.listHeight - 1)}
        overflow="hidden"
      >
        {sessions.length === 0 ? <Text color="gray">No sessions matched the current filter.</Text> : null}
        {visibleSessions.map(({ item, index }) => (
          <SessionRow
            key={`${index}-${item.threadId}`}
            session={item}
            active={focusPane === "sessions" && index === selectedIndex}
            width={layout.listInnerWidth}
            compact={layout.compact}
          />
        ))}
      </Box>
    </Box>
  );

  const detailPanel = (
    <Box flexDirection="column" width={layout.detailWidth} height={layout.detailHeight}>
      <Box justifyContent="space-between" width={layout.detailWidth}>
        <Text color={focusPane === "transcript" ? "cyan" : "gray"}>Transcript</Text>
        <Text color="gray">{transcriptSummary}</Text>
      </Box>
      <Box
        borderStyle="round"
        flexDirection="column"
        paddingX={1}
        width={layout.detailWidth}
        height={Math.max(4, layout.detailHeight - 1)}
        overflow="hidden"
      >
        {layout.compact ? (
          <>
            <Box width={layout.detailInnerWidth}>
              <Text color="yellow" wrap="truncate-end">
                {truncateDisplayText(detailTitle, layout.detailInnerWidth)}
              </Text>
            </Box>
            <Box width={layout.detailInnerWidth}>
              <Text color="magenta" wrap="truncate-end">
                {detail?.candidateName
                  ? `candidate: ${truncateDisplayText(detail.candidateName, Math.max(12, layout.detailInnerWidth - 11))}`
                  : "candidate: n/a"}
              </Text>
            </Box>
            {transcriptError ? (
              <Box width={layout.detailInnerWidth}>
                <Text color="red" wrap="truncate-end">
                  {transcriptError}
                </Text>
              </Box>
            ) : null}
            {visibleTranscript.length === 0 && !transcriptLoading ? (
              <Box width={layout.detailInnerWidth}>
                <Text color="gray">No transcript events matched the current filter.</Text>
              </Box>
            ) : null}
            {visibleTranscript.map(({ item, index }) => (
              <TranscriptRow
                key={`${index}-${item.id}`}
                entry={item}
                active={focusPane === "transcript" && index === transcriptIndex}
                width={layout.detailInnerWidth}
                compact
              />
            ))}
            <Box width={layout.detailInnerWidth}>
              <Text color="gray" wrap="truncate-end">
                {selectedTranscript
                  ? `${selectedTranscript.role}/${selectedTranscript.kind} · ${formatWhen(selectedTranscript.timestamp)}`
                  : transcriptPage?.hasMore
                    ? "Press o to load earlier transcript events."
                    : "No more transcript events."}
              </Text>
            </Box>
          </>
        ) : (
          <>
            <Box width={layout.detailInnerWidth}>
              <Text color="yellow" wrap="truncate-end">
                {truncateDisplayText(detailTitle, layout.detailInnerWidth)}
              </Text>
            </Box>
            <Box width={layout.detailInnerWidth}>
              <Text color="gray" wrap="truncate-end">
                {truncateDisplayText(
                  [detail?.projectName ?? detail?.cwd ?? "n/a", detail?.provider ?? "n/a", detail?.model ?? "n/a"].join(" | "),
                  layout.detailInnerWidth
                )}
              </Text>
            </Box>
            <Box width={layout.detailInnerWidth}>
              <Text color="gray" wrap="truncate-end">
                {truncateDisplayText(
                  [`updated ${formatWhen(detail?.updatedAt)}`, `${detail?.tokenTotal ?? 0} tokens`, detail?.dirty ? "dirty" : "clean", detail?.frozen ? "frozen" : null, detail?.manualOverride ? "manual" : null]
                    .filter(Boolean)
                    .join(" | "),
                  layout.detailInnerWidth
                )}
              </Text>
            </Box>
            <Box marginTop={1} width={layout.detailInnerWidth}>
              <Text color="magenta" wrap="truncate-end">
                {detail?.candidateName
                  ? `candidate: ${truncateDisplayText(detail.candidateName, Math.max(12, layout.detailInnerWidth - 11))}`
                  : "candidate: n/a"}
              </Text>
            </Box>

            <Box marginTop={1} width={layout.detailInnerWidth}>
              <Text color="cyan">{transcriptLoading ? "Loading transcript..." : "Conversation"}</Text>
            </Box>
            {transcriptError ? (
              <Box width={layout.detailInnerWidth}>
                <Text color="red" wrap="truncate-end">
                  {transcriptError}
                </Text>
              </Box>
            ) : null}
            {visibleTranscript.length === 0 && !transcriptLoading ? (
              <Box width={layout.detailInnerWidth}>
                <Text color="gray">No transcript events matched the current filter.</Text>
              </Box>
            ) : null}
            {visibleTranscript.map(({ item, index }) => (
              <TranscriptRow
                key={`${index}-${item.id}`}
                entry={item}
                active={focusPane === "transcript" && index === transcriptIndex}
                width={layout.detailInnerWidth}
                compact={false}
              />
            ))}
            <Box marginTop={1} width={layout.detailInnerWidth}>
              <Text color="gray" wrap="truncate-end">
                {selectedTranscript
                  ? `selected: ${selectedTranscript.role}/${selectedTranscript.kind} · ${formatWhen(selectedTranscript.timestamp)}`
                  : transcriptPage?.hasMore
                    ? "Press o to load earlier transcript events."
                    : "No more transcript events."}
              </Text>
            </Box>
            <Box width={layout.detailInnerWidth}>
              <Text color="gray" wrap="truncate-end">
                {detail?.renameHistory?.[0]
                  ? `rename: ${truncateDisplayText(
                      `${detail.renameHistory[0].newName} | ${detail.renameHistory[0].kind}/${detail.renameHistory[0].source} | ${formatWhen(detail.renameHistory[0].appliedAt)}`,
                      layout.detailInnerWidth
                    )}`
                  : "rename: no history"}
              </Text>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <Box flexDirection="column" width={layout.columns}>
      <Box justifyContent="space-between">
        <Text color="yellow">Codex Session Manager TUI</Text>
        <Text color="gray">
          {dirtyOnly ? "dirty-only" : "all"} | focus {focusPane} | api {props.apiBase}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={error ? "red" : "green"}>{error ?? message}</Text>
      </Box>

      {!props.interactive ? (
        <Box marginTop={1}>
          <Text color="yellow">Input disabled: current stdin does not support raw mode.</Text>
        </Box>
      ) : null}

      {inputMode === "search" ? (
        <Box marginTop={1}>
          <Text color="cyan">Search: </Text>
          <TextInput
            value={searchDraft}
            onChange={setSearchDraft}
            onSubmit={(value) => {
              setSearch(value.trim());
              setInputMode("normal");
            }}
          />
        </Box>
      ) : null}

      {inputMode === "rename" ? (
        <Box marginTop={1}>
          <Text color="magenta">Rename: </Text>
          <TextInput
            value={renameDraft}
            onChange={setRenameDraft}
            onSubmit={(value) => {
              const nextName = value.trim();
              setInputMode("normal");
              if (!detail || !nextName) {
                return;
              }
              void runAction(() => client.rename(detail.threadId, nextName), `Renamed ${truncateDisplayText(detail.threadId, 12)}`);
            }}
          />
        </Box>
      ) : null}

      <Box marginTop={1} gap={1} flexDirection={layout.stacked ? "column" : "row"} height={layout.topSectionHeight}>
        {listPanel}
        {detailPanel}
      </Box>

      <Box marginTop={1} flexDirection="column" height={layout.previewHeight}>
        <Text color="cyan">Batch preview</Text>
        <Box borderStyle="round" flexDirection="column" paddingX={1} height={Math.max(4, layout.previewHeight - 1)} overflow="hidden">
          {preview.length === 0 ? <Text color="gray">Press p to preview dirty auto-rename actions.</Text> : null}
          {preview.slice(0, layout.visiblePreviewCount).map((item, index) => (
            <PreviewRow key={`${index}-${item.threadId}`} item={item} width={layout.previewInnerWidth} />
          ))}
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="gray" wrap="truncate-end">
          tab switch-pane  j/k move  o older  h hidden  1-5 role  d dirty  / search  r rename  s suggest  a apply  f freeze  m manual  p preview  A batch-apply  q quit
        </Text>
      </Box>
    </Box>
  );
}
