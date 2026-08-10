import type { Factor, FactorValue, Statement } from "@/features/experiment/types";

/**
 * Mirror of Gemma's own baseline detector —
 * ``gemma-core/src/main/java/ubic/gemma/core/analysis/expression/diff/
 * BaselineSelection.java`` (``controlGroupTerms`` + ``controlGroupUris``).
 *
 * Gemma does NOT need an FV flagged ``is_baseline`` to run a DEA against
 * it. ``getBaselineLevels()`` takes an explicitly-marked FV first, then
 * falls back to the first FV whose statements carry one of the terms or
 * URIs below, and only picks arbitrarily when neither exists. So a
 * factor whose control level already says "reference substance role" —
 * or whose sex FV says "female" — has a baseline as far as every
 * downstream analysis is concerned, and asking the curator to mark one
 * is asking for work that changes nothing.
 *
 * This is a MIRROR, like ``targetIds.ts`` mirrors ``target_ids.py``:
 * the Java file is canonical, and divergence means the UI and the DEA
 * disagree about which level is the reference. Two lists exist in this
 * app for narrower jobs and are deliberately left alone —
 * ``BASELINE_TERM_LABELS`` (the five terms the guideline PRESCRIBES for
 * new work) and ``NON_CANONICAL_BASELINE_LABELS`` (the older wordings it
 * steers away from). Detection is wider than either; prescription is
 * not this file's job.
 *
 * Checked against the Java on 2026-08-10.
 */

/** ``controlGroupTerms``. Compared after ``normalizeBaselineTerm``:
 *  case-insensitive, underscores read as spaces, internal whitespace
 *  collapsed — Java does the same via ``normalizeSpace`` +
 *  ``CASE_INSENSITIVE_ORDER``. */
export const GEMMA_BASELINE_TERMS: ReadonlySet<string> = new Set([
  "baseline participant role",
  "baseline",
  "control diet",
  "control group",
  "control",
  "initial time point",
  "normal",
  "placebo",
  "reference subject role",
  "reference substance role",
  "to be treated with placebo role",
  "untreated",
  "wild type control",
  "wild type genotype",
  "wild type",
  // Gemma's comment: "alphabetically before male". Female is the
  // standard reference level for a biological-sex factor, which is why
  // a sex factor never needs a curator to mark one.
  "female",
  // Discouraged by the guideline, honoured by the detector. Free text
  // only — no ontology Gemma loads defines them, so they have no URI.
  "control role",
  "negative control role",
  "normal control group",
  "normal littermate",
  "normal littermates",
]);

/** ``controlGroupUris``. Retired/legacy namespaces included because
 *  imported designs still carry them. */
export const GEMMA_BASELINE_URIS: ReadonlySet<string> = new Set([
  "http://purl.obolibrary.org/obo/OBI_0000025", // reference substance role
  "http://purl.obolibrary.org/obo/OBI_0000143", // baseline participant role
  "http://purl.obolibrary.org/obo/OBI_0000220", // reference subject role
  "http://purl.obolibrary.org/obo/OBI_0000825", // to be treated with placebo role
  "http://purl.obolibrary.org/obo/OBI_0100046", // phosphate buffered saline
  "http://www.ebi.ac.uk/efo/EFO_0001461", // control
  "http://www.ebi.ac.uk/efo/EFO_0001674", // placebo
  "http://www.ebi.ac.uk/efo/EFO_0004425", // initial time point
  "http://www.ebi.ac.uk/efo/EFO_0005168", // wild type genotype
  "http://purl.obolibrary.org/obo/PATO_0000383", // female
  "http://purl.org/nbirn/birnlex/ontology/BIRNLex-Investigation.owl#birnlex_2201", // control group, old
  "http://mged.sourceforge.net/ontologies/MGEDOntology.owl#wild_type", // retired
  "http://ontology.neuinfo.org/NIF/DigitalEntities/NIF-Investigation.owl#birnlex_2001", // normal control group, retired
  "http://ontology.neuinfo.org/NIF/DigitalEntities/NIF-Investigation.owl#birnlex_2201", // control group, retired
]);

/** ``FORCED_BASELINE_VALUE_URI`` — an FV carrying `control` is the
 *  baseline ahead of any other candidate in the same factor. */
