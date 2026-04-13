#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startApiServer, waitForShutdown } from "@codexnamer/api";
import { CodexNamer } from "@codexnamer/core";
import { cac } from "cac";
import { inspectListeningPortOwner } from "./port-owner.js";
import {
  formatServeAddressInUseMessage,
  formatServeAlreadyRunningMessage,
  formatServeOtherRepoMessage,
  isAddressInUseError,
} from "./serve-errors.js";
import { probeRunningServeTarget } from "./serve-target.js";
import {
  getManagedServiceStatus,
  installManagedService,
  restartManagedService,
  runManagedServiceHost,
  startManagedService,
  stopManagedService,
  uninstallManagedService,
} from "./service-manager.js";

type IdOptions = { id?: string };
type RenameOptions = { id?: string; name?: string };
type BatchApplyOptions = { dirty?: boolean; preview?: boolean };
type ServeOptions = { host?: string; port?: string | number; webRoot?: string; daemon?: boolean };
type ServiceInstallOptions = ServeOptions & { start?: boolean };
type ServiceHostOptions = { config?: string };

async function withManager<T>(fn: (manager: CodexNamer) => Promise<T>): Promise<T> {
  const manager = await CodexNamer.create({ operator: "cli" });
  try {
    return await fn(manager);
  } finally {
    await manager.close();
  }
}

function normalizeArgv(argv: string[]): string[] {
  if (argv[2] === "batch" && argv[3] === "apply") {
    return [...argv.slice(0, 2), "batch-apply", ...argv.slice(4)];
  }
  if (argv[2] === "provider" && argv[3] === "test") {
    return [...argv.slice(0, 2), "provider-test", ...argv.slice(4)];
  }
  if (argv[2] === "config" && argv[3] === "print") {
    return [...argv.slice(0, 2), "config-print", ...argv.slice(4)];
  }
  if (argv[2] === "service" && typeof argv[3] === "string") {
    const serviceSubcommand = argv[3];
    if (serviceSubcommand === "run") {
      return [...argv.slice(0, 2), "serve", ...argv.slice(4)];
    }
    if (
      ["install", "start", "stop", "restart", "status", "uninstall"].includes(serviceSubcommand)
    ) {
      return [...argv.slice(0, 2), `service-${serviceSubcommand}`, ...argv.slice(4)];
    }
  }
  return argv;
}

function resolveServeWebRoot(explicitWebRoot?: string): string | undefined {
  if (explicitWebRoot) {
    const resolved = path.resolve(explicitWebRoot);
    return existsSync(path.join(resolved, "index.html")) ? resolved : undefined;
  }

  const bundledRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  return existsSync(path.join(bundledRoot, "index.html")) ? bundledRoot : undefined;
}

