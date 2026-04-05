export interface TerminalMetrics {
  columns: number;
  rows: number;
}

export interface TerminalLayout {
  columns: number;
  rows: number;
  stacked: boolean;
  compact: boolean;
  mode: "full" | "stacked" | "compact";
  listWidth: number;
  detailWidth: number;
  listInnerWidth: number;
  detailInnerWidth: number;
  previewInnerWidth: number;
  topSectionHeight: number;
  listHeight: number;
  detailHeight: number;
  previewHeight: number;
  visibleSessionCount: number;
  visiblePreviewCount: number;
}

export interface TerminalLayoutOptions {
  screenMode?: "browser" | "settings";
  viewMode?: "split" | "detail" | "sessions";
  showPreview?: boolean;
}

function getCharWidth(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0xa0)) {
    return 0;
  }
  if (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6))
  ) {
    return 2;
  }
  return 1;
}

export function measureDisplayWidth(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  let width = 0;
  for (const char of value) {
    width += getCharWidth(char);
  }
  return width;
}

export function truncateDisplayText(value: string | undefined, maxWidth: number, fallback = "n/a"): string {
  const safe = value?.trim() || fallback;
  if (maxWidth <= 1) {
    return "…";
  }
  if (measureDisplayWidth(safe) <= maxWidth) {
    return safe;
  }

  let width = 0;
  let output = "";
  for (const char of safe) {
    const charWidth = getCharWidth(char);
    if (width + charWidth > maxWidth - 1) {
      return `${output}…`;
    }
    output += char;
    width += charWidth;
  }

  return output;
}

export function wrapDisplayText(value: string | undefined, maxWidth: number): string[] {
  const safe = value?.replace(/\r\n/g, "\n").replace(/\r/g, "\n") ?? "";
  if (maxWidth <= 1) {
    return ["…"];
  }
  const sourceLines = safe.length > 0 ? safe.split("\n") : [""];
  const wrapped: string[] = [];

  for (const sourceLine of sourceLines) {
    if (sourceLine.length === 0) {
      wrapped.push("");
      continue;
    }

    let current = "";
    let width = 0;
    for (const char of sourceLine) {
      const charWidth = getCharWidth(char);
      if (width + charWidth > maxWidth) {
        wrapped.push(current);
        current = char;
        width = charWidth;
      } else {
        current += char;
        width += charWidth;
      }
    }
    wrapped.push(current);
  }

  return wrapped.length > 0 ? wrapped : [""];
}

export function computeTerminalLayout(
  metrics: TerminalMetrics,
  options?: TerminalLayoutOptions
): TerminalLayout {
  const columns = Math.max(52, metrics.columns || 120);
  const rows = Math.max(22, metrics.rows || 40);
  const area = columns * rows;
  const screenMode = options?.screenMode ?? "browser";
  const viewMode = options?.viewMode ?? "split";
  const showPreview = options?.showPreview ?? false;

  const compact = columns < 108 || rows < 26 || area < 2_900;
  const stacked = screenMode === "settings" ? true : compact || columns < 136 || rows < 31 || area < 4_000;
  const contentWidth = Math.max(columns - 4, 48);
  const previewHeight =
    screenMode !== "browser" || !showPreview ? 0 : compact ? 7 : stacked ? 8 : 9;
  const chromeRows = compact ? 10 : 11;
  const topSectionHeight = Math.max(stacked ? 16 : 12, rows - chromeRows - previewHeight);

  let listWidth = stacked ? contentWidth : Math.max(50, Math.min(Math.floor(contentWidth * 0.5), contentWidth - 40));
  let detailWidth = stacked ? contentWidth : Math.max(34, contentWidth - listWidth - 2);

  if (screenMode === "settings") {
    listWidth = contentWidth;
    detailWidth = contentWidth;
  } else if (viewMode === "detail") {
    listWidth = stacked ? contentWidth : 0;
    detailWidth = contentWidth;
  } else if (viewMode === "sessions") {
    listWidth = contentWidth;
    detailWidth = stacked ? contentWidth : 0;
  }

  const listInnerWidth = Math.max(20, listWidth - 4);
  const detailInnerWidth = Math.max(24, detailWidth - 4);
  const previewInnerWidth = Math.max(26, columns - 6);
  const listHeight =
    screenMode === "settings"
      ? topSectionHeight
      : viewMode === "detail"
        ? 0
        : stacked
          ? viewMode === "sessions"
            ? topSectionHeight
            : Math.max(8, Math.floor((topSectionHeight - 1) * 0.42))
          : topSectionHeight;
  const detailHeight =
    screenMode === "settings"
      ? topSectionHeight
      : viewMode === "sessions"
        ? 0
        : stacked
          ? viewMode === "detail"
            ? topSectionHeight
            : Math.max(8, topSectionHeight - listHeight - 1)
          : topSectionHeight;
  const sessionRowHeight = 3;
  const visibleSessionCount = Math.max(1, Math.floor(Math.max(3, listHeight - 3) / sessionRowHeight));
  const visiblePreviewCount = Math.max(3, previewHeight - 3);

  return {
    columns,
    rows,
    stacked,
    compact,
    mode: compact ? "compact" : stacked ? "stacked" : "full",
    listWidth,
    detailWidth,
    listInnerWidth,
    detailInnerWidth,
    previewInnerWidth,
    topSectionHeight,
    listHeight,
    detailHeight,
    previewHeight,
    visibleSessionCount,
    visiblePreviewCount
  };
}
