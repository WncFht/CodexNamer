#!/usr/bin/env node

import { cac } from "cac";

import { CodexNamer } from "@codexnamer/core";

type IdOptions = { id?: string };
type RenameOptions = { id?: string; name?: string };
type BatchApplyOptions = { dirty?: boolean; preview?: boolean };

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
  return argv;
}

const normalizedArgv = normalizeArgv(process.argv);

const cli = cac("codexnamer");

cli
  .command("list", "List known sessions")
  .option("--dirty", "Only show dirty sessions")
  .action(async (options: { dirty?: boolean }) => {
    const sessions = await withManager((manager) =>
      manager.listSessions({ dirty: options.dirty || undefined })
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
          renameHistory: detail.renameHistory ?? []
        },
        null,
        2
      )
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
      manager.batchApplyDirty({ previewOnly: options.preview || false })
    );
    console.log(JSON.stringify(results, null, 2));
  });

cli
  .command("compact-index", "Compact session_index.jsonl")
  .option("--dry-run", "Preview compaction")
  .action(async (options) => {
    const result = await withManager((manager) =>
      manager.compactIndex({ dryRun: options.dryRun || false })
    );
    console.log(JSON.stringify(result, null, 2));
  });

cli
  .command("doctor", "Run environment and storage checks")
  .action(async () => {
    const report = await withManager((manager) => manager.doctor());
    console.log(JSON.stringify(report, null, 2));
  });

cli
  .command("config-print", "Print effective config with secrets redacted")
  .action(async () => {
    const config = await withManager((manager) => manager.printConfig());
    console.log(JSON.stringify(config, null, 2));
  });

cli
  .command("provider-test", "Test current provider/backend configuration")
  .action(async () => {
    const result = await withManager((manager) => manager.testProvider());
    console.log(JSON.stringify(result, null, 2));
  });

cli.help();
cli.parse(normalizedArgv);
