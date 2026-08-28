/**
 * "Populate provenance" — the curator-triggered run that fills in the
 * discs.
 *
 * Sits beside the term-validation row on Overview and behaves the same
 * way on purpose: one button, one batch request covering every
 * annotation on the experiment, and nothing fetched until someone
 * asks. Curators already know that shape.
 *
 * 🛑 **One row, like the row above it** (Paul, 2026-08-16 — the panel
 * was taking too much space). Overview is a dense page a curator scans
 * on the way to the work; a batch check that costs four lines to say
 * "there's a button here" outranks itself. The tally is the only prose
 * that earns its place, because the expected outcome is EMPTY —
 * "9 asked · 2 with a source" is the difference between "we looked and
 * nothing is recorded" and "the button did nothing", and without it
 * every clean experiment looks like a broken feature. The rest moved
 * into the button's own tooltip.
 */

import { useMemo } from "react";

import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { useGemmaMode } from "@/lib/gemmaMode";

import { useProvenanceRun } from "./ProvenanceContext";
import { publicationTraces } from "./publicationTrace";
import { provenanceRefs } from "./refs";

export function ProvenancePanel({
  experimentId,
  bare = false,
}: {
  experimentId: number | string;
  /** Drop this panel's own card chrome and render just the control, so
   *  a caller can seat it in a shared row beside its siblings. Three
   *  stacked bordered cards were spending a third of the viewport
   *  above the first annotation (Paul, 2026-08-16). The COUNT still
   *  rides on the surface either way — it is the whole reason the
   *  button is worth a glance. */
  bare?: boolean;
}) {
  const { draft } = useDesignDraft();
  const run = useProvenanceRun();
  const refs = useMemo(() => provenanceRefs(draft), [draft]);
  // A publication's provenance is the association Gemma keeps on the
  // link itself, and it is already on the page — there is nothing to
  // look up. Resolved here so the run answers every kind it asked
  // about, from whichever side of the wire holds the answer.
  const derived = useMemo(
    () => publicationTraces(draft?.publications),
    [draft?.publications],
  );
  const nothingToTrace = refs.length === 0;
  // 🛑 The lookup is `POST /rest/v2/datasets/{id}/provenance/lookup`,
  // a CURATION STORE route. `/rest` is a catch-all whose meaning
  // changes with mode, so in remote mode that POST goes at Gemma, which
  // has no such route: the button 404s and reports "not available on
  // this backend yet" every time. A control that cannot work is a dead
  // end, and the sentence beside it describes the deployment rather
  // than this experiment. Say where the answer lives instead, and do
  // not offer the button.
  const storeConnected = useGemmaMode().mode === "local";

  const Wrapper = bare ? "div" : "section";
  return (
    <Wrapper className={bare ? "contents" : "card p-3"}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-slate-700 dark:text-slate-200 text-xs">
          Provenance
        </span>
        {!storeConnected ? (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Provenance is recorded in the curation store, which is not
            connected in remote mode.
          </span>
        ) : null}
        {storeConnected ? (
        <button
          type="button"
          className="btn btn-sm"
          disabled={run.status === "loading" || nothingToTrace}
          onClick={() => run.populate(experimentId, refs, derived)}
          title={
            nothingToTrace
              ? "Nothing to trace — this experiment has no factors, tags or publications yet."
              : "Ask where each annotation on this experiment came from — factors, tags, and the linked papers. Hover a disc for the evidence behind it."
          }
        >
          {run.status === "loading"
            ? "Looking up…"
            : run.status === "ready"
              ? `Re-populate ${refs.length}`
              : `Populate provenance (${refs.length})`}
        </button>
        ) : null}

        {/* 🛑 Three different silences, three different sentences — but
            all on one line. An undeployed endpoint is not a fact about
            this experiment's curation, and an empty result is not a
            failure. */}
        {run.status === "ready" ? (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {run.asked} asked ·{" "}
            {run.traced > 0
              ? `${run.traced} with a source`
              : "none carry a recorded source"}
          </span>
        ) : null}
        {run.status === "unavailable" ? (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            not available on this backend yet
          </span>
        ) : null}
        {run.status === "error" ? (
          <span className="text-[11px] text-red-700 dark:text-red-300">
            couldn&apos;t reach the service — nothing changed, this lookup is
            read-only
          </span>
        ) : null}
      </div>
    </Wrapper>
  );
}
