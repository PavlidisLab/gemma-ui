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
 * - `unknown` — the ontology index cannot name this URI. **NOT an
 *   error, and not a finding.** It is silence: with no term name to
 *   compare against, the check simply didn't run on that pair. So it
 *   earns neither an inline mark nor a summary row, only a count in
 *   the tally; see `features/design/termValidation.ts`.
 *
 * 🛑 One population must be rescued from `unknown` before that rule
 * applies: Gemma's own annotation categories. The index carries live
 * ontology classes, so it cannot name `disease` / `EFO_0000408`
 * (`obsolete_disease` upstream) or `biological process` /
 * `GO_0008150`, and both are perfectly good annotations. Gemma
 * publishes its name for every category on `/rest/v2/categories`
 * (`useCategories()`), and `buildRun` consults it — keyed on URI,
 * never on label, since the EFO label is the obsolete one.
 */
export type TermValidationStatus =
  | "ok"
  | "label_mismatch"
  | "non_canonical"
  | "unknown";

export interface TermValidationResult {
  /** Echoed verbatim from the request — our (label, URI) pair key. */
  id: string;
  status: TermValidationStatus;
  canonical_label?: string | null;
  canonical_uri?: string | null;
  detail?: string | null;
  synonyms?: string[] | null;
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
