#!/usr/bin/env node

import { buildApiServer, type ApiServer } from "./app.js";

function parseArgs(argv: string[]): { host: string; port: number } {
  const hostIndex = argv.indexOf("--host");
  const portIndex = argv.indexOf("--port");

  const host = hostIndex >= 0 ? (argv[hostIndex + 1] ?? "127.0.0.1") : "127.0.0.1";
  const portValue = portIndex >= 0 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : 42110;

  return {
    host,
    port: Number.isFinite(portValue) ? portValue : 42110
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const app = (await buildApiServer()) as ApiServer;

  await app.listen({
    host: args.host,
    port: args.port
  });

  try {
    await app.daemonController.start();
  } catch (error) {
    console.error("[api] failed to auto-start daemon", error);
  }
}

void main();
