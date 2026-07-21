/**
 * Baseline factor-value detection for the read-only browse surfaces.
 *
 * Mirrors the curation UI's canonical set — ``BASELINE_TERM_LABELS`` in
 * ``apps/curation/src/features/design/mutations.ts`` plus the
 * ``baseline_role`` object list in ``generated/predicates.ts`` (both from
 * the Confluence "Curating-Baseline-Factor-Values" page). Kept as a small
 * local port rather than a cross-app import, matching how
 * ``OntologyTermChip`` / ``curie.ts`` port curation display conventions
 * into this app without acquiring a coupling to curation internals.
 *
 * These "reference subject role" / "reference substance role" style terms
 * are curation plumbing that marks a factor's control level — a browsing
 * user needn't see them. Display surfaces use this to collapse a baseline
 * FV to a plain "baseline" marker and to drop the role term from the flat
 * annotation list.
 *
 * Matched NARROWLY on purpose. The curation ``baseline_role`` list also
 * contains ``PATO_0000383`` ("female") and other terms that ARE
 * legitimate biological annotations; blanket-matching that whole URI set
 * would erase real values (e.g. BIOLOGICAL SEX → female). We match only
 * the unambiguous baseline-role labels + the URIs that never denote a
 * real biological value (the OBI roles + the EFO control / wild-type /
 * initial-time-point baselines) — PATO/sex URIs are deliberately excluded.
 */
const BASELINE_TERM_LABELS = new Set<string>([
  "control",
  "wild type genotype",
  "reference subject role",
  "reference substance role",
  "initial time point",
]);

// URI fragments that only ever mark a baseline level, so safe to match by
// URI regardless of label. PATO_0000383 (female) and other sex terms are
// intentionally NOT here — they are real annotation values.
const BASELINE_ROLE_URI_FRAGMENTS = [
  "OBI_0000220", // reference subject role
  "OBI_0000025", // reference substance role
  "EFO_0001461", // control
  "EFO_0005168", // wild type genotype
  "EFO_0004425", // initial time point
];

/** True when a term (by label and/or URI) is a baseline / reference-level
 *  placeholder rather than a real biological value. */
export function isBaselineTerm(
  label?: string | null,
  uri?: string | null,
): boolean {
  const l = (label ?? "").trim().toLowerCase();
  if (l && BASELINE_TERM_LABELS.has(l)) return true;
  if (uri) {
    for (const frag of BASELINE_ROLE_URI_FRAGMENTS) {
      if (uri.includes(frag)) return true;
    }
  }
  return false;
}
