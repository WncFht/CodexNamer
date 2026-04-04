import React from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import { useEffect, useState } from "react";

import { LocalApiClient } from "./api.js";
import { computeTerminalLayout, truncateDisplayText } from "./layout.js";
import type { BatchApplyResponse, SessionDetail, SessionSummary } from "./types.js";

type InputMode = "normal" | "search" | "rename";

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
  const [metrics, setMetrics] = useState(() => ({
    columns: stdout.columns ?? 120,
    rows: stdout.rows ?? 40
  }));

  useEffect(() => {
    const update = () => {
      setMetrics({
        columns: stdout.columns ?? 120,
        rows: stdout.rows ?? 40
      });
    };

    update();
    stdout.on("resize", update);
    return () => {
      if (typeof stdout.off === "function") {
        stdout.off("resize", update);
      } else {
        stdout.removeListener("resize", update);
      }
    };
  }, [stdout]);

  return metrics;
}

function LineValue(props: {
  label: string;
  value?: string;
  width: number;
  tone?: "muted" | "default" | "accent";
}) {
  const labelWidth = Math.min(14, Math.max(8, Math.floor(props.width * 0.24)));
  const valueWidth = Math.max(12, props.width - labelWidth - 2);

  return (
    <Box width={props.width} flexWrap="nowrap">
      <Box width={labelWidth}>
        <Text color={props.tone === "accent" ? "magenta" : "gray"}>{truncateDisplayText(props.label, labelWidth)}</Text>
      </Box>
      <Box width={valueWidth}>
        <Text color={props.tone === "muted" ? "gray" : undefined} wrap="truncate-end">
          {truncateDisplayText(props.value, valueWidth)}
        </Text>
      </Box>
    </Box>
  );
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
  const [client] = useState(() => new LocalApiClient(props.apiBase));
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dirtyOnly, setDirtyOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("normal");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Loading sessions...");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<BatchApplyResponse["items"]>([]);
  const metrics = useTerminalMetrics();
  const layout = computeTerminalLayout(metrics);

  const selected = sessions[selectedIndex];
  const visibleSessions = windowItemsAround(sessions, selectedIndex, layout.visibleSessionCount);

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
      setMessage(
        `Loaded ${payload.items.length} sessions (${payload.counts.dirty} dirty / ${payload.counts.frozen} frozen)`
      );
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

  useEffect(() => {
    void reloadSessions();
  }, [dirtyOnly, search]);

  useEffect(() => {
    void reloadDetail(selected?.threadId);
  }, [selected?.threadId]);

  const runAction = async (operation: () => Promise<unknown>, successMessage: string) => {
    if (!selected) {
      return;
    }

    setLoading(true);
    setError(null);
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
      const payload = await client.batchApplyDirty(true);
      setPreview(payload.items.slice(0, 12));
      setMessage(`Preview refreshed: ${payload.items.filter((item) => item.status === "apply").length} ready`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
    }
  };

  const listPanel = (
    <Box flexDirection="column" width={layout.listWidth}>
      <Box justifyContent="space-between" width={layout.listWidth}>
        <Text color="cyan">Sessions [{sessions.length}]</Text>
        <Text color="gray">
          {layout.mode} {layout.columns}x{layout.rows}
        </Text>
      </Box>
      <Box borderStyle="round" flexDirection="column" paddingX={1} width={layout.listWidth}>
        {sessions.length === 0 ? <Text color="gray">No sessions matched the current filter.</Text> : null}
        {visibleSessions.map(({ item, index }) => (
          <SessionRow
            key={`${index}-${item.threadId}`}
            session={item}
            active={index === selectedIndex}
            width={layout.listWidth - 2}
            compact={layout.compact}
          />
        ))}
      </Box>
    </Box>
  );

  const detailPanel = (
    <Box flexDirection="column" width={layout.detailWidth}>
      <Text color="cyan">Detail</Text>
      <Box borderStyle="round" flexDirection="column" paddingX={1} width={layout.detailWidth}>
        {detail ? (
          <>
            <Box width={layout.detailWidth - 2}>
              <Text color="yellow" wrap="truncate-end">
                {detail.officialName ?? detail.candidateName ?? detail.threadId}
              </Text>
            </Box>
            <LineValue label="project" value={detail.projectName ?? detail.cwd} width={layout.detailWidth - 2} />
            <LineValue
              label="provider"
              value={[detail.provider ?? "n/a", detail.model ?? "n/a"].join(" | ")}
              width={layout.detailWidth - 2}
            />
            <LineValue
              label="status"
              value={[formatWhen(detail.updatedAt), `${detail.tokenTotal} tokens`].join(" | ")}
              width={layout.detailWidth - 2}
              tone="muted"
            />
            <LineValue label="candidate" value={detail.candidateName} width={layout.detailWidth - 2} tone="accent" />
            <LineValue label="first" value={detail.firstUserMessage} width={layout.detailWidth - 2} />
            <LineValue label="last-user" value={detail.lastUserMessage} width={layout.detailWidth - 2} />
            <LineValue label="last-agent" value={detail.lastAgentMessage} width={layout.detailWidth - 2} />

            <Box marginTop={1} flexDirection="column" width={layout.detailWidth - 2}>
              <Text color="magenta">Recent rename history</Text>
              {(detail.renameHistory ?? []).slice(0, layout.compact ? 2 : 4).map((entry, index) => (
                <Box key={`${index}-${entry.appliedAt}-${entry.newName}`} width={layout.detailWidth - 2}>
                  <Text color="gray" wrap="truncate-end">
                    {`${entry.newName} | ${entry.kind}/${entry.source} | ${formatWhen(entry.appliedAt)}`}
                  </Text>
                </Box>
              ))}
              {(detail.renameHistory ?? []).length === 0 ? <Text color="gray">No rename history yet.</Text> : null}
            </Box>
          </>
        ) : (
          <Text color="gray">No session selected.</Text>
        )}
      </Box>
    </Box>
  );

  return (
    <Box flexDirection="column">
      {props.interactive ? (
        <InteractiveBindings
          client={client}
          detail={detail}
          inputMode={inputMode}
          reloadDetail={reloadDetail}
          reloadSessions={reloadSessions}
          renameDraftDefault={detail?.candidateName ?? detail?.officialName ?? ""}
          search={search}
          selected={selected}
          setDirtyOnly={setDirtyOnly}
          setError={setError}
          setInputMode={setInputMode}
          setLoading={setLoading}
          setMessage={setMessage}
          setPreview={setPreview}
          setRenameDraft={setRenameDraft}
          setSearchDraft={setSearchDraft}
          setSelectedIndex={setSelectedIndex}
          sessionsLength={sessions.length}
        />
      ) : null}

      <Box justifyContent="space-between">
        <Text color="yellow">Codex Session Manager TUI</Text>
        <Text color="gray">
          {dirtyOnly ? "dirty-only" : "all"} | api {props.apiBase}
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
              void runAction(
                () => client.rename(detail.threadId, nextName),
                `Renamed ${truncateDisplayText(detail.threadId, 12)}`
              );
            }}
          />
        </Box>
      ) : null}

      <Box marginTop={1} gap={2} flexDirection={layout.stacked ? "column" : "row"}>
        {listPanel}
        {detailPanel}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="cyan">Batch preview</Text>
        <Box borderStyle="round" flexDirection="column" paddingX={1}>
          {preview.length === 0 ? <Text color="gray">Press p to preview dirty auto-rename actions.</Text> : null}
          {preview.slice(0, layout.visiblePreviewCount).map((item, index) => (
            <PreviewRow key={`${index}-${item.threadId}`} item={item} width={layout.columns - 6} />
          ))}
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="gray" wrap="truncate-end">
          j/k move  d dirty  / search  r rename  s suggest  a apply  f freeze  m manual  p preview  A batch-apply  q quit
        </Text>
      </Box>
    </Box>
  );
}

