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

import { useProvenanceRun } from "./ProvenanceContext";
import { provenanceRefs } from "./refs";

export function ProvenancePanel({
  experimentId,
}: {
  experimentId: number | string;
}) {
  const { draft } = useDesignDraft();
  const run = useProvenanceRun();
  const refs = useMemo(() => provenanceRefs(draft), [draft]);
  const nothingToTrace = refs.length === 0;

  return (
    <section className="card p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-slate-700 dark:text-slate-200 text-xs">
          Provenance
        </span>
        <button
          type="button"
          className="btn btn-sm"
          disabled={run.status === "loading" || nothingToTrace}
          onClick={() => run.populate(experimentId, refs)}
          title={
            nothingToTrace
              ? "Nothing to trace — this experiment has no factors or tags yet."
              : "Ask where each annotation on this experiment came from. Hover a disc for the evidence behind it."
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
    </section>
  );
}
