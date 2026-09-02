/**
 * Cross-app link helpers — mirror of the curation app's
 * ``lib/appLinks.ts``. Browser and curation are separate vite
 * builds on different origins; the shared top bar needs a stable
 * URL into the curation app.
 *
 * Resolution:
 *   1. ``VITE_CURATION_URL`` build-time override.
 *   2. Local-mode dev default (``http://localhost:5175``).
 */

const CURATION_URL: string =
  (import.meta.env.VITE_CURATION_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://localhost:5175";

/** Absolute URL into the curation app. ``path`` defaults to the
 *  curator dashboard (the hash-router landing). */
export function curationUrl(path: string = "/#/"): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${CURATION_URL}${p}`;
}

/** Browse Gemma for datasets carrying this annotation term, with the
 *  term arriving SELECTED in the annotation facet.
 *
 * 🛑 Not a free-text query. `/browser/q/$query` puts the raw string in
 * the search box and leaves the facet unticked, so the reader lands on
 * a URI they did not type and cannot see which term produced the list
 * (Paul, 2026-09-01: "not checked and term not visible here").
 * `BrowserPage` already seeds a selected annotation from
 * `?annotationUri` / `?annotationLabel`, scoped by `?categoryUri` /
 * `?categoryLabel` — pass the category and the side panel shows the
 * term ticked under it rather than floating loose.
 *
 * 🛑 Params, not a hand-rolled `#/browser?…` href. Under a sub-path
 * mount a literal hash href skips the mount prefix; the router
 * re-attaches it.
 *
 * 🛑 Offer this for an annotation's own TERM, never for a statement's
 * object. The filter it builds matches `allCharacteristics.valueUri`,
 * which is where a term sits when it IS the annotation — an object
 * lives elsewhere on the row. Measured on gemma2 2026-09-01:
 * `GENO_0000135` (Heterozygous) answers 13 datasets as a value while
 * being the object of far more genotype statements than that. The link
 * would work and report the wrong set.
 *
 * Returns null for a term with no URI — an ungrounded label has
 * nothing to resolve. */
export function browseTermLink(term: {
  uri: string | null | undefined;
  label?: string | null;
  categoryUri?: string | null;
  categoryLabel?: string | null;
}): {
  to: "/browser";
  search: Record<string, string>;
} | null {
  const uri = term.uri?.trim();
  if (!uri) return null;
  const search: Record<string, string> = { annotationUri: uri };
  const label = term.label?.trim();
  if (label) search.annotationLabel = label;
  const categoryUri = term.categoryUri?.trim();
  if (categoryUri) search.categoryUri = categoryUri;
  const categoryLabel = term.categoryLabel?.trim();
  if (categoryLabel) search.categoryLabel = categoryLabel;
  return { to: "/browser", search };
}
