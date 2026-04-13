import { describe, expect, it } from "vitest";

import { classifyManagedProcess, detectSiblingRepoPath } from "../scripts/launch-ui.ts";

describe("classifyManagedProcess", () => {
  const repoCwd = "/tmp/codexnamer";

  it("classifies stale web launcher and API processes for the same repo", () => {
    expect(
      classifyManagedProcess(
        {
          cwd: repoCwd,
          cmdline: ["node", "/tmp/codexnamer/node_modules/.bin/tsx", "scripts/launch-ui.ts", "web"]
        },
        repoCwd,
        "web"
      )
    ).toBe("launcher-web");

    expect(
      classifyManagedProcess(
        {
          cwd: repoCwd,
          cmdline: ["node", "/tmp/codexnamer/node_modules/.bin/tsx", "packages/api/src/index.ts"]
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
          cwd: `${repoCwd}/packages/web`,
          cmdline: ["node", "/tmp/codexnamer/node_modules/.bin/vite"]
        },
        repoCwd,
        "web"
      )
    ).toBe("web");

    expect(
      classifyManagedProcess(
        {
          cwd: repoCwd,
          cmdline: ["node", "/tmp/codexnamer/node_modules/vite/bin/vite.js", "build"]
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

describe("detectSiblingRepoPath", () => {
  it("detects a same-name sibling repo for ai-tools workspaces", () => {
    expect(detectSiblingRepoPath("/home/tester/Desktop/src/ai-tools/codexnamer")).toBe(
      "/home/tester/Desktop/src/codexnamer"
    );
  });

  it("ignores repos that are not under ai-tools", () => {
    expect(detectSiblingRepoPath("/home/tester/Desktop/src/codexnamer")).toBeUndefined();
  });
});
