import { useMemo } from "react";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { Term } from "@/components/ui/Term";
import type { Tag } from "@/features/experiment/types";
import {
  useDatasetSubsetGroups,
  type DistinctSubset,
  type SubsetGroupsSummary,
  type SubsetGroupView,
} from "@/api/subsets";
import {
  assignmentOrigin,
  cellTypeCounts,
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
  const subsets = useDatasetSubsetGroups(draft?.experiment_id);
  const assignment = useCellTypeAssignment(draft?.experiment_id);

  // 🛑 **Count the LIVE cut only.** A dataset commonly carries a
  // superseded subset group holding the author's raw strings for the
  // same cell types (eid 79038: `opc` beside `oligodendrocyte precursor
  // cell`), so unioning every group reports 20 cell types where there
  // are 10. When the live cut cannot be picked, fall back to every
  // group rather than silently showing one — an over-count a curator
  // can see beats a half-list they cannot.
  const countedSubsets = useMemo(() => {
    const groups = subsets.data?.groups ?? [];
    const live = groups.filter((g) => !g.superseded);
    return (live.length > 0 ? live : groups).flatMap((g) => g.subsets);
  }, [subsets.data]);

  const cellTypes = useMemo(
    () => distinctCellTypes(tagCellTypes, countedSubsets),
    [tagCellTypes, countedSubsets],
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

        <CellsPerType result={assignment.data} loading={assignment.isLoading} />

        <AssignedBy result={assignment.data} loading={assignment.isLoading} />

        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          More single-cell-specific surfaces are planned for this tab
          — cell-bucket sub-BMs, cells per cell type, per-cell-type
          DEA pointers, and a free-text-vs-ontology-resolved
          breakdown of the cell-type characteristics. Cells per
          LIBRARY needs no wire work either: <code>numberOfCells</code>
          is already on each row of{" "}
          <code>/datasets/{"{id}"}/samples</code>.
        </p>
      </article>

      <SubsetsCard summary={subsets.data} loading={subsets.isLoading} />
    </div>
  );
}

/** The subsets Gemma has already cut, **one block per subset group**.
 *
 *  🛑 **A flat list of subsets is a lie on 62% of single-cell
 *  datasets.** They carry more than one subset GROUP and all but one is
 *  a superseded cut — on eid 79038 the same ten cell types appear
 *  twice, once grounded to CL and once as the author's raw strings
 *  (`opc`, `t_cell`, `endothelia`). Merging them produced the
 *  interleaved list that made a curator ask which was which. The dead
 *  cut is routinely LARGER than the live one (eid 77392: live 8, dead
 *  36; eid 76967 has 31 dead groups), so it dominates any list that
 *  does not separate them.
 *
 *  Every group is shown — none is hidden — but the live one is open and
 *  the superseded ones start collapsed behind their own summary line.
 *  See `api/subsets.ts::summarizeSubsetGroups` for how live is decided
 *  and why it is the preferred quantitation type rather than "has a
 *  factor".
 *
 *  Renders nothing when there are none — most bulk experiments — so the
 *  card's presence is itself the signal that this experiment has
 *  downstream structure. */
function SubsetsCard({
  summary,
  loading,
}: {
  summary?: SubsetGroupsSummary;
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
  if (!summary) return null;

  const { groups, ungrouped, liveAmbiguous } = summary;
  const total = groups.reduce((n, g) => n + g.subsets.length, 0) + ungrouped.length;
  if (total === 0) return null;

  const supersededCount = groups.filter((g) => g.superseded).length;

  return (
    <article className="card p-4 space-y-3">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Subsets in Gemma
        </h2>
        <span className="text-[11px] uppercase tracking-wide text-violet-700 dark:text-violet-300 font-semibold px-2 py-0.5 rounded border border-violet-200 bg-violet-50 dark:border-violet-700 dark:bg-violet-900/30">
          {groups.length} group{groups.length === 1 ? "" : "s"} · {total}{" "}
          subset{total === 1 ? "" : "s"}
        </span>
      </header>

      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
        Already cut, not proposed — the split recommendations on the
        Design tab are a separate thing. A single-cell subset carries its
        own <code>cell type</code> annotation, which belongs to no factor
        and appears on no other tab.
      </p>

      {supersededCount > 0 ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          {supersededCount} of these {groups.length} group
          {groups.length === 1 ? "" : "s"}{" "}
          {supersededCount === 1 ? "is a" : "are"} superseded cut
          {supersededCount === 1 ? "" : "s"} — Gemma keeps them, but the
          analyses run on the live one. They are collapsed below, not
          hidden.
        </p>
      ) : null}

      {liveAmbiguous && groups.length > 1 ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
          Which cut is live could not be determined — no single group
          claims the preferred quantitation type. Nothing is marked
          superseded here; every group is shown open.
        </p>
      ) : null}

      <div className="space-y-3">
        {groups.map((g) => (
          <SubsetGroupBlock key={g.id} group={g} />
        ))}
      </div>

      {ungrouped.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
            {ungrouped.length} subset{ungrouped.length === 1 ? "" : "s"} in
            no group
          </p>
          <SubsetList subsets={ungrouped} commonPrefix="" />
        </div>
      ) : null}
    </article>
  );
}

/** One subset group. Live groups render open; superseded ones collapse
 *  behind a summary line that still says how big they are and what they
 *  hold, so a curator can decide whether to look without opening. */
