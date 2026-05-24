import { useMemo } from "react";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { Term } from "@/components/ui/Term";

/**
 * Placeholder panel for the modality-gated "Single-cell" tab. Today
 * surfaces the count + list of cell-type tags inferred from the
 * experiment's annotations. Future work (see
 * [[single-cell-summary-tab]] memory):
 *
 * - Cell-bucket sub-BMs view (once the curation importer ingests
 *   them — they're discovered via ``sourceBioMaterial`` linkage,
 *   not via ``/datasets/{id}/samples``).
 * - SingleCellDimension cell-counts (cells per cell type per
 *   library) — needs a wire add.
 * - Per-cell-type DEA pointers — bro 2 / browser-side cross-ref.
 * - Free-text vs ontology-resolved breakdown of cell-type
 *   characteristics on sub-BMs, with a one-click "propose
 *   resolution" affordance.
 *
 * Renders only when the modality is single-cell — gated at the tab
 * bar in ExperimentBanner.
 */
export function SingleCellPanel() {
  const { draft } = useDesignDraft();
  const cellTypes = useMemo(() => {
    return (draft?.tags ?? []).filter(
      (t) => (t.category?.label || "").trim().toLowerCase() === "cell type",
    );
  }, [draft?.tags]);

  return (
    <div className="space-y-4">
      <article className="card p-4 space-y-3">
        <header className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Single-cell summary
          </h2>
          <span className="text-[11px] uppercase tracking-wide text-violet-700 dark:text-violet-300 font-semibold px-2 py-0.5 rounded border border-violet-200 bg-violet-50 dark:border-violet-700 dark:bg-violet-900/30">
            {cellTypes.length} cell type{cellTypes.length === 1 ? "" : "s"}
          </span>
        </header>

        {cellTypes.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 italic">
            No cell types annotated on this experiment yet. Single-cell
            studies typically don&apos;t have cell types assigned until
            after preboarding — cluster-then-annotate happens
            downstream and lands as inferred ``cell type`` tags on
            the experiment.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {cellTypes.map((t, i) => (
              <Term
                key={`${t.value?.uri ?? t.value?.label ?? i}`}
                uri={t.value?.uri ?? null}
                asLink={false}
              >
                {t.value?.label || "(unlabeled cell type)"}
              </Term>
            ))}
          </div>
        )}

        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          More single-cell-specific surfaces are planned for this tab
          — cell-bucket sub-BMs, cells per cell type, per-cell-type
          DEA pointers, and a free-text-vs-ontology-resolved
          breakdown of the cell-type characteristics.
        </p>
      </article>
    </div>
  );
}
