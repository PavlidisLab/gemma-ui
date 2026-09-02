/**
 * localStorage-persisted cache for the four diagnostics payloads, plus
 * the tab's opt-in flag.
 *
 * Two separate problems, one module because they share a lifetime:
 *
 *  1. **The opt-in was component state.** `DiagnosticsPanel` held
 *     `useState(false)`, so navigating away unmounted it and the tab
 *     came back saying "Diagnostics are not loaded yet" — with the data
 *     still sitting in TanStack's cache. Nothing was refetched; the
 *     panel had simply forgotten it had asked.
 *  2. **The payloads died on reload.** TanStack's cache is in memory.
 *     A curator who reloads pays for four gemma-rest calls again, and
 *     the sample-correlation one is the heaviest thing the tab does.
 *
 * Same deliberately tiny, dependency-free approach as `termCache.ts`
 * (no `@tanstack/query-persist-client` — keeps the Docker named-volume
 * dep surface unchanged, see project_docker_dev_environment): the hooks
 * seed `initialData` from here and write successful results back.
 *
 * 🛑 **Everything is keyed by experiment id** so a per-experiment clear
 * is possible, the convention `paperDismissal.ts` set.
 */

/** 24h — Paul, 2026-09-01: "we should cache these anyway in browser
 *  local storage, at least for 24 hours or something". These are
 *  outputs of Gemma's preprocessor; they change when the dataset is
 *  reprocessed, which is not a thing that happens mid-session. */
export const DIAGNOSTICS_CACHE_TTL_MS = 1000 * 60 * 60 * 24;

/**
 * 🛑 Per-entry ceiling, and it is not theoretical. A sample-correlation
 * matrix is quadratic in sample count — measured on gemma2 2026-09-01,
 * decompressed JSON: 6.7 KB at 34 samples, 82 KB at 103, **577 KB at
 * 278**. localStorage is ~5 MB for the whole origin, shared with the
 * term cache and every draft. A handful of large datasets would evict
 * things that matter far more than a diagnostics panel that costs one
 * refetch.
 *
 * Above this an entry is simply not stored — the query still works, it
 * just re-fetches next reload, which is the pre-existing behaviour.
 */
const MAX_ENTRY_BYTES = 256 * 1024;

export type DiagnosticsKind =
  | "svd"
  | "sample-correlation"
  | "mean-variance"
  | "pc-loadings";

// What is stored is the PARSE OUTPUT, and a within-TTL entry seeds
// `initialDataUpdatedAt` — so it counts as fresh and suppresses the
// refetch. A change to how a payload is parsed therefore does not reach
// a curator who opened the tab in the last 24h, and no amount of
// reloading helps: the fix is to bump this prefix and retire the
// generation. Same trap termCache.ts documents.
const KEY_PREFIX = "gemma.diagnosticsCache.v1";
const OPT_IN_PREFIX = "gca:diagnostics-opted-in:";

function storageKey(
  kind: DiagnosticsKind,
  experimentId: number | string,
  variant?: string,
): string {
  const tail = variant ? `:${variant}` : "";
  return `${KEY_PREFIX}:${kind}:${experimentId}${tail}`;
}

interface StoredEntry<T> {
  /** Epoch ms when the entry was written. */
  ts: number;
  data: T;
}

/** Read a cached payload, or null when absent / expired / malformed.
 *  `updatedAt` lets the caller feed TanStack's `initialDataUpdatedAt`
 *  so a within-TTL entry counts as fresh and suppresses the refetch. */
export function readDiagnosticsCache<T>(
  kind: DiagnosticsKind,
  experimentId: number | string,
  variant?: string,
): { data: T; updatedAt: number } | null {
  try {
    const raw = localStorage.getItem(storageKey(kind, experimentId, variant));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredEntry<T>;
    // Validate on read — a forward schema drift or a hand-edited entry
    // must not reach a render (feedback_localstorage_validate_on_read).
    if (
      !parsed ||
      typeof parsed.ts !== "number" ||
      !Number.isFinite(parsed.ts) ||
      parsed.data === undefined
    ) {
      return null;
    }
    if (Date.now() - parsed.ts > DIAGNOSTICS_CACHE_TTL_MS) return null;
    return { data: parsed.data, updatedAt: parsed.ts };
  } catch {
    // Private mode, disabled storage, unparseable entry — all mean the
    // same thing to the caller: fetch it.
    return null;
  }
}

/** Persist a payload. Silently declines anything over the per-entry
 *  ceiling, and on a quota error drops this cache's oldest entries and
 *  retries once rather than leaving the store wedged. */
export function writeDiagnosticsCache<T>(
  kind: DiagnosticsKind,
  experimentId: number | string,
  data: T,
  variant?: string,
): void {
  try {
    const body = JSON.stringify({ ts: Date.now(), data } satisfies StoredEntry<T>);
    // Rough: JS strings are UTF-16 and most of this is ASCII digits, so
    // length is within a factor of the real cost. Precision is not what
    // the ceiling is for.
    if (body.length > MAX_ENTRY_BYTES) return;
    const key = storageKey(kind, experimentId, variant);
    try {
      localStorage.setItem(key, body);
    } catch {
      evictOldest(Math.max(1, countEntries() >> 1));
      try {
        localStorage.setItem(key, body);
      } catch {
        // Still no room. The panel refetches; nothing is broken.
      }
    }
  } catch {
    // Serialization or storage unavailable — caching is best-effort.
  }
}

/** Every key this cache owns, oldest first where a timestamp is
 *  readable (an unreadable one sorts first, so it is evicted first). */
function ownKeys(): { key: string; ts: number }[] {
  const out: { key: string; ts: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(`${KEY_PREFIX}:`)) continue;
    let ts = 0;
    try {
      ts = (JSON.parse(localStorage.getItem(k) ?? "{}") as StoredEntry<unknown>).ts ?? 0;
    } catch {
      ts = 0;
    }
    out.push({ key: k, ts });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

function countEntries(): number {
  return ownKeys().length;
}

function evictOldest(n: number): void {
  for (const { key } of ownKeys().slice(0, n)) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

/** Drop every cached diagnostic for one experiment. The id is embedded
 *  in the key precisely so this clear can be scoped, leaving other
 *  experiments alone. */
export function clearDiagnosticsCache(experimentId: number | string): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const isPayload =
        k.startsWith(`${KEY_PREFIX}:`) &&
        (k.endsWith(`:${experimentId}`) || k.includes(`:${experimentId}:`));
      if (isPayload || k === `${OPT_IN_PREFIX}${experimentId}`) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    // ignore
  }
}

// ─── the tab's opt-in flag ─────────────────────────────────────────

/** Has the curator already asked for diagnostics on this experiment?
 *
 *  Per experiment, not global: the gate exists to stop four gemma-rest
 *  calls firing on a tab switch, and walking to a different experiment
 *  is exactly when that cost is real again. It shares the payload
 *  cache's TTL by living and dying with `clearDiagnosticsCache`. */
export function hasDiagnosticsOptIn(experimentId: number | string): boolean {
  try {
    return localStorage.getItem(`${OPT_IN_PREFIX}${experimentId}`) === "1";
  } catch {
    return false;
  }
}

export function setDiagnosticsOptIn(experimentId: number | string): void {
  try {
    localStorage.setItem(`${OPT_IN_PREFIX}${experimentId}`, "1");
  } catch {
    // The gate falls back to per-mount state; nothing breaks.
  }
}
