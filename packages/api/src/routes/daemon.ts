import { daemonStartRequestSchema } from "@codexnamer/shared";
import type { FastifyInstance } from "fastify";

import type { DaemonProcessController } from "../daemon-controller.js";

export function registerDaemonRoutes(
  app: FastifyInstance,
  daemonController: DaemonProcessController,
) {
  app.get("/api/v1/daemon", async () => daemonController.getStatus());

  app.post("/api/v1/daemon/start", async (request) => {
    const body = daemonStartRequestSchema.parse(
      (request.body as Record<string, unknown> | undefined) ?? {},
    );
    return daemonController.start(body.intervalSeconds);
  });

  app.post("/api/v1/daemon/stop", async () => daemonController.stop());
}
