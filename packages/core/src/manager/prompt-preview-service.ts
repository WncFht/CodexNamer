import type { ConfigDocument, PromptPreview } from "@codexnamer/shared";

import { buildRenamePrompt } from "../provider.js";
import { buildRenameContext } from "../rename-context.js";
import type { ManagerServiceContext } from "./shared.js";

export async function buildPromptPreview(
  context: ManagerServiceContext,
  options?: { threadId?: string; userConfig?: ConfigDocument },
): Promise<PromptPreview> {
  const previewConfig = context.resolvePreviewConfig(options?.userConfig);
  let session;
  if (options?.threadId) {
    await context.scan();
    const detail = context.requireSessionDetail(options.threadId);
    session = await context.materializeSessionForSuggestion(detail, previewConfig);
  } else {
    const syntheticSession = context.buildSyntheticPromptSession(previewConfig);
    session = {
      ...syntheticSession,
      renameContext: buildRenameContext(syntheticSession, previewConfig),
    };
  }

  return {
    threadId: session.threadId,
    synthetic: !options?.threadId,
    prompt: buildRenamePrompt(session, previewConfig),
    renameContext: session.renameContext ?? buildRenameContext(session, previewConfig),
  };
}
