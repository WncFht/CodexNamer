import { useState } from "react";

import {
  applySession,
  freezeSession,
  requeueRenamesSince,
  startDaemon,
  stopDaemon,
  suggestSession,
  updateConfig
} from "../api.js";
import type { DataResource, TabId, UiNotice } from "../control-deck-model.js";
import type {
  ConfigDocument,
  ConfigView,
  DaemonControlStatus,
  RenameApplyResponse,
  RenameFreezeResponse,
  RenameSuggestResponse,
  SessionDetail,
  SessionSummary
} from "../types.js";

type ControlDeckActionResources = {
  detail: SessionDetail | null;
  patchSelectedSession: (threadId: string, patch: Partial<SessionSummary & SessionDetail>) => void;
  setConfigView: (config: ConfigView | null) => void;
  loadResources: (
    resources: readonly DataResource[],
    resourceOptions?: {
      threadId?: string;
      urgentPreview?: boolean;
      urgentPromptPreview?: boolean;
    }
  ) => Promise<void>;
  mergeCurrentTabResources: (...groups: readonly DataResource[][]) => DataResource[];
  refreshCurrentView: (refreshOptions?: { threadId?: string; includePromptPreview?: boolean }) => void;
};

type ControlDeckActionUi = {
  tab: TabId;
  selectedId?: string;
  setError: (value: string | null) => void;
  setNotice: (notice: UiNotice | null) => void;
};

export function useControlDeckActions(params: {
  resources: ControlDeckActionResources;
  ui: ControlDeckActionUi;
}) {
  const { resources, ui } = params;
  const [actioning, setActioning] = useState(false);
  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [daemonActioning, setDaemonActioning] = useState<"start" | "stop" | null>(null);

  const setFailure = (nextError: unknown) => {
    const message = nextError instanceof Error ? nextError.message : "Unknown error";
    ui.setError(message);
    ui.setNotice({
      tone: "error",
      text: message
    });
  };

  const refreshAfterAction = (threadId: string) => {
    resources.refreshCurrentView({
      threadId,
      includePromptPreview: true
    });
  };

  const runAction = async <T>(options: {
    threadId: string;
    actionName: string;
    action: () => Promise<T>;
    onSuccess: (result: T) => {
      message: string;
      patch?: Partial<SessionSummary & SessionDetail>;
    };
  }) => {
    setActioning(true);
    setActionLabel(options.actionName);
    ui.setError(null);
    ui.setNotice({
      tone: "info",
      text: `${options.actionName}...`
    });
    try {
      const result = await options.action();
      const success = options.onSuccess(result);
      if (success.patch) {
        resources.patchSelectedSession(options.threadId, success.patch);
      }
      ui.setNotice({
        tone: "success",
        text: success.message
      });
      refreshAfterAction(options.threadId);
    } catch (nextError) {
      setFailure(nextError);
    } finally {
      setActioning(false);
      setActionLabel(null);
    }
  };

  const saveConfig = async (userConfig: ConfigDocument) => {
    setSavingConfig(true);
    ui.setError(null);
    ui.setNotice({
      tone: "info",
      text: "Saving settings..."
    });
    try {
      const result = await updateConfig(userConfig);
      resources.setConfigView(result.config);
      await resources.loadResources(resources.mergeCurrentTabResources(["config", "sessions", "preview"]), {
        threadId: ui.selectedId,
        urgentPreview: true,
        urgentPromptPreview: ui.tab === "settings"
      });
      ui.setNotice({
        tone: "success",
        text: result.restartRequired
          ? `Saved to ${result.writtenTo}. Restart required for some changes.`
          : `Saved to ${result.writtenTo}.`
      });
    } catch (nextError) {
      setFailure(nextError);
    } finally {
      setSavingConfig(false);
    }
  };

  const replayRenamesSince = async (params: {
    since: string;
    basis: "session-updated-at" | "last-applied-at";
  }) => {
    ui.setError(null);
    ui.setNotice({
      tone: "info",
      text: "Re-queueing rename backlog..."
    });
    try {
      const result = await requeueRenamesSince(params);
      await resources.loadResources(resources.mergeCurrentTabResources(["sessions", "overview", "preview"]), {
        threadId: ui.selectedId,
        urgentPreview: true,
        urgentPromptPreview: ui.tab === "settings"
      });
      ui.setNotice({
        tone: "success",
        text:
          result.skipped > 0
            ? `Queued ${result.queued} sessions and skipped ${result.skipped} already-up-to-date or protected sessions.`
            : `Queued ${result.queued} sessions for rename replay.`
      });
      return result;
    } catch (nextError) {
      setFailure(nextError);
      throw nextError;
    }
  };

  const updateDaemonState = async (
    action: "start" | "stop",
    request: () => Promise<DaemonControlStatus>
  ): Promise<DaemonControlStatus> => {
    setDaemonActioning(action);
    ui.setError(null);
    ui.setNotice({
      tone: "info",
      text: action === "start" ? "Starting daemon..." : "Stopping daemon..."
    });
    try {
      const result = await request();
      await resources.loadResources(resources.mergeCurrentTabResources(["daemon", "overview", "preview"]), {
        threadId: ui.selectedId,
        urgentPreview: true
      });
      ui.setNotice({
        tone: "success",
        text:
          action === "start"
            ? `Daemon started${result.pid ? ` (pid ${result.pid})` : ""}.`
            : "Daemon stopped."
      });
      return result;
    } catch (nextError) {
      setFailure(nextError);
      throw nextError;
    } finally {
      setDaemonActioning(null);
    }
  };

  return {
    actioning,
    actionLabel,
    savingConfig,
    daemonActioning,
    saveConfig,
    replayRenamesSince,
    startDaemon: () => updateDaemonState("start", () => startDaemon()),
    stopDaemon: () => updateDaemonState("stop", () => stopDaemon()),
    actions: {
      suggest: () =>
        resources.detail
          ? runAction<RenameSuggestResponse>({
              threadId: resources.detail.threadId,
              actionName: "Suggesting rename",
              action: () => suggestSession(resources.detail!.threadId),
              onSuccess: (result) => ({
                message: `Candidate ready: ${result.name}`,
                patch: {
                  candidateName: result.name
                }
              })
            })
          : Promise.resolve(),
      apply: () =>
        resources.detail
          ? runAction<RenameApplyResponse>({
              threadId: resources.detail.threadId,
              actionName: "Applying rename",
              action: () => applySession(resources.detail!.threadId),
              onSuccess: (result) => ({
                message: result.written ? `Applied: ${result.name}` : `Already up to date: ${result.name}`,
                patch: {
                  officialName: result.name,
                  candidateName: result.name,
                  dirty: false
                }
              })
            })
          : Promise.resolve(),
      toggleFreeze: () =>
        resources.detail
          ? runAction<RenameFreezeResponse>({
              threadId: resources.detail.threadId,
              actionName: resources.detail.frozen ? "Unfreezing session" : "Freezing session",
              action: () => freezeSession(resources.detail!.threadId, !resources.detail!.frozen),
              onSuccess: (result) => ({
                message: result.frozen ? "Session frozen" : "Session unfrozen",
                patch: {
                  frozen: result.frozen
                }
              })
            })
          : Promise.resolve()
    }
  };
}
