import { startTransition, useEffect, useRef, useState } from "react";

import {
  readUiStateFromUrl,
  writeUiStateToUrl,
  type TabId,
  type UiNotice
} from "../control-deck-model.js";

export function useControlDeckUiState() {
  const initialUiStateRef = useRef<ReturnType<typeof readUiStateFromUrl> | null>(null);
  if (!initialUiStateRef.current) {
    initialUiStateRef.current = readUiStateFromUrl();
  }
  const initialUiState = initialUiStateRef.current;

  const [tab, setTab] = useState<TabId>(initialUiState.tab);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(initialUiState.selectedWorkspaceId);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialUiState.selectedId);
  const [selectedRequestLogId, setSelectedRequestLogId] = useState<number | undefined>(initialUiState.selectedRequestLogId);
  const [search, setSearchState] = useState(initialUiState.search);
  const [showHiddenTranscript, setShowHiddenTranscript] = useState(initialUiState.showHiddenTranscript);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<UiNotice | null>(null);

  useEffect(() => {
    writeUiStateToUrl({
      tab,
      search,
      showHiddenTranscript,
      selectedWorkspaceId,
      selectedId,
      selectedRequestLogId
    });
  }, [search, selectedId, selectedRequestLogId, selectedWorkspaceId, showHiddenTranscript, tab]);

  useEffect(() => {
    setError(null);
  }, [tab]);

  useEffect(() => {
    const handlePopState = () => {
      const nextState = readUiStateFromUrl();
      setTab(nextState.tab);
      setSelectedWorkspaceId(nextState.selectedWorkspaceId);
      setSelectedId(nextState.selectedId);
      setSelectedRequestLogId(nextState.selectedRequestLogId);
      setShowHiddenTranscript(nextState.showHiddenTranscript);
      startTransition(() => {
        setSearchState(nextState.search);
      });
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (!notice || notice.tone === "error") {
      return;
    }

    const timer = window.setTimeout(() => {
      setNotice((current) => (current === notice ? null : current));
    }, 4_000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  return {
    tab,
    setTab,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    selectedId,
    setSelectedId,
    selectedRequestLogId,
    setSelectedRequestLogId,
    search,
    setSearch: (value: string) => {
      startTransition(() => {
        setSearchState(value);
      });
    },
    showHiddenTranscript,
    setShowHiddenTranscript,
    error,
    setError,
    notice,
    setNotice
  };
}
