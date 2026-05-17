import { useEffect, useState } from "react";

/**
 * Returns ``value`` delayed by ``ms`` milliseconds. The most
 * recent value wins — earlier pending updates are cancelled
 * on every change. Used by typeahead inputs to throttle
 * remote calls.
 */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
