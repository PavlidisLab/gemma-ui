/**
 * Encode the current search + filters into a URL, and back.
 *
 * The Browser deliberately does NOT bind SearchSettings to the URL —
 * typing in the search box must not navigate, and the address bar only
 * reflects an *applied* query (see `useUrlInitial`). That is the right
 * behaviour to type against and the wrong one to share from: there has
 * never been a URL that reproduces what you are looking at.
 *
 * So the state is serialised on demand instead, into a single `?s=`
 * parameter. One opaque parameter rather than a dozen named ones
 * because the payload is a nested structure — an annotation carries a
 * category URI, a category label, a term URI and a term label, any of
 * which may be null — and flattening that into query params invites
 * links that decode into something subtly different from what was
 * shared.
 *
 * What is stored:
 *   - taxa and platforms as **ids only**. Both selectors render from
 *     the live list and match on id, so the labels come back on their
 *     own and needn't ride in the URL.
 *   - annotations and categories in full. These aren't recoverable
 *     from any list the page loads — the annotation tree is itself
 *     filtered — and the chips need the labels to render.
 *
 * Anything malformed decodes to null rather than throwing: a truncated
 * or hand-edited link should land you on an unfiltered Browser, not a
 * blank page.
 */

import type {
  AnnotationTerm,
  Category,
  SearchSettings,
} from "@/lib/types";

/** Wire shape. Keys are short because they end up in a URL. */
interface Payload {
  /** query */            q?: string;
  /** taxon ids */        tx?: number[];
  /** platform ids */     pf?: number[];
  /** technology types */ tt?: string[];
  /** annotations */      an?: TermTuple[];
  /** negative anns */    na?: TermTuple[];
  /** categories */       ca?: CatTuple[];
  /** negative cats */    nc?: CatTuple[];
  /** ignoreExcluded */   x?: 1;
}

/** [classUri, className, termUri, termName] — nulls preserved. */
type TermTuple = [string | null, string | null, string | null, string | null];
/** [classUri, className] */
type CatTuple = [string | null, string | null];

const termTuple = (t: AnnotationTerm): TermTuple => [
  t.classUri ?? null,
  t.className ?? null,
  t.termUri ?? null,
  t.termName ?? null,
];
const catTuple = (c: Category): CatTuple => [
  c.classUri ?? null,
  c.className ?? null,
];

/** True when the settings carry nothing worth sharing. */
export function isEmptySettings(s: SearchSettings): boolean {
  return (
    !s.query &&
    s.taxon.length === 0 &&
    s.platforms.length === 0 &&
    s.technologyTypes.length === 0 &&
    s.annotations.length === 0 &&
    s.negativeAnnotations.length === 0 &&
    s.categories.length === 0 &&
    s.negativeCategories.length === 0 &&
    !s.ignoreExcludedTerms
  );
}

export function encodeSearchSettings(s: SearchSettings): string {
  const p: Payload = {};
  if (s.query) p.q = s.query;
  if (s.taxon.length) p.tx = s.taxon.map((t) => t.id);
  if (s.platforms.length) p.pf = s.platforms.map((x) => x.id);
  if (s.technologyTypes.length) p.tt = [...s.technologyTypes];
  if (s.annotations.length) p.an = s.annotations.map(termTuple);
  if (s.negativeAnnotations.length) p.na = s.negativeAnnotations.map(termTuple);
  if (s.categories.length) p.ca = s.categories.map(catTuple);
  if (s.negativeCategories.length) p.nc = s.negativeCategories.map(catTuple);
  if (s.ignoreExcludedTerms) p.x = 1;
  return toBase64Url(JSON.stringify(p));
}

/** Decoded settings, or null if the parameter is not a link we wrote. */
export function decodeSearchSettings(
  raw: string,
): Partial<SearchSettings> | null {
  let p: unknown;
  try {
    p = JSON.parse(fromBase64Url(raw));
  } catch {
    return null;
  }
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const o = p as Record<string, unknown>;

  const out: Partial<SearchSettings> = {};
  if (typeof o.q === "string" && o.q) {
    out.query = o.q;
    out.currentQuery = o.q;
  }
  // Ids only — the selectors match on id and supply the labels.
  const tx = numbers(o.tx);
  if (tx.length) out.taxon = tx.map((id) => ({ id })) as SearchSettings["taxon"];
  const pf = numbers(o.pf);
  if (pf.length)
    out.platforms = pf.map((id) => ({ id })) as SearchSettings["platforms"];
  const tt = strings(o.tt);
  if (tt.length) out.technologyTypes = tt;

  const an = terms(o.an);
  if (an.length) out.annotations = an;
  const na = terms(o.na);
  if (na.length) out.negativeAnnotations = na;
  const ca = cats(o.ca);
  if (ca.length) out.categories = ca;
  const nc = cats(o.nc);
  if (nc.length) out.negativeCategories = nc;

  if (o.x === 1) out.ignoreExcludedTerms = true;
  return out;
}

// ─── validation helpers ───────────────────────────────────────────
// Every list is filtered rather than rejected wholesale: one bad entry
// in a long share shouldn't discard the rest of the filter.

const numbers = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => Number.isFinite(x)) : [];

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

const nullableString = (x: unknown): string | null =>
  typeof x === "string" ? x : null;

function terms(v: unknown): AnnotationTerm[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((t): t is unknown[] => Array.isArray(t) && t.length === 4)
    .map((t) => ({
      classUri: nullableString(t[0]),
      className: nullableString(t[1]),
      termUri: nullableString(t[2]),
      termName: nullableString(t[3]),
    }))
    // A term with neither a URI nor a name can't filter or render.
    .filter((t) => t.termUri !== null || t.termName !== null);
}

function cats(v: unknown): Category[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((c): c is unknown[] => Array.isArray(c) && c.length === 2)
    .map((c) => ({
      classUri: nullableString(c[0]),
      className: nullableString(c[1]),
    }))
    .filter((c) => c.classUri !== null || c.className !== null);
}

// ─── base64url ────────────────────────────────────────────────────
// Via TextEncoder/TextDecoder rather than btoa(str) directly: term
// labels carry non-Latin1 characters (α, µ, ±, –) and btoa throws on
// those. base64url so the value survives a URL without escaping.

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
