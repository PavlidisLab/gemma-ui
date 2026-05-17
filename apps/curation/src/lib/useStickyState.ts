import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * ``useState`` that persists across navigations / reloads via
 * localStorage. Same call signature as ``useState`` — pass a stable
 * ``key`` and an initial value, get back ``[value, setter]``.
 *
 * JSON-encoded; never throws on malformed stored data — bad reads
 * fall back to ``defaultValue``. Writes silently no-op when
 * localStorage is disabled / full.
 *
 * Use for **view preferences** the curator expects to stay put as
 * they move between experiments (sort direction, "hide constant
 * columns" toggle, status filter, expanded checklist sections,
 * proposer tab choice). Don't use for transient UI state — modal
 * open/closed, dropdown popovers, per-row expanders that only
 * matter while the row is on screen.
 */
export function useStickyState<T>(
  key: string,
  defaultValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return defaultValue;
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // localStorage full / disabled / private mode — silently
      // drop. The value still works for the current session.
    }
  }, [key, value]);
  return [value, setValue];
}
