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

export function buildRun(
  refs: TermRef[],
  response: ValidateTermsResponse,
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
  const counts =
    response.counts && Object.keys(response.counts).length > 0
      ? response.counts
      : tally(response.results ?? []);
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
 *  - `unknown` is the index not carrying the term (gene records,
 *    GO/NBO), not an error — 17 of 120 gold rows. Marking it would be
 *    17 false alarms, and a mark that is wrong that often is a mark
 *    curators learn to ignore.
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

/** Statuses worth listing in the summary, worst first. */
export const SUMMARY_STATUS_ORDER: TermValidationStatus[] = [
  "label_mismatch",
  "non_canonical",
  "unknown",
  "ok",
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
    .filter((r) => r.status !== "ok")
    .sort(
      (a, b) => (rank.get(a.status) ?? 99) - (rank.get(b.status) ?? 99),
    )
    .map((result) => ({
      result,
      ref: run.refsByKey.get(result.id) ?? null,
    }));
}
