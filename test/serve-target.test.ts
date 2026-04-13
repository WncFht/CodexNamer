import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { probeRunningServeTarget } from "../packages/cli/src/serve-target.ts";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    ),
  );
});

async function startMockServer(params: { cwd?: string; includeConfig?: boolean }): Promise<number> {
  const server = http.createServer((request, response) => {
    if (request.url === "/api/v1/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.url === "/api/v1/config" && params.includeConfig !== false) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          paths: {
            cwd: params.cwd,
          },
        }),
      );
      return;
    }
    response.writeHead(404).end();
  });
  servers.push(server);

  const address = await new Promise<http.AddressInfo>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const bound = server.address();
      if (!bound || typeof bound === "string") {
        reject(new Error("Expected TCP address"));
        return;
      }
      resolve(bound);
    });
  });
  return address.port;
}

describe("probeRunningServeTarget", () => {
  it("classifies a healthy service from the same repo", async () => {
    const expectedCwd = path.join(os.tmpdir(), "codexnamer-same");
    const port = await startMockServer({ cwd: expectedCwd });

    await expect(
      probeRunningServeTarget({
        host: "127.0.0.1",
        port,
        expectedCwd,
      }),
    ).resolves.toEqual({
      kind: "same-repo",
      baseUrl: `http://127.0.0.1:${port}/`,
      cwd: expectedCwd,
    });
  });

  it("classifies a healthy service from another repo", async () => {
    const port = await startMockServer({ cwd: "/tmp/another-repo" });

    await expect(
      probeRunningServeTarget({
        host: "127.0.0.1",
        port,
        expectedCwd: "/tmp/current-repo",
      }),
    ).resolves.toEqual({
      kind: "other-repo",
      baseUrl: `http://127.0.0.1:${port}/`,
      cwd: path.resolve("/tmp/another-repo"),
    });
  });

  it("falls back to healthy-unknown when config metadata is missing", async () => {
    const port = await startMockServer({ includeConfig: false });

    await expect(
      probeRunningServeTarget({
        host: "127.0.0.1",
        port,
        expectedCwd: "/tmp/current-repo",
      }),
    ).resolves.toEqual({
      kind: "healthy-unknown",
      baseUrl: `http://127.0.0.1:${port}/`,
    });
  });
});
