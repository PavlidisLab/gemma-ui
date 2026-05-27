// Small shared helpers ported from src/lib/utils.js + a couple of extras.

import type { AnnotationTerm, Category } from "./types";

const numberFormat = new Intl.NumberFormat();
const percentFormatter = new Intl.NumberFormat(undefined, { style: "percent" });
const decimalFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export const formatNumber = (n: number): string => numberFormat.format(n);
export const formatPercent = (p: number): string => percentFormatter.format(p);
export const formatDecimal = (d: number | undefined | null): string =>
  d === undefined || d === null || Number.isNaN(d) ? "" : decimalFormatter.format(d);

/** Map of recognised scientific names → canonical lab-style common
 *  name. Gemma's data carries inconsistent ``taxon.commonName``:
 *  curated rows have proper common names ("human", "mouse"); GEO-
 *  imported rows have the scientific name in the common-name slot
 *  ("Homo sapiens"). Normalising at display time so the table reads
 *  consistently — the underlying data fix belongs in the importer
 *  (preload_runner.py). Per Paul 2026-05-27. */
const TAXON_COMMON_NAMES: Record<string, string> = {
  "homo sapiens": "human",
  "mus musculus": "mouse",
  "rattus norvegicus": "rat",
  "danio rerio": "zebrafish",
  "drosophila melanogaster": "fruit fly",
  "caenorhabditis elegans": "worm",
  "saccharomyces cerevisiae": "yeast",
  "saccharomyces cerevisiae s288c": "yeast",
  "schizosaccharomyces pombe": "fission yeast",
  "macaca mulatta": "rhesus macaque",
  "pan troglodytes": "chimpanzee",
  "gallus gallus": "chicken",
  "xenopus laevis": "frog",
  "xenopus tropicalis": "frog",
};

/** Render a taxon for display: prefer the common name; fall back to
 *  the scientific name. When the supplied "common name" is actually
 *  a known scientific name (the import-side bug), map it to the
 *  canonical short form. Always lowercased so the column reads
 *  uniformly. */
export function displayTaxon(
  t: { commonName?: string | null; scientificName?: string | null } | null | undefined,
): string {
  if (!t) return "";
  const raw = (t.commonName || t.scientificName || "").trim();
  if (!raw) return "";
  const canon = TAXON_COMMON_NAMES[raw.toLowerCase()];
  return canon ?? raw.toLowerCase();
}

/**
 * Compress a single string with gzip and base64-encode it. If the
 * compressed form is bigger than the original, return the original.
 * Used to compress long `filter=...` query params before sending.
 */
export async function compressArg(f: string): Promise<string> {
  if (f.length < 150) return f;
  const stream = new Blob([f]).stream().pipeThrough(new CompressionStream("gzip"));
  const reader = stream.getReader();
  let blob = "";
  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      // value is a Uint8Array — convert to a binary string for btoa
      let s = "";
      for (let i = 0; i < value.length; i++) s += String.fromCharCode(value[i]);
      blob += s;
    }
    if (Math.ceil(blob.length / 3) * 4 >= f.length) return f;
    if (done) return btoa(blob);
  }
}

/**
 * Compress an array-of-arrays filter (DNF) by joining with " or "
 * inside each clause and " and " between, then gzip+base64.
 */
export function compressFilter(filter: string[][]): Promise<string> {
  return compressArg(filter.map((c) => c.join(" or ")).join(" and "));
}

/** Stringify a filter without compression (for snippet display). */
export function filterToString(filter: string[][]): string {
  return filter.map((c) => c.join(" or ")).join(" and ");
}

/** Stable per-category identifier. */
export function getCategoryId(t: { classUri?: string | null; className?: string | null }): string | null {
  return t.classUri || t.className?.toLowerCase() || null;
}

/** Stable per-term identifier. */
export function getTermId(t: { termUri?: string | null; termName?: string | null }): string {
  return t.termUri || t.termName?.toLowerCase() || "";
}

/** Combined "category|term" id used by the annotation tree state. */
export const TERM_ID_SEP = "|";
export function getFullId(t: AnnotationTerm | Category): string {
  return `${getCategoryId(t)}${TERM_ID_SEP}${getTermId(t as AnnotationTerm)}`;
}

/** Escape a string for use in a RegExp literal. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Trigger a browser download of a blob. */
export function downloadAs(data: Blob, filename: string): void {
  const a = document.createElement("a");
  const url = URL.createObjectURL(data);
  try {
    a.setAttribute("href", url);
    a.setAttribute("download", filename);
    a.click();
  } finally {
    URL.revokeObjectURL(url);
    a.remove();
  }
}

/** Lightweight `<mark>`-wrap of search highlights returned by Gemma. */
export function highlight(text: string, fragments: string): string {
  // Gemma returns highlighted text using **...** as the marker. Convert
  // to <mark>...</mark>.
  if (!fragments) return text;
  return fragments
    .replaceAll(/\*\*(?=[^\s\p{P}])/gu, "<mark>")
    .replaceAll(/(?<=[^\s\p{P}])\*\*/gu, "</mark>");
}
