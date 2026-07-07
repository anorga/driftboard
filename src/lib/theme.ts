import { useCallback, useSyncExternalStore } from "react";

const KEY = "driftboard:theme";
const listeners = new Set<() => void>();

function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

export function useTheme(): { dark: boolean; toggle: () => void } {
  const dark = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    isDark,
  );
  const toggle = useCallback(() => {
    const next = !isDark();
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      // fine — theme just won't persist
    }
    listeners.forEach((l) => l());
  }, []);
  return { dark, toggle };
}
