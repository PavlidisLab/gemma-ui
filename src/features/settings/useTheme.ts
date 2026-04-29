import { useEffect, useState } from "react";

/**
 * Theme preference. ``"system"`` follows the OS-level
 * ``prefers-color-scheme`` media query and re-applies when it
 * changes; ``"light"`` / ``"dark"`` are explicit overrides.
 */
export type ThemePref = "light" | "dark" | "system";

const STORAGE_KEY = "gemma-curation-theme";

function readPref(): ThemePref {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/**
 * Resolve a stored preference to a concrete light / dark verdict
 * and apply it to ``<html>``. Tailwind's ``darkMode: "class"``
 * keys off ``html.dark``, so flipping the class is enough.
 */
export function applyTheme(pref: ThemePref): void {
  if (typeof document === "undefined") return;
  const dark = pref === "dark" || (pref === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

/**
 * Initialise theme synchronously before React mounts. Called once
 * from ``main.tsx`` so the first paint already reflects the
 * curator's saved preference (avoids a white-flash on hard
 * reload).
 */
export function initTheme(): void {
  applyTheme(readPref());
}

/**
 * React hook for the gear-menu. Persists changes to localStorage
 * and re-applies if the OS dark-mode flips while ``"system"`` is
 * selected.
 */
export function useTheme(): {
  pref: ThemePref;
  setPref: (next: ThemePref) => void;
} {
  const [pref, setPref] = useState<ThemePref>(() => readPref());

  useEffect(() => {
    applyTheme(pref);
    try {
      window.localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // Storage unavailable (private browsing, quota) — accept the
      // ephemeral state. The class toggle still works.
    }
  }, [pref]);

  // Listen to OS theme changes only while "system" is selected;
  // explicit light / dark choices ignore the OS.
  useEffect(() => {
    if (pref !== "system") return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  return { pref, setPref };
}