function SubsetGroupBlock({ group }: { group: SubsetGroupView }) {
  const { subsets, rowCount, commonPrefix, superseded, groundedCount } = group;
  const duplicated = rowCount > subsets.length;
  const allGrounded = groundedCount === subsets.length && subsets.length > 0;
  const noneGrounded = groundedCount === 0;

  const summaryLine = (
    <span className="flex flex-wrap items-baseline gap-2">
      <span
        className={
          superseded
            ? "text-[11px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400"
            : "text-[11px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
        }
      >
        {superseded ? "superseded" : "live"}
      </span>
      <span className="text-sm text-slate-800 dark:text-slate-200">
        {subsets.length} subset{subsets.length === 1 ? "" : "s"}
      </span>
      <span className="text-[11px] text-slate-500 dark:text-slate-400">
        {allGrounded
          ? "all grounded"
          : noneGrounded
            ? "none grounded"
            : `${groundedCount} of ${subsets.length} grounded`}
        {group.factorNames.length > 0
          ? ` · cut on ${group.factorNames.join(", ")}`
          : " · no factor"}
        {" · group "}
        {group.id}
      </span>
    </span>
  );

  const body = (
    <>
      {commonPrefix ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Names share the prefix{" "}
          <span className="font-mono">{commonPrefix.trim()}</span>, trimmed
          below.
        </p>
      ) : null}
      <SubsetList subsets={subsets} commonPrefix={commonPrefix} />
      {duplicated ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
          {rowCount} rows under {subsets.length} names inside this one
          group — the repetition is not the group split.
        </p>
      ) : null}
    </>
  );

  if (superseded) {
    return (
      <details className="rounded border border-slate-200 dark:border-slate-700 px-2.5 py-2">
        <summary className="cursor-pointer">{summaryLine}</summary>
        <div className="mt-2 space-y-1.5 opacity-70">{body}</div>
      </details>
    );
  }

  return (
    <div className="rounded border border-emerald-200 dark:border-emerald-800 px-2.5 py-2 space-y-1.5">
      {summaryLine}
      {body}
    </div>
  );
}

/** The subsets themselves — name, then whatever terms it carries. */
function SubsetList({
  subsets,
  commonPrefix,
}: {
  subsets: DistinctSubset[];
  commonPrefix: string;
}) {
  return (
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
  );
}


/** Cells per cell type — the line Gemma 1.0 prints beside each subset
 *  (`[Subset: astrocyte] [Cells: 14,113]`).
 *
 *  Sourced from the ASSIGNMENT, not from the subsets, so it covers only
 *  the cell types the assignment knows. That is deliberate: the count is
 *  a property of the cell-level assignment and attributing it to a
 *  subset that merely shares a label would be inventing a join.
 *
 *  🛑 **A missing count renders as nothing, never as 0.** The tally is
 *  absent on a host predating 2026-09-03, and `numberOfCells` is null on
 *  63 of prod's 546 single-cell datasets — null means "not counted", and
 *  a dataset whose cells were never counted must not be shown as
 *  containing none. */
function CellsPerType({
  result,
  loading,
}: {
  result?: CellTypeAssignmentResult;
  loading: boolean;
}) {
  if (loading || !result || result.state !== "assignment") return null;
  const counts = cellTypeCounts(result.assignment);
  const counted = counts.filter((c) => c.cells != null);
  if (counted.length === 0) return null;

  const total = counted.reduce((n, c) => n + (c.cells ?? 0), 0);
  const max = Math.max(...counted.map((c) => c.cells ?? 0));

  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
        Cells per cell type
        <span className="font-normal text-slate-500 dark:text-slate-400">
          {" · "}
          {total.toLocaleString()} assigned
          {counted.length < counts.length
            ? ` · ${counts.length - counted.length} not counted`
            : ""}
        </span>
      </p>
      <ul className="space-y-0.5">
        {counts.map((c) => (
          <li
            key={c.id ?? c.label}
            className="flex items-baseline gap-2 text-[11px]"
          >
            <span className="w-52 shrink-0 truncate text-slate-700 dark:text-slate-300">
              {c.label}
            </span>
            {c.cells == null ? (
              <span className="italic text-slate-400 dark:text-slate-500">
                not counted
              </span>
            ) : (
              <>
                {/* Proportion bar. Widths are relative to the LARGEST
                    type, not to the total — on a dataset where one type
                    is 39% and the rest are single digits, scaling to the
                    total leaves eight bars indistinguishable from zero. */}
                <span
                  aria-hidden
                  className="h-1.5 rounded-sm bg-violet-300 dark:bg-violet-700"
                  style={{ width: `${Math.max(2, ((c.cells ?? 0) / max) * 100)}px` }}
                />
                <span className="tabular-nums text-slate-600 dark:text-slate-400">
                  {c.cells.toLocaleString()}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
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
  const origin = assignmentOrigin(a.name);
  // The question was "our pipeline, or the authors of the study?" — so
  // answer in those words and show the name it was read from, rather
  // than making a curator decode `sc-pipeline-2.0.0-family`.
  const who =
    origin === "authors"
      ? "the study's authors"
      : origin === "pipeline"
        ? "our single-cell pipeline"
        : null;
  return (
    <div className="text-[11px] leading-relaxed rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
      <span className="font-semibold">Assigned by</span>{" "}
      {who ? <span className="font-semibold">{who}</span> : null}
      {who ? " — " : ""}
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
