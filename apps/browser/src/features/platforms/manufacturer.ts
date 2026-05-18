/**
 * Manufacturer derivation for a Gemma platform.
 *
 * Manufacturer isn't a first-class field on the platform REST shape,
 * but it's the most useful filter facet on the platforms page. We
 * sniff it from the platform's ``name`` (or ``shortName``) using a
 * small list of prefix patterns. Anything we don't recognise lands
 * under "Other" — the filter still works, the bucket is just less
 * informative.
 *
 * Keep this list sorted by approximate corpus share so the high-
 * volume manufacturers (Affymetrix, Illumina, Agilent) are the
 * first checks, not the regex backtrack tail.
 */

import type { Platform } from "@/lib/types";

/** Patterns search the whole name (case-insensitive, word-bounded)
 *  rather than anchoring at start — many Gemma platform names lead
 *  with a bracketed GEO accession (``[RAE230B] Affymetrix Rat …``)
 *  so a start-anchored match silently misses those. Order matters
 *  only as a tiebreaker; the first match wins for names containing
 *  multiple manufacturer tokens, so list the high-confidence /
 *  high-volume vendors first. */
const MANUFACTURER_PATTERNS: Array<{ name: string; test: RegExp }> = [
  { name: "Affymetrix",     test: /\b(affymetrix|affy)\b/i },
  { name: "Illumina",       test: /\b(illumina)\b/i },
  { name: "Agilent",        test: /\b(agilent)\b/i },
  { name: "NimbleGen",      test: /\b(roche\s+nimblegen|nimblegen)\b/i },
  { name: "ABI / SOLiD",    test: /\b(applied\s+biosystems|abi(?!\w)|solid)\b/i },
  { name: "GE / CodeLink",  test: /\b(ge\s+healthcare|codelink|amersham)\b/i },
  { name: "Operon",         test: /\b(operon)\b/i },
  { name: "Stanford / SMD", test: /\b(stanford|brown\s+lab|smd)\b/i },
  { name: "Generic / custom", test: /\b(generic|custom)\b/i },
];

/** Returns the inferred manufacturer label for a platform. Always
 *  returns something — "Other" when no pattern matches. Strips a
 *  leading ``[ACCESSION]`` bracket prefix before matching so it
 *  doesn't poison the search.
 *
 *  This whole thing is a client-side hack — there's no
 *  ``manufacturer`` field on the Platform REST entity today (full
 *  or list shape). When the backend ships one (ask filed in the
 *  TODO at the top of useGemmaSummary), drop the heuristic and read
 *  the field directly. */
export function manufacturerOf(p: Platform): string {
  const raw = (p.name || p.shortName || "").trim();
  if (!raw) return "Unknown";
  // Strip leading "[XXX] " bracket-prefixes that GEO-imported names
  // often carry. The token inside the bracket is the GEO accession
  // and never the manufacturer.
  const haystack = raw.replace(/^\[[^\]]+\]\s*/, "");
  for (const { name, test } of MANUFACTURER_PATTERNS) {
    if (test.test(haystack)) return name;
  }
  return "Other";
}

/** Build a counted manufacturer list from a platform set, sorted by
 *  count descending. Used to populate the left-rail filter facet. */
export function manufacturerCounts(
  platforms: Platform[],
): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const p of platforms) {
    const m = manufacturerOf(p);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
