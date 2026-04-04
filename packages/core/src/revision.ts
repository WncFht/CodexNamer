import type { MaterializedSession, SessionRevision } from "@codex-session-manager/shared";

import { sha256, stripControl, toUtcIso } from "./util.js";

function fingerprintText(value?: string): string | undefined {
  return value ? sha256(value) : undefined;
}

export function buildSessionRevision(
  session: MaterializedSession,
  fileInfo: { sizeBytes: number; mtime?: string },
  previous?: SessionRevision
): SessionRevision {
  const normalized = {
    cwd: session.cwd ?? "",
    firstUserMessage: stripControl(session.firstUserMessage) ?? "",
    lastUserMessage: stripControl(session.lastUserMessage) ?? "",
    lastAgentMessage: stripControl(session.lastAgentMessage) ?? "",
    modelProvider: session.modelProvider ?? "",
    taskCompleteCount: session.taskCompleteCount,
    tokenTotal: session.tokenTotal
  };

  const currentRevision = sha256(JSON.stringify(normalized));
  const lastAgentMessageFingerprint = fingerprintText(normalized.lastAgentMessage);
  const hasMaterialChange =
    !previous ||
    previous.currentRevision !== currentRevision ||
    previous.lastTaskCompleteCount !== session.taskCompleteCount ||
    previous.lastAgentMessageFingerprint !== lastAgentMessageFingerprint;

  return {
    currentRevision,
    lastSeenRolloutSize: fileInfo.sizeBytes,
    lastSeenRolloutMtime: fileInfo.mtime,
    lastMaterialChangeAt: hasMaterialChange
      ? session.updatedAt ?? toUtcIso()
      : previous?.lastMaterialChangeAt ?? session.updatedAt ?? toUtcIso(),
    lastTaskCompleteCount: session.taskCompleteCount,
    lastAgentMessageFingerprint
  };
}

export function isDirtySinceRename(currentRevision?: string, lastAppliedRevision?: string): boolean {
  if (!currentRevision) {
    return false;
  }

  if (!lastAppliedRevision) {
    return true;
  }

  return currentRevision !== lastAppliedRevision;
}

