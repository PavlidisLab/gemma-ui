/**
 * `POST /validate-terms` — the proposer service's canonicaliser exposed
 * read-only, beside `POST /find-term`. Agents-side contract landed
 * 3c367f1; handoff
 * `CAB_TO_UIB_2026_08_13_VALIDATE_TERMS_IS_LIVE_FOUR_STATUSES_AS_SPECCED.md`.
 *
 * Read-only by design. It reports what a term's canonical form IS; it
 * never rewrites one. "Never fail to canonicalize" is a rule about what
 * the pipeline EMITS, and must not become "silently rewrite" on a
 * surface a curator is reading.
 */

import { useMutation } from "@tanstack/react-query";

import { api } from "./client";

/**
 * 🛑 Four statuses, and the split is what makes the check useful — do
 * not collapse this to a boolean.
 *
 * - `ok` — the stored label NAMES this term. Deliberately not
 *   byte-equality: case and punctuation are formatting, so `b cell`
 *   against CL_0000236 is `ok`. A mark nobody would act on costs more
 *   than it earns.
 * - `label_mismatch` — the URI resolves and the stored label is not
 *   any registered name for it. This is the case the feature exists
 *   for: `Hek293F` bound to EFO_0022515, which is `HEK-293S`.
 * - `non_canonical` — same term, non-preferred form: a registered
 *   synonym (`OCI-AML3` for `OCI-AML3 cell`), a CURIE, or EFO where
 *   CLO exists. The term is arguably right, so this is advisory.
 * - `obsolete` — the URI names a real term that upstream has
 *   deprecated. Advisory, not red: the annotation was correct when it
 *   was made and the term still means what it meant. What makes it
 *   worth a row is `replaced_by`, the successor the ontology itself
 *   declares. Landed agents-side 2026-08-16 on our ask
 *   (`CAB_TO_UIB_2026_08_16_OBSOLETE_VERDICT_LANDED.md`) — before it,
 *   every one of these was an `unknown` nobody could see.
 * - `unknown` — the ontology index cannot name this URI. **NOT an
 *   error, and not a finding.** It is silence: with no term name to
 *   compare against, the check simply didn't run on that pair. So it
 *   earns neither an inline mark nor a summary row, only a count in
 *   the tally; see `features/design/termValidation.ts`.
 *
 * 🛑 Gemma's own annotation categories must never surface as either
 * `unknown` or `obsolete`. The index carries live ontology classes, so
 * it cannot name `disease` / `EFO_0000408` (`obsolete_disease`
 * upstream) or `biological process` / `GO_0008150` — both perfectly
 * good annotations, and `EFO_0000408` is deprecated AND Gemma's live
 * disease category at the same time. The agents side now excludes
 * every published category URI itself, and `buildRun` holds the same
 * exclusion client-side against `/rest/v2/categories`
 * (`useCategories()`) for categories Gemma publishes that the static
 * table may lag on. Keyed on URI, never on label — the EFO label is
 * the obsolete one.
 */
export type TermValidationStatus =
  | "ok"
  | "label_mismatch"
  | "non_canonical"
  | "obsolete"
  | "unknown";

export interface TermValidationResult {
  /** Echoed verbatim from the request — our (label, URI) pair key. */
  id: string;
  status: TermValidationStatus;
  canonical_label?: string | null;
  canonical_uri?: string | null;
  detail?: string | null;
  synonyms?: string[] | null;
  /** The successor the ONTOLOGY declares for a deprecated term. Present
   *  on every verdict and empty except on `obsolete` — and empty there
   *  too when the source names no successor (the index-flag path can't
   *  carry one; the parquet has no `replaced_by` column). Empty means
   *  "deprecated, and choosing the replacement is a curation
   *  judgement" — never guess one. Optional here because an older
   *  agents build omits the fields entirely. */
  replaced_by_uri?: string | null;
  replaced_by_label?: string | null;
}

export interface ValidateTermsResponse {
  results: TermValidationResult[];
  /** Per-status tallies. Useful precisely when nothing is marked —
   *  it lets the surface say `{ok: 14, unknown: 2}` so "no marks"
   *  reads as "checked, clean" rather than "not checked". */
  counts?: Partial<Record<TermValidationStatus, number>>;
}

export interface ValidateTermsRequestItem {
  id: string;
  label: string;
  /** CURIE or IRI — the endpoint accepts both, which matters because
   *  the corpus contains both. */
  uri: string;
}

export async function validateTerms(
  items: ValidateTermsRequestItem[],
): Promise<ValidateTermsResponse> {
  // Short-circuit rather than POST an empty batch — an experiment with
  // no grounded terms is a legitimate state, not a request to make.
  if (items.length === 0) return { results: [], counts: {} };
  return api.post<ValidateTermsResponse>("/validate-terms", { items });
}

/** Curator-triggered, never on render — the whole reason the endpoint
 *  is a batch is that checking every term is expensive. */
export function useValidateTerms() {
  return useMutation({
    mutationFn: (items: ValidateTermsRequestItem[]) => validateTerms(items),
  });
}
