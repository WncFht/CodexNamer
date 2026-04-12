import { existsSync } from "node:fs";
import path from "node:path";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import { CodexNamer } from "@codexnamer/core";

import { DaemonProcessController } from "./daemon-controller.js";
import { ApiEventLog } from "./event-log.js";
import { toErrorPayload } from "./lib/errors.js";
import { registerAiRoutes } from "./routes/ai.js";
import { registerDaemonRoutes } from "./routes/daemon.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerMaintenanceRoutes } from "./routes/maintenance.js";
import { registerProviderAndConfigRoutes } from "./routes/providers-config.js";
import { registerRuntimeRoutes } from "./routes/runtime.js";
import { registerSessionRoutes } from "./routes/sessions.js";

export type ApiServer = FastifyInstance & {
  daemonController: DaemonProcessController;
};

export async function buildApiServer(options?: {
  manager?: CodexNamer;
  operator?: string;
  staticWebRoot?: string;
}): Promise<ApiServer> {
  const app = Fastify({
    logger: false
  });

  const ownedManager = options?.manager
    ? undefined
    : await CodexNamer.create({ operator: options?.operator ?? "api" });
  const manager = options?.manager ?? ownedManager!;
  const eventLog = new ApiEventLog();
  const daemonController = new DaemonProcessController({
    defaultIntervalSeconds: () => manager.config.watch.scanIntervalSeconds
  });
  app.decorate("daemonController", daemonController);

  app.addHook("onClose", async () => {
    await daemonController.dispose();
    if (ownedManager) {
      await ownedManager.close();
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const payload = toErrorPayload(error);
    void reply.status(payload.statusCode).send(payload.body);
  });

  registerEventRoutes(app, eventLog);
  registerSessionRoutes(app, manager, eventLog);
  registerAiRoutes(app, manager);
  registerProviderAndConfigRoutes(app, manager, eventLog);
  registerRuntimeRoutes(app, manager, eventLog);
  registerMaintenanceRoutes(app, manager, eventLog);
  registerDaemonRoutes(app, daemonController);

  if (options?.staticWebRoot) {
    const staticWebRoot = path.resolve(options.staticWebRoot);
    const indexHtmlPath = path.join(staticWebRoot, "index.html");
    if (!existsSync(indexHtmlPath)) {
      throw new Error(`Web build not found at ${indexHtmlPath}. Run the web build first or pass a valid --web-root.`);
    }

    await app.register(fastifyStatic, {
      root: staticWebRoot,
      prefix: "/"
    });

    app.setNotFoundHandler((request, reply) => {
      const requestPath = request.url.split("?")[0] ?? "/";
      const shouldServeSpaShell =
        request.method === "GET" &&
        !requestPath.startsWith("/api/") &&
        path.posix.extname(requestPath) === "";

      if (shouldServeSpaShell) {
        return reply.type("text/html; charset=utf-8").sendFile("index.html");
      }

      void reply.status(404).send({
        error: "Not Found",
        message: `Route ${request.method}:${request.url} not found`,
        statusCode: 404
      });
    });
  }

  return Object.assign(app, {
    daemonController
  }) as unknown as ApiServer;
}
