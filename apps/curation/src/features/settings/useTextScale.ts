import { useEffect, useState } from "react";

/**
 * Curator-tunable reasoning text size. A single scale (percent) that
 * multiplies the finding-card reasoning typography (labels, verdicts,
 * rationale) so the curator can fine-tune density to taste. Applied as
 * the CSS custom property ``--reasoning-scale`` on ``<html>``; the
 * reasoning size classes (``rs-10`` / ``rs-11`` / ``rs-13`` in
 * index.css) read it via ``calc()``. Persisted to localStorage, same
 * pattern as ``useTheme``. Paul 2026-06-21.
 */
const STORAGE_KEY = "gemma-curation-reasoning-scale";

export const SCALE_MIN = 80;
export const SCALE_MAX = 150;
export const SCALE_DEFAULT = 100;
export const SCALE_STEP = 5;

function clampScale(n: number): number {
  if (!Number.isFinite(n)) return SCALE_DEFAULT;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(n / SCALE_STEP) * SCALE_STEP));
}

function readScale(): number {
  if (typeof window === "undefined") return SCALE_DEFAULT;
  const v = Number(window.localStorage.getItem(STORAGE_KEY));
  return v > 0 ? clampScale(v) : SCALE_DEFAULT;
}

/** Write ``--reasoning-scale`` (a unitless multiplier) onto ``<html>``. */
export function applyTextScale(scale: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    "--reasoning-scale",
    String(clampScale(scale) / 100),
  );
}

/** Apply the saved scale before React mounts (no first-paint jump). */
export function initTextScale(): void {
  applyTextScale(readScale());
}

export function useTextScale(): {
  scale: number;
  setScale: (next: number) => void;
} {
  const [scale, setScaleState] = useState<number>(() => readScale());

  useEffect(() => {
    applyTextScale(scale);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(scale));
    } catch {
      // Storage unavailable — keep the live CSS var; it just won't
      // survive a reload.
    }
  }, [scale]);

  return { scale, setScale: (n) => setScaleState(clampScale(n)) };
}
