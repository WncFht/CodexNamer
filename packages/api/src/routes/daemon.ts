import type { FastifyInstance } from "fastify";

import { DaemonProcessController } from "../daemon-controller.js";

export function registerDaemonRoutes(app: FastifyInstance, daemonController: DaemonProcessController) {
  app.get("/api/v1/daemon", async () => daemonController.getStatus());

  app.post("/api/v1/daemon/start", async (request) => {
    const body = (request.body as { intervalSeconds?: number } | undefined) ?? {};
    return daemonController.start(body.intervalSeconds);
  });

  app.post("/api/v1/daemon/stop", async () => daemonController.stop());
}
