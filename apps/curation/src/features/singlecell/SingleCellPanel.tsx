import { useMemo } from "react";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { Term } from "@/components/ui/Term";
import { useDatasetSubsets, type DistinctSubset } from "@/api/subsets";

/**
 * Panel for the modality-gated "Single-cell" tab. Surfaces the
 * count + list of cell-type tags inferred from the experiment's
 * annotations, and the subsets Gemma has already cut.
 *
 * 🛑 **The subsets are where a single-cell experiment's cell-type
 * annotations actually live**, and nothing in either app read them
 * before 2026-08-31 — 275 subsets carrying 45 cell-type terms on
 * eid 44580 appeared nowhere, which is not a display gap so much as a
 * curation surface that did not exist. They are not factor values and
 * not experiment tags, so neither the design nor the tag bar was ever
 * going to show them; see `api/subsets.ts` for the shape and for the
 * row-count caveat this panel prints.
 *
 * Future work:
 *
 * - Cell-bucket sub-BMs view (once the curation importer ingests
 *   them — they're discovered via ``sourceBioMaterial`` linkage,
 *   not via ``/datasets/{id}/samples``).
 * - An affordance on an ungrounded subset cell type. They are ~23%
 *   of them corpus-wide and are exactly the curation work this tab
 *   should hand over; there is no write path for a subset
 *   characteristic yet, so today it is shown and marked only.
 * - SingleCellDimension cell-counts (cells per cell type per
 *   library) — needs a wire add.
 * - Per-cell-type DEA pointers — the agents side / browser-side cross-ref.
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
  const subsets = useDatasetSubsets(draft?.experiment_id);

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

      <SubsetsCard summary={subsets.data} loading={subsets.isLoading} />
    </div>
  );
}

/** The subsets Gemma has already cut, and the annotations they carry.
 *
 *  Renders nothing when there are none — most bulk experiments — so the
 *  card's presence is itself the signal that this experiment has
 *  downstream structure. */
function SubsetsCard({
  summary,
  loading,
}: {
  summary?: { subsets: DistinctSubset[]; rowCount: number; commonPrefix: string };
  loading: boolean;
}) {
  if (loading) {
    return (
      <article className="card p-4">
        <p className="text-sm text-slate-500 dark:text-slate-400 italic">
          Loading subsets…
        </p>
      </article>
    );
  }
  if (!summary || summary.subsets.length === 0) return null;

  const { subsets, rowCount, commonPrefix } = summary;
  const duplicated = rowCount > subsets.length;

  return (
    <article className="card p-4 space-y-3">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Subsets in Gemma
        </h2>
        <span className="text-[11px] uppercase tracking-wide text-violet-700 dark:text-violet-300 font-semibold px-2 py-0.5 rounded border border-violet-200 bg-violet-50 dark:border-violet-700 dark:bg-violet-900/30">
          {subsets.length} subset{subsets.length === 1 ? "" : "s"}
        </span>
      </header>

      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
        Already cut, not proposed — the split recommendations on the
        Design tab are a separate thing. A single-cell subset carries its
        own <code>cell type</code> annotation, which belongs to no factor
        and appears on no other tab.
      </p>

      {commonPrefix ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Names share the prefix{" "}
          <span className="font-mono">{commonPrefix.trim()}</span>, trimmed
          below.
        </p>
      ) : null}

      <ul className="space-y-1.5">
        {subsets.map((s) => {
          const label = commonPrefix
            ? s.name.slice(commonPrefix.length) || s.name
            : s.name;
          return (
            <li key={s.id} className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm text-slate-800 dark:text-slate-200">
                {label}
              </span>
              {s.characteristics.map((c, i) => (
                <Term
                  key={`${c.id ?? i}`}
                  uri={c.value_uri ?? null}
                  asLink={false}
                  title={c.category ? `${c.category}` : undefined}
                >
                  {c.value || "(unlabeled)"}
                </Term>
              ))}
              {s.rows > 1 ? (
                <span className="text-[11px] text-amber-700 dark:text-amber-300">
                  ×{s.rows} rows
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      {duplicated ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
          Gemma returned {rowCount} subset rows under {subsets.length}{" "}
          distinct names. The duplication is real and corpus-wide (2.4×
          across 47,143 rows, worse on some experiments) and nobody has
          explained it yet, so both numbers are shown rather than the
          collapsed list alone.
        </p>
      ) : null}
    </article>
  );
}
