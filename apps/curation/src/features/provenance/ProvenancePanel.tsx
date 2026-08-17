/**
 * "Populate provenance" — the curator-triggered run that fills in the
 * discs.
 *
 * Sits beside the term-validation panel on Overview and behaves the
 * same way on purpose: one button, one batch request covering every
 * annotation on the experiment, a tally that says what happened, and
 * nothing fetched until someone asks. Curators already know that
 * shape; a second interaction model for a second batch check would be
 * a new thing to learn for no gain.
 *
 * The tally matters more here than it does for term validation,
 * because the expected outcome is EMPTY. "Asked about 12 · 0 carry a
 * source" is the difference between "we looked and nothing is
 * recorded" and "the button did nothing", and without it every clean
 * experiment looks like a broken feature.
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
    <section className="card p-3 space-y-2">
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
              : `Ask where each of the ${refs.length} annotations on this experiment came from.`
          }
        >
          {run.status === "loading"
            ? "Looking up…"
            : run.status === "ready"
              ? `Re-populate ${refs.length}`
              : `Populate provenance (${refs.length})`}
        </button>

        {run.status === "ready" ? (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            asked about {run.asked} ·{" "}
            {run.traced > 0
              ? `${run.traced} carry a source`
              : "none carry a recorded source"}
          </span>
        ) : null}
      </div>

      {/* 🛑 Three different silences, three different sentences. An
          undeployed endpoint is not a fact about this experiment's
          curation, and an empty result is not a failure. */}
      {run.status === "unavailable" ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          The provenance service isn&apos;t available on this backend yet —
          nothing was asked about the annotations.
        </p>
      ) : null}
      {run.status === "error" ? (
        <p className="text-[11px] text-red-700 dark:text-red-300">
          Couldn&apos;t reach the provenance service. Nothing changed — this
          lookup is read-only.
        </p>
      ) : null}
      {run.status === "ready" && run.traced === 0 ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          No source is recorded for these annotations. Expected for anything
          curated before provenance was captured — it isn&apos;t a problem with
          the annotations.
        </p>
      ) : null}
      {run.status === "ready" && run.traced > 0 ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Hover a disc beside a tag or factor for what produced it, and whether
          a human signed off.
        </p>
      ) : null}
    </section>
  );
}
