import type { FastifyInstance } from "fastify";

import { CodexNamer } from "@codexnamer/core";
import type { ConfigDocument } from "@codexnamer/shared";

import { ApiEventLog } from "../event-log.js";

export function registerProviderAndConfigRoutes(app: FastifyInstance, manager: CodexNamer, eventLog: ApiEventLog) {
  app.get("/api/v1/providers", async () => {
    const config = await manager.printConfig();
    return {
      ai: config.ai,
      providerProfiles: config.providerProfiles,
      inheritedCodex: config.inheritedCodex,
      resolvedProvider: config.resolvedProvider,
      lastProviderTest: config.lastProviderTest
    };
  });

  app.post("/api/v1/providers/test", async (request) => {
    const body = (request.body as { userConfig?: ConfigDocument } | undefined) ?? {};
    return manager.testProvider({ userConfig: body.userConfig });
  });

  app.post("/api/v1/providers/parse-codex", async () => manager.parseCodexProviderConfig());

  app.get("/api/v1/config", async () => manager.getConfigView());

  app.put("/api/v1/config", async (request) => {
    const body = (request.body as (ConfigDocument & { userConfig?: ConfigDocument }) | undefined) ?? {};
    const patch = body.userConfig ?? body;
    const result = await manager.updateConfig(patch);
    eventLog.publish("config.updated", {
      writtenTo: result.writtenTo,
      restartRequired: result.restartRequired
    });
    return result;
  });
}
