import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";

type UiMode = "web" | "tui";

const DEFAULT_API_HOST = "127.0.0.1";
const DEFAULT_API_PORT = 42110;
const DEFAULT_WEB_PORT = 43110;
const PORT_SCAN_WINDOW = 20;

function parseArgs(argv: string[]): {
  mode: UiMode;
  passthrough: string[];
  explicitApiBase?: string;
} {
  const [modeArg, ...rest] = argv;
  if (modeArg !== "web" && modeArg !== "tui") {
    throw new Error(`Usage: tsx scripts/launch-ui.ts <web|tui> [-- <args...>]`);
  }

  const explicitFlag = rest.find((value) => value.startsWith("--api-base="));
  const apiBaseFromFlag = explicitFlag ? explicitFlag.slice("--api-base=".length) : undefined;
  const apiBaseIndex = rest.findIndex((value) => value === "--api-base");
  const apiBase =
    apiBaseFromFlag ?? (apiBaseIndex >= 0 ? rest[apiBaseIndex + 1] : undefined) ?? process.env.CSM_API_BASE;

  return {
    mode: modeArg,
    passthrough: rest,
    explicitApiBase: apiBase
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function isApiHealthy(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_500);
    const response = await fetch(new URL("/api/v1/health", baseUrl), {
      signal: controller.signal
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

async function canListen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function spawnChild(command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }): ChildProcess {
  return spawn(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(options?.env ?? {})
    }
  });
}

async function startApi(host: string, port: number): Promise<ChildProcess> {
  const child = spawnChild(npmCommand(), ["run", "api", "--", "--host", host, "--port", String(port)]);

  const startDeadline = Date.now() + 20_000;
  const baseUrl = `http://${host}:${port}`;
  while (Date.now() < startDeadline) {
    if (child.exitCode !== null) {
      throw new Error(`API exited before becoming healthy on ${baseUrl}.`);
    }
    if (await isApiHealthy(baseUrl)) {
      return child;
    }
    await delay(500);
  }

  child.kill("SIGTERM");
  throw new Error(`Timed out waiting for API to become healthy on ${baseUrl}.`);
}

async function ensureApi(baseUrlOverride?: string): Promise<{
  baseUrl: string;
  child?: ChildProcess;
  reused: boolean;
}> {
  if (baseUrlOverride) {
    if (await isApiHealthy(baseUrlOverride)) {
      return {
        baseUrl: baseUrlOverride,
        reused: true
      };
    }
    throw new Error(`Configured API base is not healthy: ${baseUrlOverride}`);
  }

  for (let offset = 0; offset <= PORT_SCAN_WINDOW; offset += 1) {
    const port = DEFAULT_API_PORT + offset;
    const baseUrl = `http://${DEFAULT_API_HOST}:${port}`;
    if (await isApiHealthy(baseUrl)) {
      return {
        baseUrl,
        reused: true
      };
    }

    if (await canListen(DEFAULT_API_HOST, port)) {
      try {
        const child = await startApi(DEFAULT_API_HOST, port);
        return {
          baseUrl,
          child,
          reused: false
        };
      } catch {
        if (await isApiHealthy(baseUrl)) {
          return {
            baseUrl,
            reused: true
          };
        }
      }
    }
  }

  throw new Error(`Unable to find a usable API port in ${DEFAULT_API_PORT}-${DEFAULT_API_PORT + PORT_SCAN_WINDOW}.`);
}

function withApiBaseArgs(mode: UiMode, passthrough: string[], apiBase: string): string[] {
  if (mode === "tui") {
    const hasExplicitApiBase = passthrough.some(
      (value, index) =>
        value.startsWith("--api-base=") || (value === "--api-base" && typeof passthrough[index + 1] === "string")
    );
    return hasExplicitApiBase ? passthrough : [...passthrough, "--api-base", apiBase];
  }
  return passthrough;
}

async function main(): Promise<void> {
  const { mode, passthrough, explicitApiBase } = parseArgs(process.argv.slice(2));
  const api = await ensureApi(explicitApiBase);

  const child = spawnChild(
    npmCommand(),
    mode === "web"
      ? ["run", "web:raw", "--", ...withApiBaseArgs(mode, passthrough, api.baseUrl)]
      : ["run", "tui:raw", "--", ...withApiBaseArgs(mode, passthrough, api.baseUrl)],
    {
      env:
        mode === "web"
          ? {
              CSM_API_BASE: api.baseUrl,
              CSM_WEB_PORT: process.env.CSM_WEB_PORT ?? String(DEFAULT_WEB_PORT)
            }
          : {
              CSM_API_BASE: api.baseUrl
            }
    }
  );

  if (api.reused) {
    console.error(`[csm] Reusing API at ${api.baseUrl}`);
  } else {
    console.error(`[csm] Started API at ${api.baseUrl}`);
  }

  const terminate = (signal: NodeJS.Signals) => {
    child.kill(signal);
    if (api.child) {
      api.child.kill(signal);
    }
  };

  process.on("SIGINT", () => terminate("SIGINT"));
  process.on("SIGTERM", () => terminate("SIGTERM"));

  child.on("exit", (code, signal) => {
    if (api.child) {
      api.child.kill("SIGTERM");
    }
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

void main().catch((error) => {
  console.error(`[csm] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
