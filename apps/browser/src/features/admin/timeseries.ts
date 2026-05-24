/**
 * Tiny client-side ring-buffer + polling helper for the Systems
 * Monitoring page. Each `useTimeseries(key, value, opts)` call
 * threads a numeric sample into a per-key buffer; the returned
 * array is the last `windowMs` worth of samples that the
 * caller can hand to a Sparkline.
 *
 * Why not pull from useQuery's history? react-query keeps only the
 * latest result. We need a windowed series, so we maintain our own
 * tiny store outside react state and notify subscribers on push.
 *
 * Lifecycle:
 *   - Push happens on every render where `value !== null/undefined`
 *     (which means the caller's underlying useQuery refetched).
 *   - Stale samples (older than `windowMs`) get pruned on push.
 *   - Buffer state survives across rerenders of the same key; it's
 *     a module-level singleton.
 *
 * Suggested polling cadences per metric are documented in
 * `~/Dev/eclipseworkspace/Gemma/handoffs/HANDOFF_SYSTEMS_MONITORING_UI.md`.
 * That handoff lives outside this repo; the caller is expected to
 * set its own `refetchInterval` on the source query.
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";

export interface Sample {
  /** ms since epoch. */
  t: number;
  v: number;
}

/** Default rolling window — 15 minutes is generous enough that a
 *  curator landing on the page sees a meaningful trend even on the
 *  longest 60s-cadence series. */
export const DEFAULT_WINDOW_MS = 15 * 60_000;

interface Buffer {
  samples: Sample[];
  listeners: Set<() => void>;
}

const buffers = new Map<string, Buffer>();

function getOrCreate(key: string): Buffer {
  let b = buffers.get(key);
  if (!b) {
    b = { samples: [], listeners: new Set() };
    buffers.set(key, b);
  }
  return b;
}

function notify(b: Buffer): void {
  for (const l of b.listeners) l();
}

function push(key: string, value: number, windowMs: number): void {
  const b = getOrCreate(key);
  const now = Date.now();
  b.samples = b.samples.filter((s) => now - s.t <= windowMs);
  b.samples.push({ t: now, v: value });
  notify(b);
}

/** Returns the current ring buffer for `key`, subscribed to
 *  updates. Caller pushes new samples by passing a fresh `value`
 *  each render. */
export function useTimeseries(
  key: string,
  value: number | null | undefined,
  opts: { windowMs?: number } = {},
): Sample[] {
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  useEffect(() => {
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    push(key, value, windowMs);
  }, [key, value, windowMs]);
  return useSyncExternalStore(
    (cb) => {
      const b = getOrCreate(key);
      b.listeners.add(cb);
      return () => b.listeners.delete(cb);
    },
    () => getOrCreate(key).samples,
    () => getOrCreate(key).samples,
  );
}

/** Pause polling on hidden tabs. Apply via the parent page so every
 *  underlying useQuery's refetchInterval naturally goes idle when
 *  the user switches away. Returns the document's current
 *  visibility — components can wire `enabled: !hidden` on their
 *  query opts if needed. */
export function usePageVisible(): boolean {
  const subscribe = (cb: () => void) => {
    document.addEventListener("visibilitychange", cb);
    return () => document.removeEventListener("visibilitychange", cb);
  };
  return useSyncExternalStore(
    subscribe,
    () => !document.hidden,
    () => true,
  );
}

/** Derive {min, max} from a sample window — used by Sparkline for
 *  y-axis auto-fit when no explicit domain is provided. Adds a tiny
 *  pad so the line doesn't kiss the top/bottom of the box. */
export function domainOf(samples: Sample[]): [number, number] {
  if (samples.length === 0) return [0, 1];
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of samples) {
    if (s.v < lo) lo = s.v;
    if (s.v > hi) hi = s.v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) {
    const eps = Math.max(1, Math.abs(lo) * 0.05);
    return [lo - eps, hi + eps];
  }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

/** Number formatter tuned for the dashboard. Picks short SI
 *  prefixes (k, M, G) so a heap of 7.2G shows as "7.2 GB" not
 *  "7,200,000,000". Bytes-specific variant is `fmtBytes`. */
export function fmtNumber(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(digits)}G`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(digits)}k`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(digits);
}

export function fmtBytes(v: number): string {
  if (!Number.isFinite(v)) return "?";
  const abs = Math.abs(v);
  if (abs >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GB`;
  if (abs >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  if (abs >= 1024) return `${(v / 1024).toFixed(1)} kB`;
  return `${v} B`;
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Compact relative-time formatter ("5s ago" / "12m ago"). Falls
 *  back to absolute ISO date for anything past 24h. */
export function fmtRelative(iso?: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const dt = Date.now() - then;
  const sec = Math.round(dt / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(iso).toLocaleString();
}

/** Hibernate stats counters are monotonic — to get a meaningful
 *  trend, plot the per-tick delta instead of the cumulative count.
 *  This wraps the buffer pattern with delta computation. */
export function useDeltaTimeseries(
  key: string,
  value: number | null | undefined,
  opts: { windowMs?: number } = {},
): Sample[] {
  // Track the previous cumulative count in a module-scoped store so
  // it survives rerenders.
  const lastKey = `__last:${key}`;
  const last = lastValues.get(lastKey);
  const delta =
    value !== null && value !== undefined && Number.isFinite(value)
      ? last === undefined
        ? 0
        : Math.max(0, value - last)
      : null;
  useEffect(() => {
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      lastValues.set(lastKey, value);
    }
  }, [lastKey, value]);
  return useTimeseries(key, delta, opts);
}

const lastValues = new Map<string, number>();

/** Memoize a sparse Sample[] so React's reference equality holds
 *  across renders when nothing new arrived. Useful when a child
 *  chart memoizes off the array reference. */
export function useStableSamples(samples: Sample[]): Sample[] {
  return useMemo(
    () => samples,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [samples.length, samples[samples.length - 1]?.t],
  );
}
