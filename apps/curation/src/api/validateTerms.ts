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
 * 🛑 Six statuses, and the split is what makes the check useful — do
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
 * - `not_found` — the URI is in a namespace the index DOES carry, the
 *   index cannot name it, and Gemma disowns it too. The term does not
 *   exist: a fabricated or mistyped ID. Red, and grouped with
 *   `label_mismatch` — see `features/design/termValidation.ts`.
 *   Carries `canonical_uri` (the URI that failed) and a `detail`
 *   written to be shown verbatim; it carries no `canonical_label` and
 *   no `replaced_by_*`, because there is nothing to re-bind TO. The
 *   curator has to pick a different term. Landed agents-side
 *   2026-09-16 (`CAB_TO_UIB_2026_09_16_VALIDATE_TERMS_HAS_A_SIXTH_VERDICT_NOT_FOUND_AND_IT_IS_THE_RED_ONE.md`).
 * - `unknown` — neither the ontology index nor Gemma can name this
 *   URI, and it sits in a namespace the index doesn't carry, so
 *   "fabricated" is not a conclusion available about it. **NOT an
 *   error, and not a finding.** It is silence: with no term name to
 *   compare against, the check simply didn't run on that pair. So it
 *   earns neither an inline mark nor a summary row, only a count in
 *   the tally; see `features/design/termValidation.ts`.
 *
 *   Much rarer since 2026-09-16. The first
 *   cut of the split tested the URI's prefix against the agents index
 *   and returned BEFORE asking Gemma, so RO, GENO, GO and NBO all read
 *   "not checked" while `/annotations/term` named them outright — it
 *   resolves past that index, through Gemma's own vocabularies, ~15
 *   loaded ontologies, then OLS. Gemma is now asked first and those
 *   carry real verdicts. Measured over a 1,371-pair reference set:
 *   453 pairs took the `unknown` path, of which asking Gemma resolves
 *   436 to `ok`, 3 to `non_canonical` and 1 to `not_found`. The 13
 *   left are 10 NCBITaxon and one each of Orphanet, HsapDv and XCO —
 *   ~1% of pairs, so a grey chip is now rare enough that a curator
 *   seeing one can reasonably ask why. The residual is per-TERM, not
 *   per-namespace: `CVCL_0321` and `ENVO_00002006` are unserved while
 *   other CVCL and ENVO pairs resolve fine.
 *
 *   🛑 `unknown` and `not_found` are not interchangeable, and the
 *   split is why the sixth status exists. Until 2026-09-16 one word
 *   answered two questions: a real `RO_0001000` and a fabricated
 *   `EFO_9999999` came back identically, and both read downstream as a
 *   pass. (RO no longer lands in either bucket — Gemma names it, so it
 *   gets a real verdict.) Measured the same day: a deliberately
 *   fabricated URI passed the eval's `apply_groundings` 45/45 clean
 *   while guarding production writes. Rendering `not_found` grey puts back exactly
 *   the ambiguity the split removed.
 *
 *   A stale index and an unreachable Gemma both still answer
 *   `unknown`: a term minted after the index build is not fabricated,
 *   and a positive control (`CL_0000540`) decides whether the second
 *   opinion runs at all — without it an offline Gemma would mark the
 *   whole corpus fabricated.
 *
 * 🛑 Gemma's own annotation categories must never surface as either
 * `unknown` or `obsolete`.
 * The index carries live ontology classes, so it cannot name
 * `disease` / `EFO_0000408` (`obsolete_disease`
 * upstream) or `biological process` / `GO_0008150` — both perfectly
 * good annotations, and `EFO_0000408` is deprecated AND Gemma's live
 * disease category at the same time. The agents side now excludes
 * every published category URI itself, and `buildRun` holds the same
 * exclusion client-side against `/rest/v2/annotations/categories`
 * (`useCategories()`) for categories Gemma publishes that the static
 * table may lag on. Keyed on URI, never on label — the EFO label is
 * the obsolete one.
 */
export type TermValidationStatus =
  | "ok"
  | "label_mismatch"
  | "non_canonical"
  | "obsolete"
  | "not_found"
  | "unknown";

export interface TermValidationResult {
  /** Echoed verbatim from the request — our (label, URI) pair key. */
  id: string;
  status: TermValidationStatus;
  canonical_label?: string | null;
  canonical_uri?: string | null;
  detail?: string | null;
  synonyms?: string[] | null;
  /** The successor the ONTOLOGY declares for a deprecated term
   *  (`IAO:0100001`). Present on every verdict and empty except on
   *  `obsolete`.
   *
   *  Both signal paths carry it as of agents `a978033` (2026-08-16,
   *  `CAB_TO_UIB_2026_08_16_REPLACED_BY_NOW_POPULATES.md`): the index
   *  path from a `replaced_by` column now in all 13 parquets, the
   *  Gemma-fallback path from `/annotations/term`, which grew
   *  `termReplacedBy` the same afternoon. Before that it was empty on
   *  every obsolete verdict, so a build older than either still sends
   *  nothing — hence optional.
   *
   *  Empty is still a real answer: the ontology names no successor.
   *  Measured against gemma2 the day the fields landed, deprecated
   *  terms declaring one — EFO 36/36, CLO 54/64, TGEMO 0/5. Empty
   *  means "deprecated, and choosing the replacement is a curation
   *  judgement" — never guess one. */
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
