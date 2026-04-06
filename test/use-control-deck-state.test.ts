import { describe, expect, it } from "vitest";

import {
  liveRefreshResourcesForTab,
  panelResourcesForTab
} from "../packages/web/src/control-deck-model.js";

describe("useControlDeckState resource planning", () => {
  it("loads only settings-specific resources for the settings tab", () => {
    expect(panelResourcesForTab("settings")).toEqual(["config", "providers", "overview", "prompt-preview"]);
  });

  it("loads only runtime resources for the maintenance tab", () => {
    expect(panelResourcesForTab("maintenance")).toEqual(["overview", "doctor", "ai-request-logs", "preview"]);
  });

  it("keeps live refresh narrow on the settings tab", () => {
    expect(liveRefreshResourcesForTab("settings")).toEqual(["sessions", "preview", "overview"]);
    expect(liveRefreshResourcesForTab("settings", { includePromptPreview: true })).toEqual([
      "sessions",
      "preview",
      "overview",
      "prompt-preview"
    ]);
  });

  it("refreshes runtime telemetry only on the maintenance tab", () => {
    expect(liveRefreshResourcesForTab("maintenance")).toEqual([
      "sessions",
      "preview",
      "overview",
      "doctor",
      "ai-request-logs"
    ]);
  });
});