function InteractiveBindings(props: {
  client: LocalApiClient;
  detail: SessionDetail | null;
  inputMode: InputMode;
  reloadDetail: (threadId: string | undefined) => Promise<void>;
  reloadSessions: (nextSelectedId?: string) => Promise<void>;
  renameDraftDefault: string;
  search: string;
  selected: SessionSummary | undefined;
  setDirtyOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setInputMode: React.Dispatch<React.SetStateAction<InputMode>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  setPreview: React.Dispatch<React.SetStateAction<BatchApplyResponse["items"]>>;
  setRenameDraft: React.Dispatch<React.SetStateAction<string>>;
  setSearchDraft: React.Dispatch<React.SetStateAction<string>>;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  sessionsLength: number;
}) {
  const { exit } = useApp();

  const runAction = async (operation: () => Promise<unknown>, successMessage: string) => {
    if (!props.selected) {
      return;
    }

    props.setLoading(true);
    props.setError(null);
    try {
      await operation();
      await props.reloadSessions(props.selected.threadId);
      await props.reloadDetail(props.selected.threadId);
      props.setMessage(successMessage);
    } catch (nextError) {
      props.setError(nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      props.setLoading(false);
    }
  };

  const refreshPreview = async () => {
    try {
      const payload = await props.client.batchApplyDirty(true);
      props.setPreview(payload.items.slice(0, 12));
      props.setMessage(`Preview refreshed: ${payload.items.filter((item) => item.status === "apply").length} ready`);
    } catch (nextError) {
      props.setError(nextError instanceof Error ? nextError.message : "Unknown error");
    }
  };

  useInput((input, key) => {
    if (props.inputMode === "search") {
      if (key.escape) {
        props.setSearchDraft(props.search);
        props.setInputMode("normal");
      }
      return;
    }

    if (props.inputMode === "rename") {
      if (key.escape) {
        props.setRenameDraft(props.renameDraftDefault);
        props.setInputMode("normal");
      }
      return;
    }

    if (key.upArrow || input === "k") {
      props.setSelectedIndex((value) => Math.max(0, value - 1));
      return;
    }

    if (key.downArrow || input === "j") {
      props.setSelectedIndex((value) => Math.min(Math.max(0, props.sessionsLength - 1), value + 1));
      return;
    }

    if (input === "g") {
      props.setSelectedIndex(0);
      return;
    }

    if (input === "G") {
      props.setSelectedIndex(Math.max(0, props.sessionsLength - 1));
      return;
    }

    if (input === "d") {
      props.setDirtyOnly((value) => !value);
      return;
    }

    if (input === "/") {
      props.setSearchDraft(props.search);
      props.setInputMode("search");
      return;
    }

    if (input === "r" && props.detail) {
      props.setRenameDraft(props.renameDraftDefault);
      props.setInputMode("rename");
      return;
    }

    if (input === "s" && props.selected) {
      const selected = props.selected;
      void runAction(
        () => props.client.suggest(selected.threadId),
        `Suggested ${truncateDisplayText(selected.threadId, 12)}`
      );
      return;
    }

    if (input === "a" && props.selected) {
      const selected = props.selected;
      void runAction(
        () => props.client.apply(selected.threadId),
        `Applied ${truncateDisplayText(selected.threadId, 12)}`
      );
      return;
    }

    if (input === "f" && props.detail) {
      const detail = props.detail;
      void runAction(
        () => props.client.freeze(detail.threadId, !detail.frozen),
        `${detail.frozen ? "Unfroze" : "Froze"} ${truncateDisplayText(detail.threadId, 12)}`
      );
      return;
    }

    if (input === "m" && props.detail) {
      const detail = props.detail;
      void runAction(
        () => props.client.setManualOverride(detail.threadId, !detail.manualOverride),
        `${detail.manualOverride ? "Cleared manual override for" : "Enabled manual override for"} ${truncateDisplayText(detail.threadId, 12)}`
      );
      return;
    }

    if (input === "p") {
      void refreshPreview();
      return;
    }

    if (input === "A") {
      props.setLoading(true);
      props.setError(null);
      void props.client
        .batchApplyDirty(false)
        .then(async (payload) => {
          props.setPreview(payload.items.slice(0, 12));
          props.setMessage(
            `Batch apply finished: ${payload.items.filter((item) => item.status === "apply").length} applied candidates`
          );
          await props.reloadSessions(props.selected?.threadId);
          await props.reloadDetail(props.selected?.threadId);
        })
        .catch((nextError) => {
          props.setError(nextError instanceof Error ? nextError.message : "Unknown error");
        })
        .finally(() => {
          props.setLoading(false);
        });
      return;
    }

    if (input === "q" || key.escape) {
      exit();
    }
  });

  return null;
}