function resolvePort(portValue: string | number | undefined, fallback: number): number {
  if (typeof portValue === "number" && Number.isFinite(portValue)) {
    return portValue;
  }
  if (typeof portValue === "string" && portValue.length > 0) {
    const parsed = Number(portValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

const normalizedArgv = normalizeArgv(process.argv);

const cli = cac("codexnamer");

cli
  .command("serve", "Run the long-lived local service with built Web assets")
  .option("--host <host>", "Host to bind")
  .option("--port <port>", "Port to bind")
  .option("--web-root <path>", "Directory containing a built Web app")
  .option("--no-daemon", "Do not auto-start the background daemon")
  .action(async (options: ServeOptions) => {
    const host = options.host ?? "127.0.0.1";
    const port = resolvePort(options.port, 42110);
    const webRoot = resolveServeWebRoot(options.webRoot);
    const expectedCwd = process.cwd();
    if (!webRoot) {
      throw new Error(
        "No built Web UI found. Run `npm run web:build` first or pass `--web-root <path>` with a directory containing index.html.",
      );
    }

    const existingTarget = await probeRunningServeTarget({
      host,
      port,
      expectedCwd,
    });
    if (existingTarget?.kind === "same-repo") {
      console.error(
        formatServeAlreadyRunningMessage({
          baseUrl: existingTarget.baseUrl,
          cwd: existingTarget.cwd,
        }),
      );
      return;
    }
    if (existingTarget?.kind === "other-repo") {
      throw new Error(
        formatServeOtherRepoMessage({
          host,
          port,
          cwd: existingTarget.cwd,
        }),
      );
    }

    let app: Awaited<ReturnType<typeof startApiServer>>;
    try {
      app = await startApiServer({
        host,
        port,
        webRoot,
        autoStartDaemon: options.daemon !== false,
        operator: "serve",
      });
    } catch (error) {
      if (!isAddressInUseError(error)) {
        throw error;
      }

      const racedTarget = await probeRunningServeTarget({
        host,
        port,
        expectedCwd,
      });
      if (racedTarget?.kind === "same-repo") {
        console.error(
          formatServeAlreadyRunningMessage({
            baseUrl: racedTarget.baseUrl,
            cwd: racedTarget.cwd,
          }),
        );
        return;
      }
      if (racedTarget?.kind === "other-repo") {
        throw new Error(
          formatServeOtherRepoMessage({
            host,
            port,
            cwd: racedTarget.cwd,
          }),
        );
      }

      let serviceStatus: Parameters<typeof formatServeAddressInUseMessage>[0]["serviceStatus"];
      try {
        serviceStatus = (await getManagedServiceStatus()) as Parameters<
          typeof formatServeAddressInUseMessage
        >[0]["serviceStatus"];
      } catch {
        serviceStatus = undefined;
      }
      const portOwner = inspectListeningPortOwner(port);

      throw new Error(
        formatServeAddressInUseMessage({
          host,
          port,
          serviceStatus,
          portOwner,
        }),
      );
    }

    console.error(`[codexnamer] Service listening at http://${host}:${port}/`);
    console.error(`[codexnamer] Web root: ${webRoot}`);
    console.error(
      options.daemon === false
        ? "[codexnamer] Daemon auto-start is disabled for this run."
        : "[codexnamer] Daemon auto-start is enabled for this run.",
    );

    await waitForShutdown(app);
  });

cli
  .command("service-install", "Install the local service into the OS user service manager")
  .option("--host <host>", "Host to bind")
  .option("--port <port>", "Port to bind")
  .option("--web-root <path>", "Directory containing a built Web app")
  .option("--no-daemon", "Do not auto-start the background daemon")
  .option("--start", "Start the service immediately after install")
  .action(async (options: ServiceInstallOptions) => {
    const result = await installManagedService(options);
    console.log(JSON.stringify(result, null, 2));
  });

cli.command("service-start", "Start the installed local service").action(async () => {
  const result = await startManagedService();
  console.log(JSON.stringify(result, null, 2));
});

cli.command("service-stop", "Stop the installed local service").action(async () => {
  const result = await stopManagedService();
  console.log(JSON.stringify(result, null, 2));
});

cli.command("service-restart", "Restart the installed local service").action(async () => {
  const result = await restartManagedService();
  console.log(JSON.stringify(result, null, 2));
});

cli.command("service-status", "Show installed service status and health").action(async () => {
  const result = await getManagedServiceStatus();
  console.log(JSON.stringify(result, null, 2));
});

cli.command("service-uninstall", "Remove the installed local service").action(async () => {
  const result = await uninstallManagedService();
  console.log(JSON.stringify(result, null, 2));
});

cli
  .command("service-host", "Internal service entrypoint")
  .option("--config <path>", "Path to service runtime config")
  .action(async (options: ServiceHostOptions) => {
    if (!options.config) {
      throw new Error("--config is required");
    }
    await runManagedServiceHost(path.resolve(options.config));
  });

cli
  .command("list", "List known sessions")
  .option("--dirty", "Only show dirty sessions")
  .action(async (options: { dirty?: boolean }) => {
    const sessions = await withManager((manager) =>
      manager.listSessions({ dirty: options.dirty || undefined }),
    );
    console.log(JSON.stringify(sessions, null, 2));
  });

cli
  .command("show", "Show one session in detail")
  .option("--id <threadId>", "Thread id")
  .action(async (options: IdOptions) => {
    if (!options.id) {
      throw new Error("--id is required");
    }
    const detail = await withManager((manager) => manager.getSessionDetail(options.id!));
    if (!detail) {
      throw new Error(`Unknown session: ${options.id}`);
    }
    console.log(
      JSON.stringify(
        {
          ...detail,
          renameHistory: detail.renameHistory ?? [],
        },
        null,
        2,
      ),
    );
  });

cli
  .command("suggest", "Generate and store a candidate name")
  .option("--id <threadId>", "Thread id")
  .action(async (options: IdOptions) => {
    if (!options.id) {
      throw new Error("--id is required");
    }
    const suggestion = await withManager((manager) => manager.suggest(options.id!));
    console.log(JSON.stringify(suggestion, null, 2));
  });

cli
  .command("apply", "Apply the stored or freshly generated candidate")
  .option("--id <threadId>", "Thread id")
  .action(async (options: IdOptions) => {
    if (!options.id) {
      throw new Error("--id is required");
    }
    const result = await withManager((manager) => manager.apply(options.id!));
    console.log(JSON.stringify(result, null, 2));
  });

cli
  .command("rename", "Apply a manual final name")
  .option("--id <threadId>", "Thread id")
  .option("--name <name>", "New thread name")
  .action(async (options: RenameOptions) => {
    if (!options.id || !options.name) {
      throw new Error("--id and --name are required");
    }
    const result = await withManager((manager) => manager.rename(options.id!, options.name!));
    console.log(JSON.stringify(result, null, 2));
  });

cli
  .command("history", "Show rename history for a session")
  .option("--id <threadId>", "Thread id")
  .action(async (options: IdOptions) => {
    if (!options.id) {
      throw new Error("--id is required");
    }
    const history = await withManager((manager) => manager.getRenameHistory(options.id!));
    console.log(JSON.stringify(history, null, 2));
  });

cli
  .command("freeze", "Prevent auto-rename for a session")
  .option("--id <threadId>", "Thread id")
  .action(async (options: IdOptions) => {
    if (!options.id) {
      throw new Error("--id is required");
    }
    await withManager((manager) => manager.freeze(options.id!));
    console.log(JSON.stringify({ threadId: options.id, frozen: true }, null, 2));
  });

cli
  .command("unfreeze", "Allow auto-rename again for a session")
  .option("--id <threadId>", "Thread id")
  .action(async (options: IdOptions) => {
    if (!options.id) {
      throw new Error("--id is required");
    }
    await withManager((manager) => manager.unfreeze(options.id!));
    console.log(JSON.stringify({ threadId: options.id, frozen: false }, null, 2));
  });

cli
  .command("batch-apply", "Apply renames to a batch of sessions")
  .option("--dirty", "Process dirty sessions")
  .option("--preview", "Preview only")
  .action(async (options: BatchApplyOptions) => {
    if (!options.dirty) {
      throw new Error("Only --dirty batch apply is implemented in v1.");
    }

    const results = await withManager((manager) =>
      manager.batchApplyDirty({ previewOnly: options.preview || false }),
    );
    console.log(JSON.stringify(results, null, 2));
  });

cli
  .command("compact-index", "Compact session_index.jsonl")
  .option("--dry-run", "Preview compaction")
  .action(async (options) => {
    const result = await withManager((manager) =>
      manager.compactIndex({ dryRun: options.dryRun || false }),
    );
    console.log(JSON.stringify(result, null, 2));
  });

cli.command("doctor", "Run environment and storage checks").action(async () => {
  const report = await withManager((manager) => manager.doctor());
  console.log(JSON.stringify(report, null, 2));
});

cli.command("config-print", "Print effective config with secrets redacted").action(async () => {
  const config = await withManager((manager) => manager.printConfig());
  console.log(JSON.stringify(config, null, 2));
});

cli.command("provider-test", "Test current provider/backend configuration").action(async () => {
  const result = await withManager((manager) => manager.testProvider());
  console.log(JSON.stringify(result, null, 2));
});

cli.help();
cli.parse(normalizedArgv);
