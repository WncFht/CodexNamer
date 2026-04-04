import React from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { useEffect, useState } from "react";

import { LocalApiClient } from "./api.js";
import type { BatchApplyResponse, SessionDetail, SessionSummary } from "./types.js";

type InputMode = "normal" | "search" | "rename";

function clip(value: string | undefined, maxLength: number): string {
  if (!value) {
    return "n/a";
  }
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

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

  const selected = sessions[selectedIndex];

  const reloadSessions = async (nextSelectedId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await client.listSessions({
        dirtyOnly,
        search,
        limit: 40
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
      setPreview(payload.items.slice(0, 8));
      setMessage(`Preview refreshed: ${payload.items.filter((item) => item.status === "apply").length} ready`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unknown error");
    }
  };

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
              void runAction(() => client.rename(detail.threadId, nextName), `Renamed ${clip(detail.threadId, 12)}`);
            }}
          />
        </Box>
      ) : null}

      <Box marginTop={1} gap={2}>
        <Box flexDirection="column" width="58%">
          <Text color="cyan">
            Sessions {loading ? "(loading)" : ""} [{sessions.length}]
          </Text>
          <Box borderStyle="round" flexDirection="column" paddingX={1}>
            {sessions.length === 0 ? <Text color="gray">No sessions matched the current filter.</Text> : null}
            {sessions.map((session, index) => {
              const active = index === selectedIndex;
              const label = session.officialName ?? session.candidateName ?? session.threadId;
              const flags = [
                session.dirty ? "dirty" : "clean",
                session.frozen ? "frozen" : null,
                session.manualOverride ? "manual" : null
              ]
                .filter(Boolean)
                .join("/");
              return (
                <Box key={`${index}-${session.threadId}`} justifyContent="space-between">
                  <Text inverse={active}>
                    {active ? ">" : " "} {clip(label, 44)}
                  </Text>
                  <Text color={active ? "yellow" : "gray"}>
                    {clip(session.projectName, 16)} | {flags} | {session.taskCompleteCount}t
                  </Text>
                </Box>
              );
            })}
          </Box>
        </Box>

        <Box flexDirection="column" width="42%">
          <Text color="cyan">Detail</Text>
          <Box borderStyle="round" flexDirection="column" paddingX={1}>
            {detail ? (
              <>
                <Text color="yellow">{clip(detail.officialName ?? detail.candidateName ?? detail.threadId, 54)}</Text>
                <Text color="gray">
                  {detail.projectName ?? "n/a"} | {detail.provider ?? "n/a"} | {detail.model ?? "n/a"}
                </Text>
                <Text color="gray">
                  updated {formatWhen(detail.updatedAt)} | tokens {detail.tokenTotal}
                </Text>
                <Text>candidate: {clip(detail.candidateName, 56)}</Text>
                <Text>first: {clip(detail.firstUserMessage, 56)}</Text>
                <Text>last user: {clip(detail.lastUserMessage, 52)}</Text>
                <Text>last agent: {clip(detail.lastAgentMessage, 51)}</Text>
                <Box marginTop={1} flexDirection="column">
                  <Text color="magenta">Recent rename history</Text>
                  {(detail.renameHistory ?? []).slice(0, 4).map((entry, index) => (
                    <Text key={`${index}-${entry.appliedAt}-${entry.newName}`} color="gray">
                      {clip(entry.newName, 40)} | {entry.kind}/{entry.source} | {formatWhen(entry.appliedAt)}
                    </Text>
                  ))}
                  {(detail.renameHistory ?? []).length === 0 ? (
                    <Text color="gray">No rename history yet.</Text>
                  ) : null}
                </Box>
              </>
            ) : (
              <Text color="gray">No session selected.</Text>
            )}
          </Box>
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="cyan">Batch preview</Text>
        <Box borderStyle="round" flexDirection="column" paddingX={1}>
          {preview.length === 0 ? <Text color="gray">Press p to preview dirty auto-rename actions.</Text> : null}
          {preview.map((item, index) => (
            <Text key={`${index}-${item.threadId}`} color={item.status === "apply" ? "green" : "gray"}>
              {clip(item.threadId, 12)} | {item.status} | {clip(item.candidateName ?? item.reason, 60)}
            </Text>
          ))}
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="gray">
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
      props.setPreview(payload.items.slice(0, 8));
      props.setMessage(
        `Preview refreshed: ${payload.items.filter((item) => item.status === "apply").length} ready`
      );
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
      void runAction(
        () => props.client.suggest(props.selected!.threadId),
        `Suggested ${clip(props.selected.threadId, 12)}`
      );
      return;
    }

    if (input === "a" && props.selected) {
      void runAction(
        () => props.client.apply(props.selected!.threadId),
        `Applied ${clip(props.selected.threadId, 12)}`
      );
      return;
    }

    if (input === "f" && props.detail) {
      void runAction(
        () => props.client.freeze(props.detail!.threadId, !props.detail!.frozen),
        `${props.detail.frozen ? "Unfroze" : "Froze"} ${clip(props.detail.threadId, 12)}`
      );
      return;
    }

    if (input === "m" && props.detail) {
      void runAction(
        () => props.client.setManualOverride(props.detail!.threadId, !props.detail!.manualOverride),
        `${props.detail.manualOverride ? "Cleared manual override for" : "Enabled manual override for"} ${clip(props.detail.threadId, 12)}`
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
          props.setPreview(payload.items.slice(0, 8));
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

    if (input === "q") {
      exit();
    }
  });

  return null;
}
