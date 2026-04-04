import React from "react";
import { render } from "ink";

import { App } from "./App.js";

function parseApiBase(argv: string[]): string {
  const baseFlag = argv.find((value) => value.startsWith("--api-base="));
  if (baseFlag) {
    return baseFlag.slice("--api-base=".length);
  }

  const baseIndex = argv.findIndex((value) => value === "--api-base");
  const nextValue = baseIndex >= 0 ? argv[baseIndex + 1] : undefined;
  if (nextValue) {
    return nextValue;
  }

  return process.env.CODEX_SESSION_MANAGER_API_BASE ?? "http://127.0.0.1:42110";
}

render(
  <App
    apiBase={parseApiBase(process.argv.slice(2))}
    interactive={Boolean(process.stdin.isTTY && process.stdin.setRawMode)}
  />
);
