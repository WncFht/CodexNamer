import { describe, expect, it } from "vitest";
import type { ManagedServiceStatusResult } from "../packages/cli/src/service-manager.ts";
import {
  formatManagedServiceActionResult,
  formatManagedServiceInstallResult,
  formatManagedServiceStatusResult,
} from "../packages/cli/src/service-output.ts";

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

    const output = formatManagedServiceStatusResult(result);
    expect(output).toContain("[codexnamer] Managed service status");
    expect(output).toContain("- health: unhealthy (Health probe timed out after 1500ms.)");
    expect(output).toContain("- supervisor: running=no, state=spawn scheduled, lastExitCode=1");
    expect(output).toContain("- detected listener: Code H (pid 19728) via lsof");
    expect(output).toContain("- recent stderr:");
    expect(output).toContain("EADDRINUSE");
  });

  it("formats not-installed status with the next command", () => {
    const output = formatManagedServiceStatusResult({
      installed: false,
      serviceName: "dev.codexnamer.agent",
    });

    expect(output).toContain("Managed service is not installed");
    expect(output).toContain("npm run cli -- service install --start");
  });

  it("formats install and uninstall summaries", () => {
    const installOutput = formatManagedServiceInstallResult({
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
    });
    const uninstallOutput = formatManagedServiceActionResult("uninstall", {
      removed: false,
      reason: "not-installed",
    });

    expect(installOutput).toContain("- started now: yes");
    expect(installOutput).toContain("- health: healthy (HTTP 200)");
    expect(uninstallOutput).toContain("Managed service is not installed");
  });
});
