/**
 * localStorage-persisted cache for per-URI ontology term lookups.
 *
 * The CuriePopover resolves a term's label / definition / parents from
 * Gemma (``/annotations/term``) or, on a curator click, OLS. Those
 * results are effectively immutable — an ontology term's definition
 * doesn't change between sessions — so re-fetching them on every page
 * load (or every popover reopen after the in-memory TanStack cache is
 * GC'd) is wasted work and, for OLS, a wasted curator click.
 *
 * This is a deliberately tiny, dependency-free persistence layer
 * (no ``@tanstack/query-persist-client`` — keeping the Docker
 * named-volume dep surface unchanged, see project_docker_dev_environment):
 * the term hooks write successful results here and seed TanStack's
 * ``initialData`` from it. Entries older than ``TERM_CACHE_TTL_MS``
 * are ignored on read (and lazily overwritten on the next fetch).
 *
 * Only NON-null results are persisted. A "not found" is never cached —
 * Gemma's ontology coverage grows over time, so a term that misses
 * today should be re-tried tomorrow rather than pinned as absent.
 */
import type { AnnotationTermDetail } from "@/api/annotations";

/** 24h — ontology definitions barely move; Design review 2026-06-19 ("can have
 *  a ttl of like 24 hours if not more"). Bump freely if curators want
 *  longer-lived caching. */
export const TERM_CACHE_TTL_MS = 1000 * 60 * 60 * 24;

type TermSource = "gemma" | "ols" | "ncbi";

interface StoredEntry {
  /** Epoch ms when the entry was written. */
  ts: number;
  data: AnnotationTermDetail;
}

// What's stored is the PARSE OUTPUT, and a within-TTL entry seeds
// ``initialDataUpdatedAt`` — so it counts as fresh and suppresses the
// refetch. A change to how a payload is parsed therefore does not
// reach a curator who has opened that term in the last 24h, and no
// amount of reloading helps: the fix is to retire the generation.
//
// v2 (2026-06-21): term-detail shape grew ``parents: TermRef[]`` (was
// ``string[]``), plus ``synonyms`` / ``alternativeIds`` /
// ``ontologyVersion``. Bumping the prefix retired v1 entries so a
// stale ``parents: string[]`` record couldn't reach the new render.
// v3 (2026-08-23): ``normalizeSynonyms`` moved the recognisable names
// ahead of the nomenclature and deduped the IUPAC string ChEBI ships
// twice — both at parse time, so a v2 entry pins the old order.
const KEY_PREFIX = "gemma.termCache.v3";

function storageKey(source: TermSource, uri: string): string {
  return `${KEY_PREFIX}:${source}:${uri}`;
}

/** Read a cached term detail, or null when absent / expired / malformed.
 *  ``updatedAt`` lets the caller feed TanStack's ``initialDataUpdatedAt``
 *  so a within-TTL entry counts as fresh and suppresses the refetch. */
export function readTermCache(
  source: TermSource,
  uri: string | null | undefined,
): { data: AnnotationTermDetail; updatedAt: number } | null {
  if (!uri || typeof localStorage === "undefined") return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey(source, uri));
  } catch {
    return null; // storage disabled / private mode
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredEntry;
    if (
      !parsed ||
      typeof parsed.ts !== "number" ||
      !parsed.data ||
      typeof parsed.data !== "object"
    ) {
      return null;
    }
    // Cannot call Date.now() in some sandboxed contexts; guard via a
    // try so a missing clock degrades to "always fresh enough to show".
    const now = Date.now();
    if (now - parsed.ts > TERM_CACHE_TTL_MS) return null;
    return { data: parsed.data, updatedAt: parsed.ts };
  } catch {
    return null;
  }
}

/** Persist a successful term lookup. No-op for null data or when
 *  storage is unavailable. */
export function writeTermCache(
  source: TermSource,
  uri: string | null | undefined,
  data: AnnotationTermDetail | null,
): void {
  if (!uri || !data || typeof localStorage === "undefined") return;
  try {
    const entry: StoredEntry = { ts: Date.now(), data };
    localStorage.setItem(storageKey(source, uri), JSON.stringify(entry));
  } catch {
    // Quota exceeded / disabled — caching is best-effort.
  }
}
