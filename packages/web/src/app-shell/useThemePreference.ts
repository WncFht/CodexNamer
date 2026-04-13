import * as React from "react";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "codexnamer-theme-mode";
export const THEME_CHANGE_EVENT = "codexnamer:themechange";

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "system";
  }

  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  } catch {
    return "system";
  }
}

export function useThemePreference() {
  const [mode, setMode] = React.useState<ThemeMode>(() => readStoredThemeMode());
  const [systemTheme, setSystemTheme] = React.useState<ResolvedTheme>(() => getSystemTheme());

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => {
      setSystemTheme(media.matches ? "dark" : "light");
    };

    updateSystemTheme();
    media.addEventListener("change", updateSystemTheme);
    return () => {
      media.removeEventListener("change", updateSystemTheme);
    };
  }, []);

  const resolvedTheme = mode === "system" ? systemTheme : mode;

  React.useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.themeMode = mode;
    root.style.colorScheme = resolvedTheme;

    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Ignore storage failures and keep the current in-memory selection.
    }

    window.dispatchEvent(
      new CustomEvent(THEME_CHANGE_EVENT, {
        detail: {
          mode,
          resolvedTheme,
        },
      }),
    );
  }, [mode, resolvedTheme]);

  const cycleMode = React.useCallback(() => {
    setMode((current) => {
      switch (current) {
        case "system":
          return "light";
        case "light":
          return "dark";
        default:
          return "system";
      }
    });
  }, []);

  return {
    mode,
    resolvedTheme,
    setMode,
    cycleMode,
  };
}
