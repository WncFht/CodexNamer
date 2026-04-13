type ManagedServiceStatusLike = {
  installed?: boolean;
  runtime?: {
    host?: string;
    port?: number;
  };
  health?: {
    healthy?: boolean;
  };
};

function formatServiceCommand(command: string): string {
  return `npm run cli -- service ${command}`;
}

function formatServeRetryCommand(host: string, port: number): string {
  const hostArgs = host === "127.0.0.1" ? "" : ` --host ${host}`;
  return `npm run serve --${hostArgs} --port ${port}`;
}

export function isAddressInUseError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EADDRINUSE"
  );
}

export function formatServeAddressInUseMessage(params: {
  host: string;
  port: number;
  serviceStatus?: ManagedServiceStatusLike;
}): string {
  const { host, port, serviceStatus } = params;
  const baseUrl = `http://${host}:${port}/`;
  const lines = [`Cannot start CodexNamer because ${baseUrl} is already in use.`];

  if (
    serviceStatus?.installed &&
    serviceStatus.runtime?.host === host &&
    serviceStatus.runtime?.port === port
  ) {
    lines.push(
      serviceStatus.health?.healthy
        ? "The installed managed service is already healthy on that address."
        : "The installed managed service is configured for that address.",
    );
  }

  lines.push(
    `Check \`${formatServiceCommand("status")}\`, stop it with \`${formatServiceCommand("stop")}\`, or retry on another port such as \`${formatServeRetryCommand(host, port + 1)}\`.`,
  );

  return lines.join(" ");
}

export function formatServeAlreadyRunningMessage(params: {
  baseUrl: string;
  cwd?: string;
}): string {
  return params.cwd
    ? `[codexnamer] Reusing existing CodexNamer service at ${params.baseUrl} for repo ${params.cwd}`
    : `[codexnamer] Reusing existing CodexNamer service at ${params.baseUrl}`;
}

export function formatServeOtherRepoMessage(params: {
  host: string;
  port: number;
  cwd: string;
}): string {
  const baseUrl = `http://${params.host}:${params.port}/`;
  return [
    `Cannot start CodexNamer because ${baseUrl} is already serving another CodexNamer repo from ${params.cwd}.`,
    `Stop it with \`${formatServiceCommand("stop")}\` if that address belongs to your installed service, or retry on another port such as \`${formatServeRetryCommand(params.host, params.port + 1)}\`.`,
  ].join(" ");
}
