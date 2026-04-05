import { describe, expect, test } from "vitest";

import { computeTerminalLayout, measureDisplayWidth, truncateDisplayText } from "../packages/tui/src/layout.js";

describe("tui layout", () => {
  test("switches to compact stacked mode on narrow terminals", () => {
    const layout = computeTerminalLayout({ columns: 88, rows: 24 });
    expect(layout.compact).toBe(true);
    expect(layout.stacked).toBe(true);
    expect(layout.mode).toBe("compact");
  });

  test("keeps split layout on wide terminals", () => {
    const layout = computeTerminalLayout({ columns: 180, rows: 42 });
    expect(layout.compact).toBe(false);
    expect(layout.stacked).toBe(false);
    expect(layout.mode).toBe("full");
  });

  test("keeps 144x38 in split layout", () => {
    const layout = computeTerminalLayout({ columns: 144, rows: 38 });
    expect(layout.compact).toBe(false);
    expect(layout.stacked).toBe(false);
    expect(layout.mode).toBe("full");
  });

  test("expands detail pane in fullscreen detail mode", () => {
    const layout = computeTerminalLayout(
      { columns: 180, rows: 42 },
      { screenMode: "browser", viewMode: "detail", showPreview: false }
    );
    expect(layout.detailWidth).toBeGreaterThan(150);
    expect(layout.listHeight).toBe(0);
    expect(layout.previewHeight).toBe(0);
  });

  test("measures and truncates wide characters correctly", () => {
    expect(measureDisplayWidth("你好abc")).toBe(7);
    expect(truncateDisplayText("你好世界abc", 7)).toBe("你好世…");
  });
});
