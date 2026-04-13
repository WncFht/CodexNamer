import { spawnSync } from "node:child_process";

export type ListeningPortOwner = {
  command?: string;
  pid?: number;
  source: "lsof" | "ss" | "netstat";
  raw?: string;
};

type CommandResult = {
  ok: boolean;
  stdout: string;
};

function runCommand(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout ?? "",
  };
}

function decodeEscapedProcessName(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }

  return value
    .replace(/\\x([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\([0-7]{3})/g, (_match, octal: string) =>
      String.fromCharCode(Number.parseInt(octal, 8)),
    );
}

export function parseLsofListeningPortOwner(stdout: string): ListeningPortOwner | undefined {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return undefined;
  }

  const firstRow = lines[1]?.split(/\s+/);
  if (!firstRow || firstRow.length < 2) {
    return undefined;
  }

  const pid = Number(firstRow[1]);
  return {
    source: "lsof",
    command: decodeEscapedProcessName(firstRow[0]),
    pid: Number.isInteger(pid) ? pid : undefined,
    raw: lines[1],
  };
}

export function parseSsListeningPortOwner(stdout: string): ListeningPortOwner | undefined {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("pid="));
  const firstLine = lines[0];
  if (!firstLine) {
    return undefined;
  }

  const pidMatch = firstLine.match(/pid=(\d+)/);
  const commandMatch = firstLine.match(/users:\(\("([^"]+)"/);
  return {
    source: "ss",
    command: decodeEscapedProcessName(commandMatch?.[1]),
    pid: pidMatch ? Number(pidMatch[1]) : undefined,
    raw: firstLine,
  };
}

export function parseNetstatListeningPortPid(stdout: string, port: number): number | undefined {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (!line.includes(`:${port}`)) {
      continue;
    }
    if (!/\bLISTEN(ING)?\b/i.test(line)) {
      continue;
    }
    const parts = line.split(/\s+/);
    const maybePid = Number(parts.at(-1));
    if (Number.isInteger(maybePid)) {
      return maybePid;
    }
  }
  return undefined;
}

function inspectWithLsof(port: number): ListeningPortOwner | undefined {
  const result = runCommand("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  if (!result.ok) {
    return undefined;
  }
  return parseLsofListeningPortOwner(result.stdout);
}

function inspectWithSs(port: number): ListeningPortOwner | undefined {
  const result = runCommand("ss", ["-ltnp", `sport = :${port}`]);
  if (!result.ok) {
    return undefined;
  }
  return parseSsListeningPortOwner(result.stdout);
}

function inspectWithNetstat(port: number): ListeningPortOwner | undefined {
  const netstat = runCommand("netstat", ["-ano", "-p", "tcp"]);
  if (!netstat.ok) {
    return undefined;
  }

  const pid = parseNetstatListeningPortPid(netstat.stdout, port);
  if (!pid) {
    return undefined;
  }

  const tasklist = runCommand("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
  const csvLine = tasklist.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const command = csvLine && csvLine.startsWith('"') ? csvLine.slice(1).split('",')[0] : undefined;

  return {
    source: "netstat",
    command: decodeEscapedProcessName(command),
    pid,
    raw: csvLine,
  };
}

export function inspectListeningPortOwner(port: number): ListeningPortOwner | undefined {
  if (process.platform === "win32") {
    return inspectWithNetstat(port);
  }

  return inspectWithLsof(port) ?? inspectWithSs(port);
}
