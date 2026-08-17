/**
 * Curator-triggered check of every (label, URI) pair on the experiment,
 * against the agents-side canonicaliser (`POST /validate-terms`).
 *
 * **Why a new component rather than extending what exists.** Checked
 * both candidates first:
 *
 * - `ValidatorBanner` is design-scoped — it renders inside
 *   `DesignEditor` over `DesignValidationState` and speaks about
 *   factors. This check spans experiment tags, factor values,
 *   statement slots AND sample characteristics, so it can neither live
 *   under that state nor stay inside that tab.
 * - The audit sidebar was the other obvious home, and it is where the
 *   RESULTS are shaped like something that belongs. But the Audit
 *   toggle only appears once an audit exists — deliberately, so a
 *   fresh-from-GEO experiment isn't offered a review of nothing. Term
 *   validation is most useful on exactly that experiment, so hanging
 *   the trigger there would hide it where it is needed most.
 *
 * So: Overview, which is the one always-present experiment-level
 * surface. The MARKS still appear wherever a term renders, because
 * they hang off the shared `Term` / `CurieLink` chips rather than off
 * this panel.
 */

import { useMemo, useState } from "react";

import { useCategories } from "@/api/categories";
import { useValidateTerms } from "@/api/validateTerms";
import type { TermValidationStatus } from "@/api/validateTerms";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { shortenUri } from "@/lib/curie";
import { useIsReadOnly } from "@/features/comparison/FlowContext";
import {
  locateTooltipFor,
  requestAuditFocus,
  tabForTargetId,
} from "@/lib/scrollToAuditTarget";

import {
  applyLabelFix,
  applyTermRebind,
  collectTerms,
  isBareAccessionLabel,
} from "./collectTerms";
import {
  buildRun,
  rebindTargetFor,
  runIsStale,
  successorFor,
  summaryRows,
  type TermValidationRun,
} from "./termValidation";

// The URI is the authority and the LABEL is what disagrees with it —
// so the badge names the direction of the error. "wrong term" reads as
// though the binding is wrong, which is the opposite claim and would
// send a curator to re-pick a term that may well be correct.
const STATUS_COPY: Record<
  TermValidationStatus,
  { label: string; cls: string }
> = {
  label_mismatch: {
    label: "wrong label",
    cls: "bg-red-50 border-red-300 text-red-700 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300",
  },
  non_canonical: {
    label: "non-canonical",
    cls: "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300",
  },
  // Advisory, so it shares the amber of `non_canonical` rather than
  // taking a colour of its own — the axis here is severity, not
  // category, and inventing a fourth tint would make the palette stop
  // meaning anything.
  obsolete: {
    label: "obsolete term",
    cls: "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300",
  },
  unknown: {
    label: "not checked",
    cls: "bg-slate-100 border-slate-300 text-slate-600 dark:bg-slate-700/50 dark:border-slate-600 dark:text-slate-300",
  },
  ok: { label: "ok", cls: "" },
};

