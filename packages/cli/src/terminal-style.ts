export type TerminalStyleOptions = {
  color?: boolean;
};

type Tone = "success" | "warning" | "danger" | "info" | "muted";

const ANSI = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  red: "\u001B[31m",
  cyan: "\u001B[36m",
  gray: "\u001B[90m",
} as const;

function envForcesColor(): boolean | undefined {
  const force = process.env.FORCE_COLOR;
  if (force === undefined) {
    return undefined;
  }
  return force !== "0";
}

export function shouldUseTerminalColor(): boolean {
  if (process.env.NO_COLOR) {
    return false;
  }
  const forced = envForcesColor();
  if (typeof forced === "boolean") {
    return forced;
  }
  if (!process.stdout.isTTY) {
    return false;
  }
  if (process.env.TERM === "dumb") {
    return false;
  }
  return true;
}

export function paint(text: string, code: string, options?: TerminalStyleOptions): string {
  if (!(options?.color ?? shouldUseTerminalColor())) {
    return text;
  }
  return `${code}${text}${ANSI.reset}`;
}

export function bold(text: string, options?: TerminalStyleOptions): string {
  return paint(text, ANSI.bold, options);
}

export function dim(text: string, options?: TerminalStyleOptions): string {
  return paint(text, ANSI.dim, options);
}

export function tone(text: string, toneName: Tone, options?: TerminalStyleOptions): string {
  const code =
    toneName === "success"
      ? ANSI.green
      : toneName === "warning"
        ? ANSI.yellow
        : toneName === "danger"
          ? ANSI.red
          : toneName === "info"
            ? ANSI.cyan
            : ANSI.gray;
  return paint(text, code, options);
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-9;]*m/g, "");
}
