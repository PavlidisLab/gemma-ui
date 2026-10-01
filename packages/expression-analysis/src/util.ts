import { useEffect, useState } from "react";

/** Debounce a rapidly-changing value (e.g. a search input) — returns the
 *  latest value only after it has stayed unchanged for `ms` milliseconds. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** ``http://purl.obolibrary.org/obo/GO_0006915`` → ``GO:0006915``. Pass
 *  through unchanged when it isn't a GO PURL/underscore form. */
export function toGoCurie(uri: string): string {
  const m = uri.match(/GO[_:](\d+)\s*$/);
  return m ? `GO:${m[1]}` : uri;
}

/** Render ``http://purl.obolibrary.org/obo/GO_0006915`` as ``GO:0006915``
 *  for compact display — same rule as {@link toGoCurie} without the
 *  "leave everything else alone" guard, for pure labelling contexts. */
export function shortenGoUri(uri: string): string {
  const m = uri.match(/GO_(\d+)/);
  return m ? `GO:${m[1]}` : uri;
}

/**
 * Maps a CURIE (e.g. ``UBERON:0034920``) to a clickable full URL.
 * Returns full URLs unchanged. Returns ``null`` for empty input.
 * Unknown prefixes fall back to an OLS search so a click still goes
 * somewhere useful.
 */
const CURIE_TO_URL_PREFIX: Record<string, string> = {
  UBERON: "http://purl.obolibrary.org/obo/UBERON_",
  MONDO: "http://purl.obolibrary.org/obo/MONDO_",
  EFO: "http://www.ebi.ac.uk/efo/EFO_",
  PATO: "http://purl.obolibrary.org/obo/PATO_",
  OBI: "http://purl.obolibrary.org/obo/OBI_",
  CL: "http://purl.obolibrary.org/obo/CL_",
  CHEBI: "http://purl.obolibrary.org/obo/CHEBI_",
  HP: "http://purl.obolibrary.org/obo/HP_",
  GO: "http://purl.obolibrary.org/obo/GO_",
  RO: "http://purl.obolibrary.org/obo/RO_",
  BFO: "http://purl.obolibrary.org/obo/BFO_",
  TGEMO: "http://gemma.msl.ubc.ca/ont/TGEMO_",
  NCBITaxon: "http://purl.obolibrary.org/obo/NCBITaxon_",
};

export function curieToUrl(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (/^https?:\/\//i.test(uri)) return uri;
  const m = uri.match(/^([A-Za-z][A-Za-z0-9]*):(.+)$/);
  if (m) {
    const prefix = CURIE_TO_URL_PREFIX[m[1]];
    if (prefix) return `${prefix}${m[2]}`;
    return `https://www.ebi.ac.uk/ols4/search?q=${encodeURIComponent(uri)}`;
  }
  return uri;
}

/**
 * Shorten a label from the MIDDLE, keeping its head and its tail —
 * tail-truncation drops exactly the part that tells two sibling labels
 * apart (e.g. two timepoints of the same treatment). Returns the string
 * unchanged when it already fits.
 */
export function middleEllipsis(s: string, max = 44): string {
  const str = (s ?? "").trim();
  if (max <= 1 || str.length <= max) return str;
  const budget = max - 1;
  const head = Math.ceil(budget * 0.6);
  const tail = budget - head;
  return tail > 0
    ? `${str.slice(0, head).trimEnd()}…${str.slice(str.length - tail).trimStart()}`
    : `${str.slice(0, head).trimEnd()}…`;
}

const BASELINE_TERM_LABELS = new Set<string>([
  "control",
  "wild type genotype",
  "reference subject role",
  "reference substance role",
  "initial time point",
  "baseline participant role",
  "control group",
  "control role",
  "normal control group",
  "negative control role",
  "normal littermate",
  "normal littermates",
]);

const BASELINE_ROLE_URI_FRAGMENTS = [
  "OBI_0000220",
  "OBI_0000025",
  "EFO_0001461",
  "EFO_0005168",
  "EFO_0004425",
  "OBI_0000143",
];

/** True when a term (by label and/or URI) is a baseline / reference-level
 *  placeholder rather than a real biological value. Ported from
 *  apps/browser's `lib/baseline.ts` (itself a port of the curation app's
 *  canonical baseline-term set) — see that file for the full rationale. */
export function isBaselineTerm(
  label?: string | null,
  uri?: string | null,
): boolean {
  const l = (label ?? "").trim().toLowerCase().replace(/_/g, " ");
  if (l && BASELINE_TERM_LABELS.has(l)) return true;
  if (uri) {
    for (const frag of BASELINE_ROLE_URI_FRAGMENTS) {
      if (uri.includes(frag)) return true;
    }
  }
  return false;
}
