import { useCallback, useEffect, useRef, useState } from "react";

import type { ConfigDocument } from "../../../types.js";

export function usePromptPreviewController(params: {
  draftConfig: ConfigDocument;
  draftKey: string;
  selectedThreadId?: string;
  dirty: boolean;
  hasPromptPreview: boolean;
  onRefreshPromptPreview: (
    userConfig?: ConfigDocument,
    options?: { urgent?: boolean }
  ) => void | Promise<void>;
}) {
  const { draftConfig, draftKey, selectedThreadId, dirty, hasPromptPreview, onRefreshPromptPreview } = params;
  const refreshPromptPreviewRef = useRef(onRefreshPromptPreview);
  const lastRequestedKeyRef = useRef("");
  const lastRequestedThreadIdRef = useRef<string | undefined>(undefined);
  const [previewDirty, setPreviewDirty] = useState(false);

  useEffect(() => {
    refreshPromptPreviewRef.current = onRefreshPromptPreview;
  }, [onRefreshPromptPreview]);

  useEffect(() => {
    if (!hasPromptPreview) {
      return;
    }
    if (!dirty) {
      lastRequestedKeyRef.current = draftKey;
      lastRequestedThreadIdRef.current = selectedThreadId;
      setPreviewDirty(false);
    }
  }, [dirty, draftKey, hasPromptPreview, selectedThreadId]);

  useEffect(() => {
    if (lastRequestedKeyRef.current === draftKey && lastRequestedThreadIdRef.current === selectedThreadId) {
      return;
    }
    setPreviewDirty(dirty || !hasPromptPreview);
  }, [dirty, draftKey, hasPromptPreview, selectedThreadId]);

  const refreshPreview = useCallback(
    async (options?: { urgent?: boolean }) => {
      lastRequestedKeyRef.current = draftKey;
      lastRequestedThreadIdRef.current = selectedThreadId;
      setPreviewDirty(false);
      await refreshPromptPreviewRef.current(draftConfig, {
        urgent: options?.urgent ?? true
      });
    },
    [draftConfig, draftKey, selectedThreadId]
  );

  return {
    previewDirty,
    refreshPreview
  };
}
