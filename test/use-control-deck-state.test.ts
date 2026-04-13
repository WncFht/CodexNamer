import { describe, expect, it } from "vitest";

import {
  eventRefreshResourcesForTab,
  liveRefreshResourcesForTab,
  panelResourcesForTab,
} from "../packages/web/src/control-deck-model.js";

describe("useControlDeckState resource planning", () => {
  it("loads only settings-specific resources for the settings tab", () => {
    expect(panelResourcesForTab("settings")).toEqual([
      "config",
      "providers",
      "overview",
      "daemon",
      "prompt-preview",
    ]);
  });

  it("loads only runtime resources for the maintenance tab", () => {
    expect(panelResourcesForTab("maintenance")).toEqual([
      "overview",
      "daemon",
      "doctor",
      "ai-request-logs",
      "preview",
    ]);
  });

  it("loads only requeue resources for the requeue tab", () => {
    expect(panelResourcesForTab("requeue")).toEqual(["overview", "daemon"]);
  });

  it("keeps live refresh narrow on the settings tab", () => {
    expect(liveRefreshResourcesForTab("settings")).toEqual([
      "sessions",
      "preview",
      "overview",
      "daemon",
    ]);
    expect(liveRefreshResourcesForTab("settings", { includePromptPreview: true })).toEqual([
      "sessions",
      "preview",
      "overview",
      "daemon",
      "prompt-preview",
    ]);
  });

  it("refreshes runtime telemetry only on the maintenance tab", () => {
    expect(liveRefreshResourcesForTab("maintenance")).toEqual([
      "sessions",
      "preview",
      "overview",
      "daemon",
      "doctor",
      "ai-request-logs",
    ]);
  });

  it("refreshes overview and daemon on the requeue tab", () => {
    expect(liveRefreshResourcesForTab("requeue")).toEqual([
      "sessions",
      "preview",
      "overview",
      "daemon",
    ]);
  });

  it("narrows event-driven refresh to settings resources when config changes", () => {
    expect(eventRefreshResourcesForTab("settings", [{ type: "config.updated" }])).toEqual([
      "sessions",
      "overview",
      "preview",
      "config",
      "providers",
      "daemon",
    ]);
    expect(
      eventRefreshResourcesForTab("settings", [{ type: "config.updated" }], {
        includePromptPreview: true,
      }),
    ).toEqual([
      "sessions",
      "overview",
      "preview",
      "config",
      "providers",
      "prompt-preview",
      "daemon",
    ]);
  });

  it("refreshes only the impacted runtime slices for maintenance events", () => {
    expect(
      eventRefreshResourcesForTab("maintenance", [{ type: "maintenance.compact.completed" }]),
    ).toEqual(["overview", "doctor"]);
    expect(
      eventRefreshResourcesForTab("maintenance", [
        { type: "session.applied" },
        { type: "maintenance.rename_requeued" },
      ]),
    ).toEqual(["sessions", "overview", "preview"]);
  });
});
