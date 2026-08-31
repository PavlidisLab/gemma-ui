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
  // a CURATION STORE route, and Gemma serves nothing matching
  // `provenance` (live OpenAPI, gemma2 2026-08-31). So in remote mode
  // the store-backed half of a run has no answer.
  //
  // That is NOT a reason to hide the control, which is what it used to
  // do. A publication's provenance is derived from the `association`
  // block Gemma itself ships — source, evidence, evidence code, who
  // asserted it and when — and needs no service. Hiding the button hid
  // that too, and told the curator provenance was unavailable while
  // Gemma was holding some.
  //
  // `ProvenanceProvider` skips the doomed request in remote mode and
  // reports `unavailable`, so a run still fills in every disc it can.
  const storeBacked = useGemmaMode().mode === "local";

  const Wrapper = bare ? "div" : "section";
  return (
    <Wrapper className={bare ? "contents" : "card p-3"}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-slate-700 dark:text-slate-200 text-xs">
          Provenance
        </span>
        <button
          type="button"
          className="btn btn-sm"
          disabled={run.status === "loading" || nothingToTrace}
          onClick={() => run.populate(experimentId, refs, derived)}
          title={
            nothingToTrace
              ? "Nothing to trace — this experiment has no factors, tags or publications yet."
              : storeBacked
                ? "Ask where each annotation on this experiment came from — factors, tags, and the linked papers. Hover a disc for the evidence behind it."
                : "Show where the linked papers came from — Gemma carries that itself. Factor and tag provenance lives in the curation store, which this backend does not serve."
          }
        >
          {run.status === "loading"
            ? "Looking up…"
            : run.status === "ready"
              ? `Re-populate ${refs.length}`
              : `Populate provenance (${refs.length})`}
        </button>

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
            {run.traced > 0
              ? `${run.traced} with a source · the rest are recorded in the curation store, which this backend does not serve`
              : "the curation store, which records this, is not served by this backend"}
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
