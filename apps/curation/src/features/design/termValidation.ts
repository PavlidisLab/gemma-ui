/**
 * Verdict store for the validate-terms run.
 *
 * Session-scoped and deliberately NOT persisted. A verdict is a claim
 * about a (label, URI) pair at a moment in time; the design is edited
 * underneath it constantly, and a stale red mark on a term the curator
 * already fixed is worse than no mark. Re-running is one click and one
 * request. If this ever does get persisted it has to scope by
 * experiment and clear on Reset, like `paperDismissal.ts`.
 *
 * Lookup is by the (label, URI) PAIR — see `termKey`. That gives
 * staleness handling for free: the moment a curator edits a label the
 * key no longer matches, the lookup misses, and the chip renders
 * unmarked rather than showing a verdict for text that is no longer
 * on screen.
 */

import type {
  TermValidationResult,
  TermValidationStatus,
  ValidateTermsResponse,
} from "@/api/validateTerms";
import type { OntologyTerm } from "@/features/experiment/types";

import { termKey, type TermRef } from "./collectTerms";

export interface TermValidationRun {
  /** Verdicts keyed by `termKey(label, uri)`. */
  byKey: Map<string, TermValidationResult>;
  /** The terms that were sent, so the summary can name locations the
   *  response itself doesn't carry (the agent only echoes `id`). */
  refsByKey: Map<string, TermRef>;
  /** Which keys each URI was validated under. Exists so an edited
   *  label can be told apart from a term that was never checked —
   *  see `markStateFor`. */
  keysByUri: Map<string, Set<string>>;
  counts: Partial<Record<TermValidationStatus, number>>;
  /** Total checked — lets the surface say "checked 46 terms" so a
   *  clean run reads as verified rather than as not-yet-run. */
  total: number;
}

/**
 * What to render beside a term.
 *
 * 🛑 `stale` exists because "the mark disappeared" must never be
 * readable as "the problem is fixed".
 *
 * Concretely: `Hek293F` is marked because EFO_0022515 is actually
 * `HEK-293S`. A curator retypes the label to `HEK-293F` and the
 * (label, URI) key stops matching — so a pure key lookup renders the
 * chip clean. But nothing was fixed: the binding still points at the
 * wrong cell line. Silently clearing the mark would turn this feature
 * into the exact failure it was built to catch, a surface that shows
 * one thing and means another.
 *
 * So an edit clears the VERDICT (it is genuinely no longer a claim
 * about what is on screen) but raises `stale` in its place: the term
 * was checked, it has changed since, and the answer is unknown until
 * re-run.
 */
export type TermMarkState =
  | { kind: "verdict"; result: TermValidationResult }
  | { kind: "stale" };

/**
 * Gemma's own category list, keyed by URI — the authority on what a
 * category URI is CALLED here.
 *
 * 🛑 Key on URI, never on label. Gemma's disease category is
 * `EFO_0000408`, whose label in current EFO is `obsolete_disease`; a
 * label-keyed join misses the most-used category outright. Same rule
 * the agents side writes down in
 * `ontology/category_filter.py::_PUBLISHED_URI_TO_LOCAL`.
 */
function categoryNamesByUri(
  categories: readonly OntologyTerm[] | null | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of categories ?? []) {
    const uri = (c.uri ?? "").trim();
    const label = (c.label ?? "").trim();
    if (uri && label) out.set(uri, label);
  }
  return out;
}

/** Same normalisation the agents-side validator uses: case, spacing
 *  and punctuation are formatting, not identity. */