export const GEMMA_FORCED_BASELINE_URI =
  "http://www.ebi.ac.uk/efo/EFO_0001461";

/** ``normalizeTerm``: underscores → spaces, whitespace collapsed,
 *  compared case-insensitively. */
export function normalizeBaselineTerm(term: string | null | undefined): string {
  return (term || "").replace(/_/g, " ").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Does this label read as a control level to Gemma? */
export function isGemmaBaselineTerm(label: string | null | undefined): boolean {
  const k = normalizeBaselineTerm(label);
  return !!k && GEMMA_BASELINE_TERMS.has(k);
}

const termMatches = isGemmaBaselineTerm;

function uriMatches(uri: string | null | undefined): boolean {
  return !!uri && GEMMA_BASELINE_URIS.has(uri.trim());
}

/** ``isBaselineCondition(Statement)``: a URI hit anywhere, or a
 *  free-text hit where that position carries no URI. A position WITH a
 *  URI is judged on the URI alone — Java never falls back to the label
 *  there, so neither do we. */
function statementIsBaseline(s: Statement): boolean {
  if (uriMatches(s.subject?.uri) || uriMatches(s.object?.uri)) return true;
  if (!s.subject?.uri && termMatches(s.subject?.label)) return true;
  if (!s.object?.uri && termMatches(s.object?.label)) return true;
  return false;
}

/** Would Gemma treat this FV as a baseline WITHOUT the curator marking
 *  it? ``is_baseline`` is deliberately not consulted: this answers "is
 *  marking it necessary", and the caller already knows the flag.
 *
 *  Continuous FVs (those carrying a measurement) are excluded, matching
 *  the ``getMeasurement() != null`` short-circuit. */
export function gemmaAutoDetectsBaseline(fv: FactorValue): boolean {
  if (fv.numeric_value != null) return false;
  if (fv.statements.some(statementIsBaseline)) return true;
  // ``controlGroupTerms.contains(factorValue.getValue())`` — the FV's
  // own rendered value, for FVs that carry no statements at all.
  return termMatches(fv.free_text_label);
}

/** ``isForcedBaseline`` — the `control` URI on any statement position. */
export function gemmaForcesBaseline(fv: FactorValue): boolean {
  return fv.statements.some(
    (s) =>
      s.subject?.uri === GEMMA_FORCED_BASELINE_URI ||
      s.object?.uri === GEMMA_FORCED_BASELINE_URI,
  );
}

/** The term that made an FV read as a baseline, for curator-facing
 *  copy ("female is Gemma's baseline here"). Null when nothing matched. */
export function gemmaBaselineTermOf(fv: FactorValue): string | null {
  if (fv.numeric_value != null) return null;
  for (const s of fv.statements) {
    for (const pos of [s.subject, s.object]) {
      if (!pos) continue;
      if (uriMatches(pos.uri)) return pos.label || null;
      if (!pos.uri && termMatches(pos.label)) return pos.label;
    }
  }
  if (termMatches(fv.free_text_label)) return fv.free_text_label;
  return null;
}

export interface AutoBaselineFv {
  fv_id: number;
  /** What the curator sees on the FV. */
  label: string;
  /** The term Gemma recognised. */
  matched: string;
}

/** Every FV in the factor that Gemma would pick up on its own, in
 *  factor order — the same order ``getBaselineLevels`` iterates, so the
 *  first entry is the one it would land on (a forced `control` FV
 *  outranks the rest, matching the Java). */
export function gemmaAutoBaselineFvs(factor: Factor): AutoBaselineFv[] {
  const found: AutoBaselineFv[] = [];
  for (const fv of factor.factor_values) {
    if (!gemmaAutoDetectsBaseline(fv)) continue;
    found.push({
      fv_id: fv.id,
      label: fv.free_text_label,
      matched: gemmaBaselineTermOf(fv) ?? fv.free_text_label,
    });
  }
  const forcedIdx = found.findIndex((f) =>
    factor.factor_values.some(
      (fv) => fv.id === f.fv_id && gemmaForcesBaseline(fv),
    ),
  );
  if (forcedIdx > 0) {
    const [forced] = found.splice(forcedIdx, 1);
    found.unshift(forced);
  }
  return found;
}
