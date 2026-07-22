import { useEffect, useState } from "react";

/** Debounce a rapidly-changing value (e.g. a search input) — returns the
 *  latest value only after it has stayed unchanged for `ms` milliseconds.
 *  Shared by the Visualize-tab gene picker and the /genes search box so
 *  both debounce their typeahead identically. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}
