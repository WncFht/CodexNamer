import { describe, expect, it } from "vitest";

import {
  formatServeAddressInUseMessage,
  formatServeAlreadyRunningMessage,
  formatServeOtherRepoMessage,
  isAddressInUseError,
} from "../packages/cli/src/serve-errors.ts";

describe("serve error helpers", () => {
  it("detects EADDRINUSE errors", () => {
    expect(isAddressInUseError({ code: "EADDRINUSE" })).toBe(true);
    expect(isAddressInUseError({ code: "ECONNREFUSED" })).toBe(false);
    expect(isAddressInUseError(new Error("boom"))).toBe(false);
  });

  it("formats a generic port-in-use hint", () => {
    const message = formatServeAddressInUseMessage({
      host: "127.0.0.1",
      port: 42110,
    });

    expect(message).toContain("http://127.0.0.1:42110/");
    expect(message).toContain("npm run cli -- service status");
    expect(message).toContain("npm run cli -- service stop");
    expect(message).toContain("npm run serve -- --port 42111");
  });

  it("mentions the managed service when it owns the same address", () => {
    const message = formatServeAddressInUseMessage({
      host: "127.0.0.1",
      port: 42110,
      serviceStatus: {
        installed: true,
        runtime: {
          host: "127.0.0.1",
          port: 42110,
        },
        health: {
          healthy: true,
        },
      },
    });

    expect(message).toContain("managed service is already healthy");
  });

  it("formats a reuse message for the same repo", () => {
    expect(
      formatServeAlreadyRunningMessage({
        baseUrl: "http://127.0.0.1:42110/",
        cwd: "/tmp/codexnamer",
      }),
    ).toContain("Reusing existing CodexNamer service");
  });

  it("formats a conflict message for another repo", () => {
    const message = formatServeOtherRepoMessage({
      host: "127.0.0.1",
      port: 42110,
      cwd: "/tmp/other-repo",
    });

    expect(message).toContain("another CodexNamer repo");
    expect(message).toContain("/tmp/other-repo");
    expect(message).toContain("npm run serve -- --port 42111");
  });
});
