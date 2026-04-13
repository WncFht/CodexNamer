import type { ApiEventRecord, ApiEventType } from "@codexnamer/shared";

export type TabId = "sessions" | "settings" | "maintenance" | "requeue" | "daemon";
export type UiNotice = {
  tone: "info" | "success" | "error";
  text: string;
};

export type DataResource =
  | "sessions"
  | "config"
  | "providers"
  | "overview"
  | "daemon"
  | "doctor"
  | "ai-request-logs"
  | "preview"
  | "prompt-preview";

export const ALL_WORKSPACES_ID = "__all_workspaces__";
const SESSION_SEARCH_IN_URL = true;

export type UrlUiState = {
  tab: TabId;
  search: string;
  showHiddenTranscript: boolean;
  selectedWorkspaceId: string;
  selectedId?: string;
  selectedRequestLogId?: number;
};

function parseUrlBoolean(value: string | null, fallback: boolean): boolean {
  if (value === null) {
    return fallback;
  }
  return !["0", "false", "no"].includes(value.toLowerCase());
}

function parseUrlTab(value: string | null): TabId {
  if (
    value === "settings" ||
    value === "maintenance" ||
    value === "requeue" ||
    value === "daemon"
  ) {
    return value;
  }
  return "sessions";
}

function mergeResourceSet(resourceSet: Set<DataResource>, ...resources: DataResource[]): void {
  for (const resource of resources) {
    resourceSet.add(resource);
  }
}

function addResourcesForEventType(
  resourceSet: Set<DataResource>,
  tab: TabId,
  type: ApiEventType,
  options?: { includePromptPreview?: boolean },
): void {
  switch (type) {
    case "scan.completed":
      mergeResourceSet(resourceSet, "sessions", "overview", "preview");
      return;
    case "session.suggested":
      mergeResourceSet(resourceSet, "sessions", "preview");
      return;
    case "session.applied":
    case "session.renamed":
    case "session.freeze.changed":
    case "batch.apply.completed":
    case "maintenance.rename_requeued":
      mergeResourceSet(resourceSet, "sessions", "overview", "preview");
      return;
    case "config.updated":
      mergeResourceSet(resourceSet, "sessions", "overview", "preview");
      if (tab === "settings") {
        mergeResourceSet(resourceSet, "config", "providers");
        if (options?.includePromptPreview) {
          mergeResourceSet(resourceSet, "prompt-preview");
        }
      }
      if (tab === "settings" || tab === "maintenance" || tab === "requeue" || tab === "daemon") {
        mergeResourceSet(resourceSet, "daemon");
      }
      return;
    case "maintenance.compact.completed":
      mergeResourceSet(resourceSet, "overview");
      if (tab === "maintenance") {
        mergeResourceSet(resourceSet, "doctor");
      }
      return;
    default:
      return;
  }
}

export function readUiStateFromUrl(): UrlUiState {
  const params = new URLSearchParams(window.location.search);
  const workspace = params.get("workspace");
  return {
    tab: parseUrlTab(params.get("tab")),
    search: params.get("q") ?? "",
    showHiddenTranscript: parseUrlBoolean(params.get("hidden"), false),
    selectedWorkspaceId:
      workspace && workspace !== ALL_WORKSPACES_ID ? workspace : ALL_WORKSPACES_ID,
    selectedId: params.get("session") ?? undefined,
    selectedRequestLogId: params.get("requestLog") ? Number(params.get("requestLog")) : undefined,
  };
}

export function writeUiStateToUrl(state: UrlUiState): void {
  const params = new URLSearchParams(window.location.search);

  if (state.tab === "sessions") {
    params.delete("tab");
  } else {
    params.set("tab", state.tab);
  }

  if (!SESSION_SEARCH_IN_URL || !state.search) {
    params.delete("q");
  } else {
    params.set("q", state.search);
  }

  if (!state.showHiddenTranscript) {
    params.delete("hidden");
  } else {
    params.set("hidden", "1");
  }

  if (state.selectedWorkspaceId === ALL_WORKSPACES_ID) {
    params.delete("workspace");
  } else {
    params.set("workspace", state.selectedWorkspaceId);
  }

  if (!state.selectedId) {
    params.delete("session");
  } else {
    params.set("session", state.selectedId);
  }

  if (!state.selectedRequestLogId || Number.isNaN(state.selectedRequestLogId)) {
    params.delete("requestLog");
  } else {
    params.set("requestLog", String(state.selectedRequestLogId));
  }

  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(window.history.state, "", nextUrl);
  }
}

export function panelResourcesForTab(tab: TabId): DataResource[] {
  if (tab === "settings") {
    return ["config", "providers", "overview", "daemon", "prompt-preview"];
  }
  if (tab === "maintenance") {
    return ["overview", "daemon", "doctor", "ai-request-logs", "preview"];
  }
  if (tab === "requeue") {
    return ["overview", "daemon"];
  }
  if (tab === "daemon") {
    return ["overview", "daemon", "preview"];
  }
  return [];
}

export function liveRefreshResourcesForTab(
  tab: TabId,
  options?: {
    includePromptPreview?: boolean;
  },
): DataResource[] {
  const resources: DataResource[] = ["sessions", "preview"];
  if (tab === "settings") {
    resources.push("overview", "daemon");
    if (options?.includePromptPreview) {
      resources.push("prompt-preview");
    }
    return resources;
  }
  if (tab === "maintenance") {
    resources.push("overview", "daemon", "doctor", "ai-request-logs");
    return resources;
  }
  if (tab === "requeue") {
    resources.push("overview", "daemon");
    return resources;
  }
  if (tab === "daemon") {
    resources.push("overview", "daemon");
  }
  return resources;
}

export function eventRefreshResourcesForTab(
  tab: TabId,
  events: readonly Pick<ApiEventRecord, "type">[],
  options?: {
    includePromptPreview?: boolean;
  },
): DataResource[] {
  const merged = new Set<DataResource>();
  for (const event of events) {
    addResourcesForEventType(merged, tab, event.type, options);
  }
  return [...merged];
}

export function mergeResources(...resourceGroups: readonly DataResource[][]): DataResource[] {
  const merged = new Set<DataResource>();
  for (const group of resourceGroups) {
    for (const resource of group) {
      merged.add(resource);
    }
  }
  return [...merged];
}
