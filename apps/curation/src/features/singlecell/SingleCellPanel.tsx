import { useMemo } from "react";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { Term } from "@/components/ui/Term";
import type { Tag } from "@/features/experiment/types";
import { useDatasetSubsets, type DistinctSubset } from "@/api/subsets";
import {
  groundedCount,
  useCellTypeAssignment,
  type CellTypeAssignmentResult,
} from "@/api/cellTypeAssignment";

/**
 * Panel for the modality-gated "Single-cell" tab. Surfaces the cell
 * types this experiment actually has, WHO ASSIGNED THEM, and the
 * subsets Gemma has already cut.
 *
 * 🛑 **The summary used to count `draft.tags` alone and say "No cell
 * types annotated on this experiment yet" whenever that came up empty.**
 * On eid 38651 that sentence sat above eleven cell types — the count
 * was of the wrong thing, not of nothing. A single-cell experiment's
 * cell types live on its SUBSETS; a `cell type` EE tag is a second,
 * rarer place. Counting one and reporting it as the total is the bug,
 * so the count is now the union and an empty state has to be empty in
 * BOTH before it says so.
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
 * - A positive "the submitter supplied these" signal, once Gemma has
 *   one to read. Today the absence of an assignment is all there is,
 *   and it is deliberately not rendered as authorship.
 *
 * Renders only when the modality is single-cell — gated at the tab
 * bar in ExperimentBanner.
 */
/** Every distinct cell type on this experiment, from BOTH places one
 *  can live — a `cell type` EE tag, and a subset's own characteristic.
 *
 *  🛑 **Counting only the first is what produced "No cell types
 *  annotated on this experiment yet" above eleven of them** (eid 38651,
 *  2026-08-31). The union is the count; either source alone is a
 *  half-answer that reads as a whole one.
 *
 *  Keyed on the URI when there is one and on the lower-cased label
 *  otherwise, so a term carried in both places counts once — and two
 *  differently-cased spellings of an ungrounded label do not become two
 *  cell types. The first spelling seen wins, because there is no
 *  authority here to prefer one over the other.
 *
 *  Exported for test. */
export function distinctCellTypes(
  tags: Tag[],
  subsets: DistinctSubset[],
): { label: string; uri: string | null }[] {
  const seen = new Map<string, { label: string; uri: string | null }>();
  const add = (label: string, uri: string | null) => {
    const trimmed = label.trim();
    const key = uri || trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) return;
    seen.set(key, { label: trimmed, uri });
  };
  for (const t of tags) add(t.value?.label || "", t.value?.uri ?? null);
  for (const s of subsets) {
    for (const c of s.characteristics) {
      if ((c.category || "").trim().toLowerCase() !== "cell type") continue;
      add(c.value || "", c.value_uri ?? null);
    }
  }
  return [...seen.values()];
}

export function SingleCellPanel() {
  const { draft } = useDesignDraft();
  const tagCellTypes = useMemo(() => {
    return (draft?.tags ?? []).filter(
      (t) => (t.category?.label || "").trim().toLowerCase() === "cell type",
    );
  }, [draft?.tags]);
  const subsets = useDatasetSubsets(draft?.experiment_id);
  const assignment = useCellTypeAssignment(draft?.experiment_id);

  const cellTypes = useMemo(
    () => distinctCellTypes(tagCellTypes, subsets.data?.subsets ?? []),
    [tagCellTypes, subsets.data],
  );

  // Never claim "none" while a fetch that could produce some is still
  // running — that is the same wrong-count sentence, one beat earlier.
  const stillLooking = subsets.isLoading;

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

        {stillLooking ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 italic">
            Looking for cell types…
          </p>
        ) : cellTypes.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 italic">
            No cell types on this experiment — none on its subsets and
            none as an experiment tag. Cluster-then-annotate happens
            downstream, so a freshly imported study often has none yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {cellTypes.map((t, i) => (
              <Term key={`${t.uri ?? t.label}-${i}`} uri={t.uri} asLink={false}>
                {t.label}
              </Term>
            ))}
          </div>
        )}

        <AssignedBy result={assignment.data} loading={assignment.isLoading} />

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


/** Who assigned the cell types.
 *
 *  🛑 **Two states, and the second is a gap rather than an answer.** An
 *  assignment names what made it (`sc-pipeline-2.0.0-family` is ours).
 *  No assignment means Gemma has no record of one — which is NOT the
 *  same as "the submitter supplied these", and must not be rendered as
 *  though it were. Gemma has no submitter-supplied marker to read, so
 *  the honest surface says what is missing and stops. */
function AssignedBy({
  result,
  loading,
}: {
  result?: CellTypeAssignmentResult;
  loading: boolean;
}) {
  if (loading || !result) return null;

  if (result.state === "none") {
    return (
      <div className="text-[11px] leading-relaxed rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
        <span className="font-semibold">Assigned by — not recorded.</span>{" "}
        Gemma holds no cell-type assignment for this dataset
        {result.reason ? ` (${result.reason})` : ""}. Any cell types above
        came in on the subsets. Gemma does not record whether a label was
        the submitter&apos;s, so this is a missing record, not evidence
        that the authors wrote them.
      </div>
    );
  }

  const a = result.assignment;
  const total = (a.cell_types ?? []).length;
  const grounded = groundedCount(a);
  return (
    <div className="text-[11px] leading-relaxed rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
      <span className="font-semibold">Assigned by</span>{" "}
      <span className="font-mono">{a.name || "(unnamed assignment)"}</span>
      {a.preferred ? " · preferred" : ""}
      {typeof a.number_of_assigned_cells === "number"
        ? ` · ${a.number_of_assigned_cells.toLocaleString()} cells assigned`
        : ""}
      {total > 0 ? (
        <>
          {" · "}
          {grounded} of {total} grounded
        </>
      ) : null}
    </div>
  );
}
