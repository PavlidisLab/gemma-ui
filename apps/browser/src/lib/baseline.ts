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
  // The five canonical terms the curation guideline prescribes.
  "control",
  "wild type genotype",
  "reference subject role",
  "reference substance role",
  "initial time point",
  // Older wordings the guideline steers away from but which still mark
  // the control level. Detection is deliberately WIDER than the
  // guideline: a browsing reader should see "baseline" on a legacy
  // design just as on a freshly-curated one, and as of 2026-08-08
  // Gemma's DEA auto-assigns these too. Mirrors
  // ``NON_CANONICAL_BASELINE_LABELS`` in the curation app's
  // ``features/experiment/types.ts``.
  "baseline participant role",
  "control group",
  "control role",
  "normal control group",
  "negative control role",
  // Both numbers — Gemma's own detector carries the singular too.
  "normal littermate",
  "normal littermates",
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
  "OBI_0000143", // baseline participant role
];

// Gemma's own ``controlGroupUris`` also lists birnlex, MSIO, SIO and
// NCIT control-role terms. We deliberately do NOT mirror those: none of
// those ontologies are loaded in Gemma (stated in backend commit
// be7b55b8fe's handoff), so such a URI can't legitimately reach our
// data, and matching it would be dead weight that only creates
// false-positive surface — these fragments are matched with
// ``includes``, and a short token like ``SIO_001068`` is exactly the
// shape that goes wrong. Those labels still match as FREE TEXT via
// BASELINE_TERM_LABELS above, which is how they actually arrive.
// Only OBI and EFO terms are matched by URI, because those are the
// ontologies Gemma actually loads.

/** True when a term (by label and/or URI) is a baseline / reference-level
 *  placeholder rather than a real biological value. */
export function isBaselineTerm(
  label?: string | null,
  uri?: string | null,
): boolean {
  // Underscores read as spaces, matching Gemma's own normalization, so
  // ``Normal_Control_Group`` is recognised on both sides.
  const l = (label ?? "").trim().toLowerCase().replace(/_/g, " ");
  if (l && BASELINE_TERM_LABELS.has(l)) return true;
  if (uri) {
    for (const frag of BASELINE_ROLE_URI_FRAGMENTS) {
      if (uri.includes(frag)) return true;
    }
  }
  return false;
}

/** Is this factor value the baseline level?
 *
 *  Mirrors Gemma's own precedence (``BaselineSelection.java``, backend
 *  commit be7b55b8fe):
 *
 *   1. An explicit flag DECIDES, in both directions. ``true`` wins
 *      outright — nothing outranks a value the curator marked. ``false``
 *      excludes it even when its label is a control term.
 *   2. Only when the flag is ABSENT (the common case: it's best-effort
 *      and usually null on the design endpoint) do we fall back to
 *      reading the terms.
 *
 *  The false-excludes half is what a plain ``!!flag || terms`` misses:
 *  it would show "baseline" on a value the curator deliberately
 *  un-marked. Absent and false are therefore kept distinct. */
export function isBaselineFactorValue(
  flag: boolean | null | undefined,
  hasBaselineTerm: boolean,
): boolean {
  if (flag === true) return true;
  if (flag === false) return false;
  return hasBaselineTerm;
}
