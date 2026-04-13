import * as React from "react";

const WORKSPACE_PANE_MIN_WIDTH = 220;
const WORKSPACE_PANE_MAX_WIDTH = 420;
const SESSION_PANE_MIN_WIDTH = 320;
const SESSION_PANE_MAX_WIDTH = 560;
const SESSION_PANE_AUTO_COLLAPSE_WIDTH = 272;
const SESSION_PANE_RESTORE_WIDTH = 390;
const PANE_KEYBOARD_STEP = 24;

function clampWorkspacePaneWidth(value: number): number {
  return Math.max(WORKSPACE_PANE_MIN_WIDTH, Math.min(WORKSPACE_PANE_MAX_WIDTH, value));
}

function clampSessionPaneWidth(value: number): number {
  return Math.max(SESSION_PANE_MIN_WIDTH, Math.min(SESSION_PANE_MAX_WIDTH, value));
}

function readStoredNumber(key: string, fallback: number): number {
  const raw = window.localStorage.getItem(key);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readStoredBoolean(key: string, fallback = false): boolean {
  const raw = window.localStorage.getItem(key);
  return raw === null ? fallback : raw === "true";
}

export function usePaneLayoutState(params: { tab: string; selectedId?: string }) {
  const workspaceDragRef = React.useRef<{ startX: number; startWidth: number } | null>(null);
  const sessionDragRef = React.useRef<{ startX: number; startWidth: number } | null>(null);
  const [sessionPaneCollapsed, setSessionPaneCollapsed] = React.useState(() =>
    readStoredBoolean("csm:sessionPaneCollapsed", false),
  );
  const [workspacePaneWidth, setWorkspacePaneWidth] = React.useState(() =>
    readStoredNumber("csm:workspacePaneWidth", 280),
  );
  const [sessionPaneWidth, setSessionPaneWidth] = React.useState(() =>
    readStoredNumber("csm:sessionPaneWidth", 390),
  );
  const [sessionFocusMode, setSessionFocusMode] = React.useState(false);
  const sessionPaneRestoreWidthRef = React.useRef(
    Math.max(SESSION_PANE_RESTORE_WIDTH, readStoredNumber("csm:sessionPaneWidth", 390)),
  );

  React.useEffect(() => {
    window.localStorage.setItem("csm:sessionPaneCollapsed", String(sessionPaneCollapsed));
  }, [sessionPaneCollapsed]);

  React.useEffect(() => {
    window.localStorage.setItem("csm:workspacePaneWidth", String(workspacePaneWidth));
  }, [workspacePaneWidth]);

  React.useEffect(() => {
    window.localStorage.setItem("csm:sessionPaneWidth", String(sessionPaneWidth));
  }, [sessionPaneWidth]);

  React.useEffect(() => {
    if (!sessionPaneCollapsed && sessionPaneWidth >= SESSION_PANE_MIN_WIDTH) {
      sessionPaneRestoreWidthRef.current = sessionPaneWidth;
    }
  }, [sessionPaneCollapsed, sessionPaneWidth]);

  React.useEffect(() => {
    if (params.tab !== "sessions" || !params.selectedId) {
      setSessionFocusMode(false);
    }
  }, [params.selectedId, params.tab]);

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (workspaceDragRef.current) {
        const delta = event.clientX - workspaceDragRef.current.startX;
        setWorkspacePaneWidth(clampWorkspacePaneWidth(workspaceDragRef.current.startWidth + delta));
      }
      if (sessionDragRef.current) {
        const delta = event.clientX - sessionDragRef.current.startX;
        const nextWidth = Math.max(
          220,
          Math.min(SESSION_PANE_MAX_WIDTH, sessionDragRef.current.startWidth + delta),
        );
        if (nextWidth <= SESSION_PANE_AUTO_COLLAPSE_WIDTH) {
          setSessionPaneCollapsed(true);
          setSessionPaneWidth(
            Math.max(sessionPaneRestoreWidthRef.current, SESSION_PANE_RESTORE_WIDTH),
          );
        } else {
          setSessionPaneCollapsed(false);
          setSessionPaneWidth(Math.max(SESSION_PANE_MIN_WIDTH, nextWidth));
        }
      }
    };

    const handlePointerUp = () => {
      workspaceDragRef.current = null;
      sessionDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  const adjustWorkspacePaneWidth = (delta: number) => {
    setWorkspacePaneWidth((value) => clampWorkspacePaneWidth(value + delta));
  };

  const setWorkspacePaneWidthTo = (value: number) => {
    setWorkspacePaneWidth(clampWorkspacePaneWidth(value));
  };

  const adjustSessionPaneWidth = (delta: number) => {
    setSessionPaneCollapsed(false);
    setSessionPaneWidth((value) => clampSessionPaneWidth(value + delta));
  };

  const handleWorkspaceSplitterKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        adjustWorkspacePaneWidth(-PANE_KEYBOARD_STEP);
        break;
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        adjustWorkspacePaneWidth(PANE_KEYBOARD_STEP);
        break;
      case "Home":
        event.preventDefault();
        setWorkspacePaneWidthTo(WORKSPACE_PANE_MIN_WIDTH);
        break;
      case "End":
        event.preventDefault();
        setWorkspacePaneWidthTo(WORKSPACE_PANE_MAX_WIDTH);
        break;
      default:
        break;
    }
  };

  const startWorkspaceResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    workspaceDragRef.current = {
      startX: event.clientX,
      startWidth: workspacePaneWidth,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const startSessionResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setSessionPaneCollapsed(false);
    sessionDragRef.current = {
      startX: event.clientX,
      startWidth: sessionPaneWidth,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const toggleSessionPane = () => {
    setSessionPaneCollapsed((previous) => {
      const nextCollapsed = !previous;
      if (!nextCollapsed) {
        setSessionPaneWidth(
          Math.max(sessionPaneRestoreWidthRef.current, SESSION_PANE_RESTORE_WIDTH),
        );
      }
      return nextCollapsed;
    });
  };

  return {
    sessionFocusMode,
    setSessionFocusMode,
    sessionPaneCollapsed,
    setSessionPaneCollapsed,
    workspacePaneWidth,
    sessionPaneWidth,
    adjustWorkspacePaneWidth,
    adjustSessionPaneWidth,
    handleWorkspaceSplitterKeyDown,
    startWorkspaceResize,
    startSessionResize,
    toggleSessionPane,
    handleSessionPaneWidthChange: adjustSessionPaneWidth,
  };
}