function normLabel(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Re-decide a pair the ontology index couldn't name, when the URI is
 * one of Gemma's own annotation categories.
 *
 * **Why this exists.** The validator's index carries live ontology
 * classes, so it cannot name a category URI that upstream has
 * obsoleted — `disease` / `EFO_0000408` — or one whose class is a
 * root it doesn't ingest, `biological process` / `GO_0008150`. Both
 * came back `unknown` while being exactly right, because Gemma keeps
 * using those URIs as categories and publishes its own name for them
 * on `/rest/v2/categories`. That list is the carve-out; consult it
 * rather than describing the phenomenon in prose.
 *
 * Only fills GAPS. A pair the index DID name keeps the index's
 * verdict — measured over all 28 published categories, the two
 * sources agree on the 26 the index carries, so overriding those
 * would buy nothing and could only mask a real mismatch.
 *
 * Returns `null` when there is nothing to say.
 */
function categoryVerdict(
  ref: TermRef,
  prior: TermValidationResult | undefined,
  names: Map<string, string>,
): TermValidationResult | null {
  if (prior && prior.status !== "unknown") return null;
  const canonical = names.get(ref.uri);
  if (!canonical) return null;
  if (normLabel(ref.label) === normLabel(canonical)) {
    return {
      id: ref.id,
      status: "ok",
      canonical_label: canonical,
      canonical_uri: ref.uri,
      detail: "Gemma's own name for this annotation category",
    };
  }
  // The label doesn't name the category. This is a real finding the
  // index could not have reported, and `canonical_label` makes the
  // row's Fix-label button work.
  return {
    id: ref.id,
    status: "label_mismatch",
    canonical_label: canonical,
    canonical_uri: ref.uri,
    detail: `stored label "${ref.label}" is not Gemma's name for this annotation category ("${canonical}")`,
  };
}

/**
 * @param categories Gemma's published category list (`useCategories()`).
 *   Optional: without it the run is exactly the server's verdicts, which
 *   is the correct degradation — a few correct categories read as "not
 *   checked" rather than anything being reported wrongly.
 */
export function buildRun(
  refs: TermRef[],
  response: ValidateTermsResponse,
  categories?: readonly OntologyTerm[] | null,
): TermValidationRun {
  const byKey = new Map<string, TermValidationResult>();
  for (const r of response.results ?? []) byKey.set(r.id, r);
  const refsByKey = new Map<string, TermRef>();
  const keysByUri = new Map<string, Set<string>>();
  for (const ref of refs) {
    refsByKey.set(ref.id, ref);
    const set = keysByUri.get(ref.uri) ?? new Set<string>();
    set.add(ref.id);
    keysByUri.set(ref.uri, set);
  }

  // Prefer the server's tallies; fall back to counting locally so the
  // summary still works against an older build that omits them.
  const counts = {
    ...(response.counts && Object.keys(response.counts).length > 0
      ? response.counts
      : tally(response.results ?? [])),
  };

  // The carve-out, applied after the server's verdicts and before
  // anything reads them, so the chips, the rows and the tally all see
  // one answer. The tally moves with it — the server counted a status
  // we've just replaced, and a header that disagrees with the rows is
  // worse than either.
  const names = categoryNamesByUri(categories);
  if (names.size > 0) {
    for (const ref of refs) {
      const prior = byKey.get(ref.id);
      const verdict = categoryVerdict(ref, prior, names);
      if (!verdict) continue;
      if (prior) counts[prior.status] = (counts[prior.status] ?? 1) - 1;
      counts[verdict.status] = (counts[verdict.status] ?? 0) + 1;
      byKey.set(ref.id, verdict);
    }
    for (const s of Object.keys(counts) as TermValidationStatus[]) {
      if (!counts[s]) delete counts[s];
    }
  }

  return { byKey, refsByKey, keysByUri, counts, total: byKey.size };
}

function tally(
  results: TermValidationResult[],
): Partial<Record<TermValidationStatus, number>> {
  const out: Partial<Record<TermValidationStatus, number>> = {};
  for (const r of results) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

/** Verdict for exactly this (label, URI) pair, or `null`. Callers that
 *  render chrome want {@link markStateFor} instead — this one cannot
 *  tell "never checked" from "edited since checking". */
export function verdictFor(
  run: TermValidationRun | null | undefined,
  label: string | null | undefined,
  uri: string | null | undefined,
): TermValidationResult | null {
  if (!run || !uri) return null;
  return run.byKey.get(termKey(label, uri)) ?? null;
}

/**
 * What a chip should render: the verdict, a `stale` cue, or nothing.
 *
 * `null` means genuinely unchecked — this URI wasn't in the last run,
 * or there was no run. `stale` means the URI WAS checked but under a
 * different label, i.e. someone edited it since. See
 * {@link TermMarkState} for why that distinction is the point.
 */
export function markStateFor(
  run: TermValidationRun | null | undefined,
  label: string | null | undefined,
  uri: string | null | undefined,
): TermMarkState | null {
  if (!run || !uri) return null;
  const result = run.byKey.get(termKey(label, uri));
  if (result) return { kind: "verdict", result };
  // Checked under some other label → edited since the run.
  if (run.keysByUri.has(uri)) return { kind: "stale" };
  return null;
}

/**
 * Whether the run as a whole still describes the design in front of
 * the curator. False as soon as any term-affecting edit lands.
 *
 * The per-chip `stale` cue only catches a label edited in place. It
 * cannot catch a term DELETED, one ADDED, or a URI rebound to
 * something else entirely — in all three the chip has no verdict and
 * no way to know it should have one. So the banner carries the global
 * signal: "checked 46 terms · design edited since · re-run". Without
 * it, "no marks" after an edit is indistinguishable from "clean".
 *
 * Compares key SETS rather than a revision counter so that edits which
 * don't touch terms — a description, a sample assignment — don't nag.
 */
export function runIsStale(
  run: TermValidationRun | null | undefined,
  currentRefs: TermRef[],
): boolean {
  if (!run) return false;
  if (currentRefs.length !== run.refsByKey.size) return true;
  return currentRefs.some((ref) => !run.refsByKey.has(ref.id));
}

/**
 * Whether a status earns an inline mark on the chip.
 *
 * Only `label_mismatch` does. The other three are all reasons NOT to
 * mark:
 *  - `ok` needs no chrome.
 *  - `unknown` is the validator's index having no entry for the URI.
 *    That is not an error and not even a suspicion — the check simply
 *    did not run on that pair. Marking it puts a flag on annotations
 *    that may be plainly correct, and a mark that is wrong that often
 *    is a mark curators learn to ignore. It earns no summary row
 *    either — see {@link SUMMARY_STATUS_ORDER}.
 *  - `non_canonical` is mostly legitimate synonyms once the agent's
 *    label test became membership rather than equality (`OCI-AML3`
 *    for `OCI-AML3 cell`), so inline it would be noise on correct
 *    data. It still appears in the summary, where it costs nothing.
 *
 * Single source of truth on purpose: the moment this predicate exists
 * in two places, one of them starts marking `unknown`.
 */
export function statusEarnsInlineMark(status: TermValidationStatus): boolean {
  return status === "label_mismatch";
}

/**
 * Statuses that earn a row in the summary, worst first.
 *
 * 🛑 `unknown` is NOT here, and `ok` never was. Both are the same
 * judgement: a row is a claim that something needs looking at, and
 * neither status makes one.
 *
 * `unknown` means only that the validator's index has no entry for the
 * URI — it is silence, not a finding, and the panel cannot tell an
 * innocent gap from a bad binding. Listing it asks a curator to
 * adjudicate a term that may be sitting right there, plainly correct,
 * which is how the whole panel stops being read.
 *
 * Note the order this depends on: `buildRun` resolves Gemma's own
 * category URIs through {@link categoryVerdict} FIRST, so the cases
 * that were both unknown AND obviously correct — `disease` /
 * `EFO_0000408` — get a real verdict rather than being swept under
 * this rule. Suppressing a row is the right answer only once the
 * answerable ones have been answered.
 *
 * The count still shows in the header tally, so nothing is hidden:
 * "checked 19 · 19 ok" now, and where a gap remains, "· 1 not checked"
 * says exactly what happened without dressing it as work.
 */
export const SUMMARY_STATUS_ORDER: TermValidationStatus[] = [
  "label_mismatch",
  "non_canonical",
];

/** Rows for the summary panel, worst first, each with the location the
 *  collector recorded so a curator can click through to the term
 *  rather than hunt for it. */
export function summaryRows(
  run: TermValidationRun | null | undefined,
): Array<{ result: TermValidationResult; ref: TermRef | null }> {
  if (!run) return [];
  const rank = new Map(SUMMARY_STATUS_ORDER.map((s, i) => [s, i]));
  return [...run.byKey.values()]
    .filter((r) => rank.has(r.status))
    .sort(
      (a, b) => (rank.get(a.status) ?? 99) - (rank.get(b.status) ?? 99),
    )
    .map((result) => ({
      result,
      ref: run.refsByKey.get(result.id) ?? null,
    }));
}
