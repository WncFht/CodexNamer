import { describe, expect, it } from "vitest";
import type { ManagedServiceStatusResult } from "../packages/cli/src/service-manager.ts";
import {
  formatManagedServiceActionResult,
  formatManagedServiceFailure,
  formatManagedServiceInstallResult,
  formatManagedServiceStatusResult,
} from "../packages/cli/src/service-output.ts";
import { stripAnsi } from "../packages/cli/src/terminal-style.ts";

describe("service output", () => {
  it("formats installed service status in a readable summary", () => {
    const result: ManagedServiceStatusResult = {
      installed: true,
      platform: "macos",
      serviceName: "dev.codexnamer.agent",
      url: "http://127.0.0.1:42110",
      configPath: "/Users/tester/.local/state/codexnamer/service/service-config.json",
      logs: {
        stdout: "/Users/tester/.local/state/codexnamer/service/logs/service.stdout.log",
        stderr: "/Users/tester/.local/state/codexnamer/service/logs/service.stderr.log",
      },
      runtime: {
        version: 1,
        platform: "macos",
        installedAt: "2026-04-13T13:01:00.000Z",
        cwd: "/Users/tester/Desktop/src/CodexNamer",
        stateDir: "/Users/tester/.local/state/codexnamer",
        host: "127.0.0.1",
        port: 42110,
        webRoot: "/Users/tester/Desktop/src/CodexNamer/packages/web/dist",
        autoStartDaemon: true,
        url: "http://127.0.0.1:42110",
      },
      commandStatus: {
        command: "launchctl",
        args: ["print", "gui/501/dev.codexnamer.agent"],
        exitCode: 0,
        ok: true,
      },
      platformStatus: {
        loaded: true,
        running: false,
        state: "spawn scheduled",
        lastExitCode: 1,
      },
      health: {
        healthy: false,
        error: "Health probe timed out after 1500ms.",
      },
      portOwner: {
        command: "Code H",
        pid: 19728,
        source: "lsof",
      },
      logTail: {
        stderr: ["Error: listen EADDRINUSE 127.0.0.1:42110"],
      },
    };

    const output = formatManagedServiceStatusResult(result, { color: false });
    expect(output).toContain("Managed service status");
    expect(output).toContain("health         unhealthy (Health probe timed out after 1500ms.)");
    expect(output).toContain("supervisor     running=no, state=spawn scheduled, lastExitCode=1");
    expect(output).toContain("listener       Code H (pid 19728) via lsof");
    expect(output).toContain("recent stderr:");
    expect(output).toContain("EADDRINUSE");
  });

  it("formats not-installed status with the next command", () => {
    const output = formatManagedServiceStatusResult(
      {
        installed: false,
        serviceName: "dev.codexnamer.agent",
      },
      { color: false },
    );

    expect(output).toContain("Managed service is not installed");
    expect(output).toContain("npm run cli -- service install --start");
  });

  it("formats install and uninstall summaries", () => {
    const installOutput = formatManagedServiceInstallResult(
      {
        installed: true,
        platform: "macos",
        url: "http://127.0.0.1:42111",
        configPath: "/tmp/service-config.json",
        shellLauncherPath: "/tmp/run-service.sh",
        powerShellLauncherPath: "/tmp/run-service.ps1",
        descriptorPath: "/tmp/dev.codexnamer.agent.plist",
        autoStartDaemon: true,
        started: true,
        health: {
          healthy: true,
          statusCode: 200,
        },
      },
      { color: false },
    );
    const uninstallOutput = formatManagedServiceActionResult(
      "uninstall",
      {
        removed: false,
        reason: "not-installed",
      },
      { color: false },
    );

    expect(installOutput).toContain("started now    yes");
    expect(installOutput).toContain("health         healthy (HTTP 200)");
    expect(uninstallOutput).toContain("Managed service is not installed");
  });

  it("adds ANSI colors when enabled", () => {
    const colored = formatManagedServiceActionResult(
      "start",
      {
        started: true,
        platform: "linux",
        url: "http://127.0.0.1:42110",
        health: {
          healthy: true,
          statusCode: 200,
        },
      },
      { color: true },
    );

    expect(colored).toContain("\u001B[");
    expect(stripAnsi(colored)).toContain("Managed service started");
    expect(stripAnsi(colored)).toContain("health         healthy (HTTP 200)");
  });

  it("formats startup failures without dumping raw stacks", () => {
    const output = formatManagedServiceFailure(
      {
        kind: "port-in-use",
        phase: "install",
        runtime: {
          version: 1,
          platform: "macos",
          installedAt: "2026-04-13T13:01:00.000Z",
          cwd: "/Users/tester/Desktop/src/CodexNamer",
          stateDir: "/Users/tester/.local/state/codexnamer",
          host: "127.0.0.1",
          port: 42110,
          webRoot: "/Users/tester/Desktop/src/CodexNamer/packages/web/dist",
          autoStartDaemon: true,
          url: "http://127.0.0.1:42110",
        },
        health: {
          healthy: false,
          error: "Health probe timed out after 1500ms.",
        },
        commandStatus: {
          command: "launchctl",
          args: ["print", "gui/501/dev.codexnamer.agent"],
          exitCode: 113,
          ok: false,
        },
        platformStatus: {
          loaded: false,
        },
        portOwner: {
          command: "Code H",
          pid: 82082,
          source: "lsof",
        },
        logTail: {
          stderr: [
            "shell-init: error retrieving current directory: getcwd: cannot access parent directories: Operation not permitted",
            "Error: listen EADDRINUSE: address already in use 127.0.0.1:42110",
            "    at Server.setupListenHandle [as _listen2] (node:net:2008:16)",
          ],
        },
      },
      { color: false },
    );

    expect(output).toContain("Managed service installed, but startup failed");
    expect(output).toContain("reason         target address is already in use");
    expect(output).toContain("listener       Code H (pid 82082) via lsof");
    expect(output).toContain("stderr summary:");
    expect(output).toContain("Error: listen EADDRINUSE: address already in use 127.0.0.1:42110");
    expect(output).not.toContain("at Server.setupListenHandle");
    expect(output).toContain("npm run cli -- service install --start --port 42111");
  });
});
