import type { CodexNamer } from "@codexnamer/core";
import { configUpdateRequestSchema, providerTestRequestSchema } from "@codexnamer/shared";
import type { FastifyInstance } from "fastify";

import type { ApiEventLog } from "../event-log.js";

export function registerProviderAndConfigRoutes(
  app: FastifyInstance,
  manager: CodexNamer,
  eventLog: ApiEventLog,
) {
  app.get("/api/v1/providers", async () => {
    const config = await manager.printConfig();
    return {
      ai: config.ai,
      providerProfiles: config.providerProfiles,
      inheritedCodex: config.inheritedCodex,
      resolvedProvider: config.resolvedProvider,
      lastProviderTest: config.lastProviderTest,
    };
  });

  app.post("/api/v1/providers/test", async (request) => {
    const body = providerTestRequestSchema.parse(
      (request.body as Record<string, unknown> | undefined) ?? {},
    );
    return manager.testProvider({ userConfig: body.userConfig });
  });

  app.post("/api/v1/providers/parse-codex", async () => manager.parseCodexProviderConfig());

  app.get("/api/v1/config", async () => manager.getConfigView());

  app.put("/api/v1/config", async (request) => {
    const body = configUpdateRequestSchema.parse(
      (request.body as Record<string, unknown> | undefined) ?? {},
    );
    const result = await manager.updateConfig(body.userConfig);
    eventLog.publish("config.updated", {
      writtenTo: result.writtenTo,
      restartRequired: result.restartRequired,
    });
    return result;
  });
}
