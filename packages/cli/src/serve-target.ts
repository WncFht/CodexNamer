import path from "node:path";

export type RunningServeTarget =
  | {
      kind: "same-repo";
      baseUrl: string;
      cwd: string;
    }
  | {
      kind: "other-repo";
      baseUrl: string;
      cwd: string;
    }
  | {
      kind: "healthy-unknown";
      baseUrl: string;
    };

type ConfigPayload = {
  paths?: {
    cwd?: string;
  };
};

async function fetchWithTimeout(url: URL): Promise<Response | undefined> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_500);
    try {
      return await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return undefined;
  }
}

export async function probeRunningServeTarget(params: {
  host: string;
  port: number;
  expectedCwd: string;
}): Promise<RunningServeTarget | undefined> {
  const baseUrl = `http://${params.host}:${params.port}/`;
  const healthResponse = await fetchWithTimeout(new URL("/api/v1/health", baseUrl));
  if (!healthResponse?.ok) {
    return undefined;
  }

  const configResponse = await fetchWithTimeout(new URL("/api/v1/config", baseUrl));
  if (!configResponse?.ok) {
    return {
      kind: "healthy-unknown",
      baseUrl,
    };
  }

  try {
    const payload = (await configResponse.json()) as ConfigPayload;
    const cwd =
      typeof payload.paths?.cwd === "string" ? path.resolve(payload.paths.cwd) : undefined;
    if (!cwd) {
      return {
        kind: "healthy-unknown",
        baseUrl,
      };
    }
    return cwd === path.resolve(params.expectedCwd)
      ? {
          kind: "same-repo",
          baseUrl,
          cwd,
        }
      : {
          kind: "other-repo",
          baseUrl,
          cwd,
        };
  } catch {
    return {
      kind: "healthy-unknown",
      baseUrl,
    };
  }
}
