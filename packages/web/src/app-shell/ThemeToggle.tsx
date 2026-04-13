import type { ResolvedTheme, ThemeMode } from "./useThemePreference.js";

function glyphForMode(mode: ThemeMode): string {
  switch (mode) {
    case "light":
      return "☼";
    case "dark":
      return "☾";
    default:
      return "◐";
  }
}

export function ThemeToggle(props: {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      aria-label={props.label}
      className="icon-btn icon-btn--sm icon-btn--round icon-btn--bordered theme-toggle"
      data-theme-mode={props.mode}
      data-theme-resolved={props.resolvedTheme}
      onClick={props.onToggle}
      title={props.label}
      type="button"
    >
      <span aria-hidden="true" className="theme-toggle-glyph">
        {glyphForMode(props.mode)}
      </span>
    </button>
  );
}
