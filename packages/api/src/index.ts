#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildApiServer, type ApiServer } from "./app.js";

export { buildApiServer, type ApiServer } from "./app.js";

export type ApiServerStartOptions = {
  host: string;
  port: number;
  webRoot?: string;
  autoStartDaemon?: boolean;
  operator?: string;
};

function parseArgs(argv: string[]): {
  host: string;
  port: number;
  webRoot?: string;
  autoStartDaemon: boolean;
} {
  const hostIndex = argv.indexOf("--host");
  const portIndex = argv.indexOf("--port");
  const webRootIndex = argv.indexOf("--web-root");
  const autoStartDaemon = !argv.includes("--no-daemon");

  const host = hostIndex >= 0 ? (argv[hostIndex + 1] ?? "127.0.0.1") : "127.0.0.1";
  const portValue = portIndex >= 0 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : 42110;
  const webRootValue = webRootIndex >= 0 ? argv[webRootIndex + 1] : undefined;

  return {
    host,
    port: Number.isFinite(portValue) ? portValue : 42110,
    webRoot: webRootValue ? path.resolve(webRootValue) : undefined,
    autoStartDaemon
  };
}

export async function startApiServer(options: ApiServerStartOptions): Promise<ApiServer> {
  const app = (await buildApiServer({
    operator: options.operator,
    staticWebRoot: options.webRoot
  })) as ApiServer;

  await app.listen({
    host: options.host,
    port: options.port
  });

  if (options.autoStartDaemon !== false) {
    try {
      await app.daemonController.start();
    } catch (error) {
      console.error("[api] failed to auto-start daemon", error);
    }
  }

  return app;
}

export async function waitForShutdown(
  app: ApiServer,
  signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"]
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let closing = false;
    const handlers = new Map<NodeJS.Signals, () => void>();

    const cleanup = () => {
      for (const [signal, handler] of handlers) {
        process.off(signal, handler);
      }
      handlers.clear();
    };

    const close = async () => {
      if (closing) {
        return;
      }
      closing = true;
      cleanup();
      try {
        await app.close();
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    for (const signal of signals) {
      const handler = () => {
        void close();
      };
      handlers.set(signal, handler);
      process.on(signal, handler);
    }
  });
}

export async function runApiServer(options: ApiServerStartOptions): Promise<void> {
  const app = await startApiServer(options);
  await waitForShutdown(app);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await runApiServer({
    host: args.host,
    port: args.port,
    webRoot: args.webRoot,
    autoStartDaemon: args.autoStartDaemon,
    operator: "api"
  });
}

if (isMainModule()) {
  void main().catch((error) => {
    console.error(`[api] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
