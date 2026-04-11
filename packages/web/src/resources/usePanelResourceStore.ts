import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchAiRequestLogDetail,
  fetchAiRequestLogs,
  fetchAutoRenamePreview,
  fetchConfig,
  fetchDaemonStatus,
  fetchDoctor,
  fetchOverview,
  fetchPromptPreview,
  fetchProviders
} from "../api.js";
import type { TabId } from "../control-deck-model.js";
import type {
  AiRequestLogDetailResponse,
  AiRequestLogResponse,
  AutoRenamePreviewResponse,
  ConfigDocument,
  ConfigView,
  DaemonControlStatus,
  DoctorResponse,
  OverviewResponse,
  PromptPreviewResponse,
  ProviderResponse
} from "../types.js";

type UsePanelResourceStoreOptions = {
  tab: TabId;
  selectedId?: string;
  selectedRequestLogId?: number;
  onFailure: (error: unknown) => void;
};

export function usePanelResourceStore(options: UsePanelResourceStoreOptions) {
  const { tab, selectedId, selectedRequestLogId, onFailure } = options;
  const [providers, setProviders] = useState<ProviderResponse | null>(null);
  const [configView, setConfigView] = useState<ConfigView | null>(null);
  const [doctor, setDoctor] = useState<DoctorResponse | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [daemon, setDaemon] = useState<DaemonControlStatus | null>(null);
  const [aiRequestLogs, setAiRequestLogs] = useState<AiRequestLogResponse | null>(null);
  const [aiRequestLogDetail, setAiRequestLogDetail] = useState<AiRequestLogDetailResponse | null>(null);
  const [preview, setPreview] = useState<AutoRenamePreviewResponse | null>(null);
  const [previewRefreshing, setPreviewRefreshing] = useState(false);
  const [promptPreview, setPromptPreview] = useState<PromptPreviewResponse | null>(null);
  const [promptPreviewRefreshing, setPromptPreviewRefreshing] = useState(false);
  const latestUiStateRef = useRef({
    tab,
    selectedId,
    selectedRequestLogId
  });
  const latestCallbacksRef = useRef({ onFailure });
  const configRequestIdRef = useRef(0);
  const providersRequestIdRef = useRef(0);
  const overviewRequestIdRef = useRef(0);
  const doctorRequestIdRef = useRef(0);
  const daemonRequestIdRef = useRef(0);
  const aiRequestLogsRequestIdRef = useRef(0);
  const aiRequestLogDetailRequestIdRef = useRef(0);
  const previewRequestIdRef = useRef(0);
  const promptPreviewRequestIdRef = useRef(0);
  const previewUrgentPendingRef = useRef(0);
  const promptPreviewUrgentPendingRef = useRef(0);

  latestUiStateRef.current = {
    tab,
    selectedId,
    selectedRequestLogId
  };
  latestCallbacksRef.current = { onFailure };

  const refreshConfigView = useCallback(async () => {
    const requestId = ++configRequestIdRef.current;
    const payload = await fetchConfig();
    if (requestId !== configRequestIdRef.current) {
      return;
    }
    setConfigView(payload);
  }, []);

  const refreshProviders = useCallback(async () => {
    const requestId = ++providersRequestIdRef.current;
    const payload = await fetchProviders();
    if (requestId !== providersRequestIdRef.current) {
      return;
    }
    setProviders(payload);
  }, []);

  const refreshOverview = useCallback(async () => {
    const requestId = ++overviewRequestIdRef.current;
    const payload = await fetchOverview();
    if (requestId !== overviewRequestIdRef.current) {
      return;
    }
    setOverview(payload);
  }, []);

  const refreshDoctor = useCallback(async () => {
    const requestId = ++doctorRequestIdRef.current;
    const payload = await fetchDoctor();
    if (requestId !== doctorRequestIdRef.current) {
      return;
    }
    setDoctor(payload);
  }, []);

  const refreshDaemon = useCallback(async () => {
    const requestId = ++daemonRequestIdRef.current;
    const payload = await fetchDaemonStatus();
    if (requestId !== daemonRequestIdRef.current) {
      return;
    }
    setDaemon(payload);
  }, []);

  const refreshAiRequestLogs = useCallback(async () => {
    const requestId = ++aiRequestLogsRequestIdRef.current;
    const payload = await fetchAiRequestLogs();
    if (requestId !== aiRequestLogsRequestIdRef.current) {
      return;
    }
    setAiRequestLogs(payload);
  }, []);

  const refreshAiRequestLogDetail = useCallback(async (requestLogId: number | undefined) => {
    const requestId = ++aiRequestLogDetailRequestIdRef.current;
    if (!requestLogId || Number.isNaN(requestLogId)) {
      setAiRequestLogDetail(null);
      return;
    }

    const payload = await fetchAiRequestLogDetail(requestLogId);
    if (requestId !== aiRequestLogDetailRequestIdRef.current) {
      return;
    }
    setAiRequestLogDetail(payload);
  }, []);

  const refreshPreview = useCallback(async (options?: {
    includeCandidateNames?: boolean;
    urgent?: boolean;
    limit?: number;
  }) => {
    if (options?.urgent) {
      previewUrgentPendingRef.current += 1;
      setPreviewRefreshing(true);
    }
    const requestId = ++previewRequestIdRef.current;
    try {
      const payload = await fetchAutoRenamePreview({
        includeCandidateNames: options?.includeCandidateNames ?? false,
        limit:
          typeof options?.limit === "number"
            ? options.limit
            : options?.includeCandidateNames
              ? 100
              : latestUiStateRef.current.tab === "maintenance"
                ? 1000
                : 50
      });
      if (requestId !== previewRequestIdRef.current) {
        return;
      }
      setPreview(payload);
    } catch {
      // Keep the last successful preview. Browsing sessions should not block on preview generation.
    } finally {
      if (options?.urgent) {
        previewUrgentPendingRef.current = Math.max(0, previewUrgentPendingRef.current - 1);
        if (previewUrgentPendingRef.current === 0) {
          setPreviewRefreshing(false);
        }
      }
    }
  }, []);

  const refreshPromptPreview = useCallback(async (request?: {
    threadId?: string;
    urgent?: boolean;
    userConfig?: ConfigDocument;
  }) => {
    if (request?.urgent) {
      promptPreviewUrgentPendingRef.current += 1;
      setPromptPreviewRefreshing(true);
    }
    const requestId = ++promptPreviewRequestIdRef.current;
    try {
      const payload = await fetchPromptPreview(
        request?.threadId ?? latestUiStateRef.current.selectedId,
        request?.userConfig
      );
      if (requestId !== promptPreviewRequestIdRef.current) {
        return;
      }
      setPromptPreview(payload);
    } finally {
      if (request?.urgent) {
        promptPreviewUrgentPendingRef.current = Math.max(0, promptPreviewUrgentPendingRef.current - 1);
        if (promptPreviewUrgentPendingRef.current === 0) {
          setPromptPreviewRefreshing(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (tab !== "settings") {
      return;
    }
    void refreshPromptPreview({
      threadId: selectedId,
      urgent: false
    });
  }, [configView?.effectiveConfig, refreshPromptPreview, selectedId, tab]);

  useEffect(() => {
    if (tab !== "maintenance") {
      setAiRequestLogDetail(null);
      return;
    }
    void refreshAiRequestLogDetail(selectedRequestLogId).catch((error) => {
      latestCallbacksRef.current.onFailure(error);
    });
  }, [refreshAiRequestLogDetail, selectedRequestLogId, tab]);

  return {
    providers,
    configView,
    setConfigView,
    doctor,
    overview,
    daemon,
    aiRequestLogs,
    aiRequestLogDetail,
    preview,
    previewRefreshing,
    promptPreview,
    promptPreviewRefreshing,
    refreshConfigView,
    refreshProviders,
    refreshOverview,
    refreshDoctor,
    refreshDaemon,
    refreshAiRequestLogs,
    refreshAiRequestLogDetail,
    refreshPreview,
    refreshPromptPreview
  };
}
