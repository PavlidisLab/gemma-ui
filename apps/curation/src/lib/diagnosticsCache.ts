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
 * matrix is quadratic in sample count, and localStorage is ~5 MB for
 * the whole origin, shared with the term cache and every draft — a
 * handful of large datasets would evict things that matter far more
 * than a diagnostics panel that costs one refetch.
 *
 * 🛑 **Measure the DECOMPRESSED string, which is what goes in here.**
 * The route is `@GZIP` and `curl -w '%{size_download}'` reports the
 * compressed bytes, so the obvious measurement is the wrong one by 3-5x
 * — and the gap widens exactly where it matters, because rounded
 * numbers compress far better than full-precision ones.
 *
 * Measured on gemma2 `db182e86a6`, `len(json.dumps(...))` on the parsed
 * body. Sample correlation: 8.7 KB at 34 samples, 76 KB at 103, 527 KB
 * at 278 — about 7 bytes a cell. Mean-variance is the big one: 451 KB
 * at 11,776 probes, 883 KB at 22,283, 1.6 MB at 41,015, and 4
 * significant digits takes those to roughly 346 KB / 640 KB.
 *
 * 1 MB per entry covers the correlation matrix for all but the largest
 * datasets and mean-variance for most. It is deliberately not sized to
 * fit every mean-variance payload: gembro measured that 93% of those
 * points land on a pixel already painted, so server-side decimation
 * takes the whole scatter to ~1,500 points and the question stops being
 * about storage. Raising this further would be paying megabytes to
 * cache data that is about to stop being sent.
 *
 * (For contrast, the same three gzipped are 1.6 / 16 / 104 KB.
 * `db182e86a6`'s 3-decimal rounding cut the wire 5.6x and the stored
 * string only 2.7x. Both are real; only one is this constant's
 * business.)
 *
 * Above this an entry is simply not stored — the query still works, it
 * just re-fetches next reload, which is the pre-existing behaviour.
 */
const MAX_ENTRY_BYTES = 1024 * 1024;

/** Ceiling on what this cache holds in total, enforced before every
 *  write by evicting its own oldest entries.
 *
 *  🛑 The per-entry limit alone was never enough. localStorage's ~5 MB
 *  is one budget shared with the term cache and, more importantly, with
 *  curator DRAFTS — and a quota error does not politely land on the
 *  write that overflowed, it lands on whichever write comes next. An
 *  unbounded diagnostics cache would eventually be the reason someone's
 *  draft failed to save. Two megabytes is roughly two experiments'
 *  worth of panels; the rest of the origin stays theirs. */
const TOTAL_BUDGET_BYTES = 2 * 1024 * 1024;

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
    // Make room under our own budget first — an eviction we chose beats
    // a QuotaExceededError we caught, because the error might just as
    // easily have hit a draft.
    makeRoomFor(key, body.length);
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
    out.push({ key: k, ts: entryTimestamp(k) });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** An entry's write time, or 0 when it cannot be read — which sorts it
 *  first, so a corrupt entry is the first thing evicted. */
function entryTimestamp(key: string): number {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(key) ?? "{}",
    ) as StoredEntry<unknown>;
    return typeof parsed.ts === "number" ? parsed.ts : 0;
  } catch {
    return 0;
  }
}

/** Evict this cache's oldest entries until `incoming` bytes fit inside
 *  TOTAL_BUDGET_BYTES. The key being written is excluded from the tally
 *  and dropped first, so overwriting an entry costs its own size once
 *  rather than twice. */
function makeRoomFor(key: string, incoming: number): void {
  const entries = ownKeys().filter((e) => e.key !== key);
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
  let used = entries.reduce(
    (n, e) => n + (localStorage.getItem(e.key)?.length ?? 0),
    0,
  );
  for (const e of entries) {
    if (used + incoming <= TOTAL_BUDGET_BYTES) return;
    used -= localStorage.getItem(e.key)?.length ?? 0;
    try {
      localStorage.removeItem(e.key);
    } catch {
      // ignore
    }
  }
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
