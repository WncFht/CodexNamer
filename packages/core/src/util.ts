import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

export function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }

  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

export function toUtcIso(date: Date = new Date()): string {
  return date.toISOString();
}

export function sha256(input: string): string {
  return `sha256:${crypto.createHash("sha256").update(input).digest("hex")}`;
}

export function normalizeWhitespace(input?: string): string | undefined {
  if (!input) {
    return undefined;
  }

  const value = input.replace(/\s+/g, " ").trim();
  return value.length > 0 ? value : undefined;
}

export function excerpt(input: string | undefined, maxLength: number): string | undefined {
  const normalized = normalizeWhitespace(input);
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

export function basenameSafe(input?: string): string | undefined {
  if (!input) {
    return undefined;
  }

  const base = path.basename(input);
  return base && base !== path.sep ? base : undefined;
}

export function deepMerge<T>(base: T, override: Partial<T>): T {
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }

    const current = result[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      result[key] = deepMerge(
        current as Record<string, unknown>,
        value as Record<string, unknown>
      );
      continue;
    }

    result[key] = value;
  }

  return result as T;
}

export function ensureTrailingNewline(input: string): string {
  return input.endsWith("\n") ? input : `${input}\n`;
}

export function stripControl(input?: string): string | undefined {
  if (!input) {
    return undefined;
  }

  return input.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
}

