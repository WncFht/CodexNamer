import { describe, expect, it } from "vitest";

import {
  formatServeAddressInUseMessage,
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
});
