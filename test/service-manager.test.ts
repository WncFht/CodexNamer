import path from "node:path";

import { describe, expect, it } from "vitest";
import type { ManagedServiceRuntimeConfig } from "../packages/cli/src/service-manager.ts";
import {
  buildManagedServiceDescriptor,
  resolveManagedServicePaths,
  resolveManagedServicePlatform,
  summarizePlatformStatus,
} from "../packages/cli/src/service-manager.ts";

function buildRuntime(
  platform: ManagedServiceRuntimeConfig["platform"],
): ManagedServiceRuntimeConfig {
  return {
    version: 1,
    platform,
    installedAt: "2026-04-12T00:00:00.000Z",
    cwd: "/tmp/codexnamer",
    stateDir: "/tmp/codexnamer-state",
    host: "127.0.0.1",
    port: 42110,
    webRoot: "/tmp/codexnamer/packages/web/dist",
    autoStartDaemon: true,
    url: "http://127.0.0.1:42110",
  };
}

describe("service manager", () => {
  it("normalizes supported platforms", () => {
    expect(resolveManagedServicePlatform("linux")).toBe("linux");
    expect(resolveManagedServicePlatform("darwin")).toBe("macos");
    expect(resolveManagedServicePlatform("win32")).toBe("windows");
  });

  it("builds linux service artifacts under user-scoped paths", () => {
    const paths = resolveManagedServicePaths({
      stateDir: "/tmp/codexnamer-state",
      homeDir: "/home/tester",
    });
    const descriptor = buildManagedServiceDescriptor({
      platform: "linux",
      runtime: buildRuntime("linux"),
      paths,
      cliEntryPath: "/repo/packages/cli/dist/index.js",
      nodePath: "/usr/bin/node",
    });

    expect(paths.serviceConfigPath).toBe("/tmp/codexnamer-state/service/service-config.json");
    expect(paths.linuxUnitPath).toBe("/home/tester/.config/systemd/user/codexnamer.service");
    expect(descriptor.descriptorPath).toBe(paths.linuxUnitPath);
    expect(descriptor.descriptorText).toContain(`WorkingDirectory=${paths.serviceDir}`);
    expect(descriptor.descriptorText).toContain(
      "ExecStart=/bin/sh /tmp/codexnamer-state/service/run-service.sh",
    );
    expect(descriptor.descriptorText).toContain("WantedBy=default.target");
    expect(descriptor.shellLauncherText).toContain("service-host --config");
    expect(descriptor.shellLauncherText).toContain(`cd '${paths.serviceDir}'`);
  });

  it("builds macOS launch agent artifacts with launchd metadata", () => {
    const paths = resolveManagedServicePaths({
      stateDir: "/tmp/codexnamer-state",
      homeDir: "/Users/tester",
    });
    const descriptor = buildManagedServiceDescriptor({
      platform: "macos",
      runtime: buildRuntime("macos"),
      paths,
      cliEntryPath: "/repo/packages/cli/dist/index.js",
      nodePath: "/usr/local/bin/node",
    });

    expect(paths.macPlistPath).toBe(
      "/Users/tester/Library/LaunchAgents/dev.codexnamer.agent.plist",
    );
    expect(descriptor.descriptorPath).toBe(paths.macPlistPath);
    expect(descriptor.descriptorText).toContain("<key>Label</key>");
    expect(descriptor.descriptorText).toContain("<string>dev.codexnamer.agent</string>");
    expect(descriptor.descriptorText).toContain("<key>KeepAlive</key>");
    expect(descriptor.descriptorText).toContain(`<string>${paths.serviceDir}</string>`);
    expect(descriptor.descriptorText).toContain(paths.stdoutLogPath);
    expect(descriptor.shellLauncherText).toContain(`cd '${paths.serviceDir}'`);
  });

  it("builds windows task wrapper command via powershell", () => {
    const windowsStateDir = path.join("C:\\", "Users", "tester", ".local", "state", "codexnamer");
    const paths = resolveManagedServicePaths({
      stateDir: windowsStateDir,
      homeDir: path.join("C:\\", "Users", "tester"),
    });
    const descriptor = buildManagedServiceDescriptor({
      platform: "windows",
      runtime: {
        ...buildRuntime("windows"),
        cwd: path.join("C:\\", "Users", "tester", "codexnamer"),
        stateDir: windowsStateDir,
        webRoot: path.join("C:\\", "Users", "tester", "codexnamer", "packages", "web", "dist"),
      },
      paths,
      cliEntryPath: path.join("C:\\", "repo", "packages", "cli", "dist", "index.js"),
      nodePath: path.join("C:\\", "Program Files", "nodejs", "node.exe"),
    });

    expect(descriptor.descriptorPath).toBe("CodexNamer");
    expect(descriptor.descriptorText).toContain("powershell.exe");
    expect(descriptor.descriptorText).toContain(paths.powerShellLauncherPath);
    expect(descriptor.powerShellLauncherText).toContain("service-host --config");
    expect(descriptor.powerShellLauncherText).toContain(paths.stdoutLogPath);
    expect(descriptor.powerShellLauncherText).toContain(paths.serviceDir);
  });

  it("summarizes macOS launchctl output", () => {
    const summary = summarizePlatformStatus(buildRuntime("macos"), {
      command: "launchctl",
      args: ["print", "gui/501/dev.codexnamer.agent"],
      exitCode: 0,
      ok: true,
      stdout: "state = running\npid = 12345\nlast exit code = 1\n",
      stderr: "",
    });

    expect(summary).toEqual({
      loaded: true,
      running: true,
      state: "running",
      pid: 12345,
      lastExitCode: 1,
    });
  });
});