export function TermValidationPanel({
  experimentId,
  bare = false,
}: {
  experimentId: number | string;
  /** Drop this panel's own card chrome and render just the control, so
   *  a caller can seat it in a shared row beside its siblings. Three
   *  stacked bordered cards were spending a third of the viewport
   *  above the first annotation (Paul, 2026-08-16). The COUNT stays on
   *  the surface either way, and the RESULTS still get their own
   *  full-width line — a findings list squeezed into a flex column
   *  beside two buttons would be unreadable. */
  bare?: boolean;
}) {
  const { draft, apply } = useDesignDraft();
  const readOnly = useIsReadOnly();
  const [run, setRun] = useState<TermValidationRun | null>(null);
  // Rows repaired in this session. The verdict still sits in the run
  // (it described the pre-fix label), so without this the row would
  // linger claiming a problem the curator just resolved.
  const [fixed, setFixed] = useState<Set<string>>(new Set());
  const validate = useValidateTerms();
  // Gemma's own category names, which outrank the ontology index for
  // any URI Gemma uses as a category — see `categoryVerdict`. Fetched
  // on mount (cached, `staleTime: Infinity`) so it is in hand by the
  // time anyone presses the button.
  const categories = useCategories();

  const refs = useMemo(() => collectTerms(draft), [draft]);
  const stale = runIsStale(run, refs);
  const rows = summaryRows(run).filter((r) => !fixed.has(r.result.id));

  // A term with a URI is the only thing this can have an opinion
  // about; free text isn't wrong, it's just ungrounded.
  const nothingToCheck = refs.length === 0;

  const Wrapper = bare ? "div" : "section";
  return (
    <Wrapper className={bare ? "contents" : "card p-3 space-y-2"}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-slate-700 dark:text-slate-200 text-xs">
          Ontology terms
        </span>
        <button
          type="button"
          className="btn btn-sm"
          disabled={validate.isPending || nothingToCheck}
          onClick={() => {
            validate.mutate(
              refs.map((r) => ({ id: r.id, label: r.label, uri: r.uri })),
              {
                onSuccess: (res) => {
                  setRun(buildRun(refs, res, categories.data));
                  setFixed(new Set());
                },
              },
            );
          }}
          title={
            nothingToCheck
              ? "Nothing to check — no term on this experiment carries a URI."
              : `Check all ${refs.length} grounded terms against the ontology.`
          }
        >
          {validate.isPending
            ? "Checking…"
            : run
              ? `Re-check ${refs.length} terms`
              : `Validate ${refs.length} terms`}
        </button>

        {/* A clean run and a run that never happened look identical
            without this, so say the count out loud. The `unknown`
            tally rides here rather than as rows below — it is the one
            place the number costs nothing and claims nothing. */}
        {run && !stale ? (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            checked {run.total} · {run.counts.ok ?? 0} ok
            {(run.counts.unknown ?? 0) > 0 ? (
              <>
                {" · "}
                <span
                  className="cursor-help underline underline-offset-2 decoration-dotted"
                  title={notCheckedTooltip(run)}
                >
                  {run.counts.unknown} not checked
                </span>
              </>

            ) : null}
          </span>
        ) : null}

        {run && stale ? (
          <span className="text-[11px] text-amber-700 dark:text-amber-300">
            design edited since — re-check
          </span>
        ) : null}
      </div>

      {/* Everything the run PRODUCES, kept together. In bare mode this
          is a flex item of the caller's row, so `basis-full` drops it
          onto its own line under the controls rather than letting a
          findings list compete for width with two buttons.
          Rendered only when there IS output: a full-width flex item is
          a line break even when it's empty, and an empty one pushed the
          sibling panel's button off the shared row — the exact row the
          bare mode exists to keep together. Every child below needs
          either a run or an error, so those two cover all of them.
          `order-last` for the same reason once a run HAS produced
          something: in DOM order this block sits between our own
          control and the next panel's, so without it a finished run
          shoves that panel onto a third line. */}
      {validate.isError || run ? (
      <div className={bare ? "order-last basis-full w-full space-y-2" : "contents"}>
      {validate.isError ? (
        <p className="text-[11px] text-red-700 dark:text-red-300">
          Couldn&apos;t reach the validator. The terms are unchanged — this
          check is read-only.
        </p>
      ) : null}

      {run && rows.length === 0 && !stale ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {/* "Every grounded term" would overclaim on a run where the
              index couldn't name one — we don't know about that one.
              Say what was actually established. */}
          Every term the index could name carries the right label.
        </p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="space-y-1">
          {rows.map(({ result, ref }) => {
            const copy = STATUS_COPY[result.status];
            const successor = successorFor(result, ref);
            const rebind = rebindTargetFor(result, ref);
            return (
              <li
                key={result.id}
                className="text-[11px] flex items-center gap-2 flex-wrap"
              >
                <span
                  className={`shrink-0 rounded border px-1 py-px ${copy.cls}`}
                  // The agent's own sentence for the verdict. It carries
                  // things the row has no line for — which ontology
                  // release deprecated the term ("obsoleted in 3.90"),
                  // which is the difference between a curation error and
                  // the ontology moving underneath one.
                  title={result.detail ?? undefined}
                >
                  {copy.label}
                  {/* Name the URI the label failed to match, so the
                      badge states the whole claim: this label is wrong
                      FOR THIS term, not "something here is wrong". */}
                  {result.status === "label_mismatch" && ref?.uri ? (
                    <span className="font-mono"> for {shortenUri(ref.uri)}</span>
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="font-mono">{ref?.label ?? result.id}</span>
                  {ref?.where ? (
                    // Jump to it when the shell knows the route;
                    // otherwise still SAY where it is, which is the
                    // minimum a curator needs to go find it.
                    ref.targetId && tabForTargetId(ref.targetId) ? (
                      <>
                        {" · "}
                        <button
                          type="button"
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                          onClick={() =>
                            requestAuditFocus(experimentId, ref.targetId!)
                          }
                          title={locateTooltipFor(ref.targetId)}
                        >
                          {ref.where}
                        </button>
                      </>
                    ) : (
                      <span className="text-slate-500 dark:text-slate-400">
                        {" · "}
                        {ref.where}
                      </span>
                    )
                  ) : null}
                  {/* The canonical label is the whole point for a
                      mismatch: "Back left brain" is unreadable as an
                      error until you can see it means left occipital
                      lobe.

                      For an `obsolete` verdict it is usually the
                      tombstone — the same string wearing an
                      "obsolete_" prefix ("immortal cat cell line cell"
                      -> "obsolete immortal cat cell line cell"). The
                      chip already says obsolete, so printing that back
                      is noise on a row that has real things to say.
                      Suppressed only when it IS the prefixed original;
                      a tombstone that renamed the term is still worth
                      seeing. */}
                  {result.canonical_label &&
                  !isTombstoneOf(result.canonical_label, ref?.label) ? (
                    <span className="text-slate-600 dark:text-slate-300">
                      {" "}
                      → term is{" "}
                      <span className="font-medium">
                        {result.canonical_label}
                      </span>
                      {/* A canonical label that is a bare catalogue
                          accession is technically correct and useless
                          to a reader: "PC-9 → term is RCB4455 cell"
                          reads as a bug, not as advice. 11 RIKEN + 5
                          Coriell targets are shaped like this. Show
                          the human names beside it so a curator can
                          see the equivalence they're being told
                          about, rather than being asked to trust an
                          accession. */}
                      {isBareAccessionLabel(result.canonical_label)
                        ? (() => {
                            const named = (result.synonyms ?? []).filter(
                              (s) => s && !isBareAccessionLabel(s),
                            );
                            return named.length ? (
                              <span className="text-slate-500 dark:text-slate-400">
                                {" "}
                                (also: {named.slice(0, 3).join(", ")})
                              </span>
                            ) : null;
                          })()
                        : null}
                    </span>
                  ) : null}
                  {/* The successor, which is the entire reason an
                      `obsolete` row is worth a curator's time. Without
                      it the row says "this term is dead" and stops,
                      which is the shape a finding surface must never
                      take. A deprecated term whose source names no
                      successor renders no replacement and no button —
                      picking one is a curation judgement, not ours.

                      Shown whenever the verdict names one, including
                      where we can't write it: knowing WHICH term
                      replaced this is most of the answer even when the
                      one-click isn't on offer. */}
                  {successor ? (
                    <span className="text-slate-600 dark:text-slate-300">
                      {" · "}
                      replaced by{" "}
                      {successor.label ? (
                        <span className="font-medium">{successor.label}</span>
                      ) : null}
                      <span className="font-mono text-slate-500 dark:text-slate-400">
                        {successor.label ? " " : ""}
                        {shortenUri(successor.uri)}
                      </span>
                    </span>
                  ) : null}
                  {/* Named but not bindable — say which way it fell
                      short, so "why is there no button" is answered on
                      the row rather than guessed at. */}
                  {successor && !successor.writable && successor.blocked ? (
                    <span
                      className="text-slate-500 dark:text-slate-400 cursor-help underline underline-offset-2 decoration-dotted"
                      title={successor.blocked}
                    >
                      {" — re-pick a term"}
                    </span>
                  ) : null}
                  {/* The other half of the same statement. A deprecated
                      term with nowhere to go still has to tell the
                      curator what to do about it, or the row is a
                      complaint with no exit. Since 2026-08-16 this is
                      the minority case rather than every obsolete row —
                      it now means the ontology itself named no
                      successor (TGEMO declares none at all; 10 of CLO's
                      64 tombstones don't either). Where the term isn't
                      editable from here at all (a sample characteristic
                      off the Gemma import) the cue stops at the fact
                      rather than asking for something that can't be
                      done. */}
                  {result.status === "obsolete" && !successor ? (
                    <span className="text-slate-500 dark:text-slate-400">
                      {" · "}
                      no successor recorded
                      {ref?.locator ? " — re-pick a term" : ""}
                    </span>
                  ) : null}
                  {rebind ? (
                    <button
                      type="button"
                      className="ml-1 px-1.5 py-px rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                      disabled={readOnly}
                      title={
                        readOnly
                          ? "Read-only view."
                          : `Re-point at "${rebind.label}" (${shortenUri(rebind.uri)}), the successor the ontology declares for this deprecated term. Changes the label AND the URI.`
                      }
                      onClick={() => {
                        let applied = false;
                        apply((current) => {
                          const next = applyTermRebind(current, ref!, rebind);
                          applied = next !== null;
                          return next ?? current;
                        });
                        if (applied) setFixed((s) => new Set(s).add(result.id));
                      }}
                    >
                      Re-bind
                    </button>
                  ) : null}
                  {/* Relabel-in-place, only where the label is what's
                      wrong and the row is actually editable. Sample
                      characteristics come off the Gemma import and
                      carry no locator, so they report without a Fix
                      rather than offering one that can't work. */}
                  {result.status === "label_mismatch" &&
                  result.canonical_label &&
                  ref?.locator ? (
                    <button
                      type="button"
                      className="ml-1 px-1.5 py-px rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                      disabled={readOnly}
                      title={
                        readOnly
                          ? "Read-only view."
                          : `Relabel to "${result.canonical_label}". The URI is unchanged — if the BINDING is wrong, re-pick the term instead.`
                      }
                      onClick={() => {
                        let applied = false;
                        apply((current) => {
                          const next = applyLabelFix(
                            current,
                            ref,
                            result.canonical_label as string,
                          );
                          applied = next !== null;
                          return next ?? current;
                        });
                        // The verdict described the OLD label, so drop
                        // it rather than leave a mark pointing at text
                        // that no longer exists.
                        if (applied) setFixed((s) => new Set(s).add(result.id));
                      }}
                    >
                      Fix label
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* `non_canonical` fires on URI FORM alone — a CURIE instead of a
          full IRI flips an otherwise-correct term. If a whole
          population is CURIEs that is a property of whatever produced
          it, not of anyone's curation, so say so once here rather than
          let N rows read as N curation problems. */}
      {(run?.counts.non_canonical ?? 0) > 0 ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {run!.counts.non_canonical} differ only in form (a synonym, or a
          CURIE where a full IRI is preferred) — the term itself is right.
        </p>
      ) : null}
      </div>
      ) : null}
    </Wrapper>
  );
}


/** Whether a canonical label is just the stored one with the ontology's
 *  deprecation prefix on it — `obsolete_disease` for `disease`,
 *  `obsolete immortal cat cell line cell` for the same without the
 *  word. Both spellings occur (EFO uses the underscore, CLO the
 *  space). */
function isTombstoneOf(
  canonical: string | null | undefined,
  stored: string | null | undefined,
): boolean {
  const c = (canonical ?? "").trim().toLowerCase();
  const st = (stored ?? "").trim().toLowerCase();
  if (!c || !st) return false;
  return c === `obsolete_${st}` || c === `obsolete ${st}`;
}

/**
 * Hover text behind the `N not checked` tally.
 *
 * 🛑 Says WHAT happened, never WHY. The panel used to spend a
 * paragraph guessing at causes ("GO/NBO terms, non-human/mouse/rat
 * gene records") — a population borrowed from an agents-side sample
 * that had already gone stale and never described the case in front of
 * the curator anyway. Where a cause IS knowable it belongs in code, not
 * in copy: Gemma's category list resolves the categories the index
 * can't name before this line ever counts them. What is left is a
 * genuine gap, so name the terms and stop.
 */
function notCheckedTooltip(run: TermValidationRun): string {
  const names = [...run.byKey.values()]
    .filter((r) => r.status === "unknown")
    .map((r) => run.refsByKey.get(r.id)?.label)
    .filter((l): l is string => Boolean(l));
  const shown = names.slice(0, 6).join(", ");
  const more = names.length > 6 ? ` +${names.length - 6} more` : "";
  return (
    "The ontology index has no entry for these URIs, so there was no " +
    "term name to compare the stored label against. They were skipped, " +
    "not judged — nothing here is a reported problem." +
    (shown ? `\n\n${shown}${more}` : "")
  );
}
