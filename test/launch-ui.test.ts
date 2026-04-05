import { describe, expect, it } from "vitest";

import { classifyManagedProcess } from "../scripts/launch-ui.ts";

describe("classifyManagedProcess", () => {
  const repoCwd = "/tmp/codex-session-manager";

  it("classifies stale web launcher and API processes for the same repo", () => {
    expect(
      classifyManagedProcess(
        {
          cwd: repoCwd,
          cmdline: ["node", "/tmp/codex-session-manager/node_modules/.bin/tsx", "/tmp/codex-session-manager/scripts/launch-ui.ts", "web"]
        },
        repoCwd,
        "web"
      )
    ).toBe("launcher-web");

    expect(
      classifyManagedProcess(
        {
          cwd: repoCwd,
          cmdline: ["node", "/tmp/codex-session-manager/node_modules/.bin/tsx", "/tmp/codex-session-manager/packages/api/src/index.ts"]
        },
        repoCwd,
        "web"
      )
    ).toBe("api");
  });

  it("classifies the same repo vite dev server but ignores build and foreign repos", () => {
    expect(
      classifyManagedProcess(
        {
          cwd: repoCwd,
          cmdline: ["node", "/tmp/codex-session-manager/node_modules/vite/bin/vite.js"]
        },
        repoCwd,
        "web"
      )
    ).toBe("web");

    expect(
      classifyManagedProcess(
        {
          cwd: repoCwd,
          cmdline: ["node", "/tmp/codex-session-manager/node_modules/vite/bin/vite.js", "build"]
        },
        repoCwd,
        "web"
      )
    ).toBeUndefined();

    expect(
      classifyManagedProcess(
        {
          cwd: "/tmp/other-repo",
          cmdline: ["node", "/tmp/other-repo/node_modules/vite/bin/vite.js"]
        },
        repoCwd,
        "web"
      )
    ).toBeUndefined();
  });
});
