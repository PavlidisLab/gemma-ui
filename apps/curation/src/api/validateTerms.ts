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
 * 🛑 Four statuses, and the split is load-bearing — do not collapse
 * this to a boolean.
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
 *   error.** Gene records and GO/NBO terms the index doesn't carry;
 *   17 of the 120 non-canonical gold rows. Marking these red would be
 *   17 false alarms, which is how a curator learns to ignore the mark.
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
