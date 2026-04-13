import { afterEach, describe, expect, it, vi } from "vitest";

import { createManagerForTest, createTempWorkspace } from "./helpers.js";

describe("manager scan coalescing", () => {
  const managers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    for (const manager of managers) {
      await manager.close();
    }
    managers.length = 0;
    vi.restoreAllMocks();
  });

  it("reuses the in-flight scan and the short-lived cached result", async () => {
    const workspace = await createTempWorkspace();
    const manager = await createManagerForTest({
      codexHome: workspace.codexHome,
      stateDir: workspace.stateDir,
    });
    managers.push(manager);

    let resolveScan:
      | ((value: { scannedRollouts: number; updatedSessions: number }) => void)
      | undefined;
    const deferredScan = new Promise<{ scannedRollouts: number; updatedSessions: number }>(
      (resolve) => {
        resolveScan = resolve;
      },
    );
    const performScanSpy = vi
      .spyOn(manager as never, "performScan")
      .mockReturnValue(deferredScan as never);

    const first = manager.scan();
    const second = manager.scan();
    expect(performScanSpy).toHaveBeenCalledTimes(1);

    resolveScan?.({
      scannedRollouts: 12,
      updatedSessions: 3,
    });

    await expect(first).resolves.toEqual({
      scannedRollouts: 12,
      updatedSessions: 3,
    });
    await expect(second).resolves.toEqual({
      scannedRollouts: 12,
      updatedSessions: 3,
    });

    await expect(manager.scan()).resolves.toEqual({
      scannedRollouts: 12,
      updatedSessions: 3,
    });
    expect(performScanSpy).toHaveBeenCalledTimes(1);
  });
});
