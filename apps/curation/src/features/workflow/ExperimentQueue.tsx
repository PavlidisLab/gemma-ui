/**
 * Experiment list for the workflow page. Used for "all experiments",
 * pipeline groups, and review groups.
 *
 * Uses the paginated GET /rest/v2/datasets endpoint — server-side
 * search, filter, sort, and pagination. 50 rows per page. Pipeline
 * status is loaded in one bulk request per page.
 */
import {
  useGroup,
  usePipelineStatusBulk,
  useDatasetsPaginated,
  useFinalizeGroup,
  useReopenGroup,
} from "@/api/workflow";
import { useMemo, useState } from "react";
import { PipelineStatusRow } from "./PipelineStatusRow";
import { useMe } from "@/api/session";
import { useToast } from "@/components/ui/Toast";
import { exportSetAsGzip } from "./exportSet";
import type { Group } from "@/api/workflowTypes";
import { readDirtyExperimentIds } from "@/features/design/draftCache";
import { useMyTickets } from "@/api/tickets";
import { taskKindHeaderLabel } from "./nextTask";
import { SetProgressBar } from "@/components/ui/SetProgressBar";
import { progressFromGroup } from "./setProgress";
import { cn } from "@/lib/cn";

const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Sort selector
// ---------------------------------------------------------------------------

type SortKey =
  | "-lastUpdated"
  | "+shortName"
  | "-numberOfBioAssays"
  | "-geeq.publicQualityScore";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "-lastUpdated",           label: "Recently updated" },
  { value: "+shortName",             label: "Accession A→Z" },
  { value: "-numberOfBioAssays",     label: "Most samples" },
  { value: "-geeq.publicQualityScore", label: "Best quality" },
];

// ---------------------------------------------------------------------------
// Quick filters
// ---------------------------------------------------------------------------

type QuickFilter =
  | "all"
  | "troubled"
  | "needs_attention"
  | "not_public";

const QUICK_FILTERS: { id: QuickFilter; label: string; serverFilter?: string }[] = [
  { id: "all",             label: "All" },
  { id: "troubled",        label: "Troubled",       serverFilter: "troubled=true" },
  { id: "needs_attention", label: "Needs attention", serverFilter: "needs_attention=true" },
  { id: "not_public",      label: "Not public",     serverFilter: "is_public=false" },
];

// ---------------------------------------------------------------------------
// Filter / sort bar
// ---------------------------------------------------------------------------

function FilterBar({
  active,
  onChange,
  search,
  onSearch,
  sort,
  onSort,
}: {
  active: QuickFilter;
  onChange: (f: QuickFilter) => void;
  search: string;
  onSearch: (s: string) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 dark:border-slate-800 flex-wrap bg-white dark:bg-slate-900 sticky top-0 z-10">
      <input
        type="search"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search by accession or title…"
        className="text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 w-52 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <div className="flex items-center gap-1 flex-wrap">
        {QUICK_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => onChange(f.id)}
            className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
              active === f.id
                ? "bg-blue-600 text-white"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <select
        value={sort}
        onChange={(e) => onSort(e.target.value as SortKey)}
        className="ml-auto text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination bar
// ---------------------------------------------------------------------------

function PaginationBar({
  offset,
  limit,
  total,
  onPrev,
  onNext,
}: {
  offset: number;
  limit: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-500 dark:text-slate-400 shrink-0">
      <span>
        {from}–{to} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <button
          disabled={offset === 0}
          onClick={onPrev}
          className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          ‹ Prev
        </button>
        <button
          disabled={offset + limit >= total}
          onClick={onNext}
          className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          Next ›
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export-Set button
// ---------------------------------------------------------------------------

/** Big, prominent action: bundle every experiment in this Set into
 *  a gzipped JSON file and download it. The stand-in for the
 *  yet-to-land direct POST to the curation agent — same payload
 *  shape will eventually be the request body. */
function ExportSetButton({ group }: { group: Group }) {
  const { data: me } = useMe();
  const toast = useToast();
  const [running, setRunning] = useState(false);

  async function handleExport() {
    setRunning(true);
    try {
      const curator = me?.username || me?.full_name || "unknown";
      const bundle = await exportSetAsGzip(group, curator);
      const ok = bundle.experiments.filter((e) => !e.error).length;
      const failed = bundle.experiments.length - ok;
      const skipped = bundle.skipped.length;
      const parts = [`${ok} experiment${ok === 1 ? "" : "s"}`];
      if (failed > 0) parts.push(`${failed} failed`);
      if (skipped > 0) parts.push(`${skipped} skipped`);
      toast.show(
        `Exported ${parts.join(", ")}.`,
        failed > 0 ? "warn" : "success",
        5000,
      );
    } catch (err) {
      toast.show(
        `Export failed: ${(err as Error).message || String(err)}`,
        "danger",
        6000,
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={running || group.member_count === 0}
      title={
        group.member_count === 0
          ? "this set has no members"
          : `Download a gzipped JSON snapshot of the final curation for all ${group.member_count} experiment${group.member_count === 1 ? "" : "s"} in this set`
      }
      className={
        running
          ? "shrink-0 text-sm font-semibold px-4 py-2 rounded-md bg-blue-200 text-blue-700 cursor-progress"
          : "shrink-0 text-sm font-semibold px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 shadow-sm disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none disabled:cursor-not-allowed"
      }
    >
      {running ? "Exporting…" : "Export Set"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Finalize / Reopen set
// ---------------------------------------------------------------------------

/** Set-level lifecycle button — flips ``Group.finalized_at`` via
 *  POST /groups/{id}/finalize. Reads the current state from the
 *  Group payload: if not finalized, shows "Finalize set" (slate);
 *  if finalized, shows "Reopen" (slate) + a small "finalized
 *  YYYY-MM-DD" inline indicator next to it. Idempotent-refresh on
 *  re-finalize per the server contract — clicking Finalize on a
 *  finalized set isn't possible from this UI (button toggles to
 *  Reopen instead). */
function FinalizeSetButton({ group }: { group: Group }) {
  const { data: me } = useMe();
  const reviewer = me?.username || me?.full_name || "unknown";
  const toast = useToast();
  const finalize = useFinalizeGroup(group.id);
  const reopen = useReopenGroup(group.id);
  const [confirming, setConfirming] = useState<"finalize" | null>(null);
  const [notes, setNotes] = useState("");
  const isFinalized = !!group.finalized_at;
  const saving = finalize.isPending || reopen.isPending;

  function doFinalize() {
    finalize.mutate(
      { reviewer, notes: notes.trim() || undefined },
      {
        onSuccess: () => {
          setConfirming(null);
          setNotes("");
          toast.show("Set finalized.", "success");
        },
        onError: (err) => {
          toast.show(
            `Couldn't finalize set: ${(err as Error).message}`,
            "danger",
            6000,
          );
        },
      },
    );
  }

  function doReopen() {
    reopen.mutate(
      { reviewer },
      {
        onSuccess: () => {
          toast.show("Set reopened.", "success");
        },
        onError: (err) => {
          toast.show(
            `Couldn't reopen set: ${(err as Error).message}`,
            "danger",
            6000,
          );
        },
      },
    );
  }

  if (isFinalized) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1"
          title={
            group.finalized_at
              ? `finalized ${group.finalized_at}${group.finalized_by ? ` by ${group.finalized_by}` : ""}${group.finalized_notes ? ` — ${group.finalized_notes}` : ""}`
              : "finalized"
          }
        >
          <span aria-hidden>✓</span> finalized
        </span>
        <button
          type="button"
          onClick={doReopen}
          disabled={saving}
          title="Reopen this set so members can be re-edited. Per-experiment reviews stay as they are."
          className={cn(
            "shrink-0 text-xs font-medium px-3 py-1 rounded-md border",
            saving
              ? "border-slate-300 bg-slate-100 text-slate-500 cursor-progress dark:border-slate-600 dark:bg-slate-800"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
          )}
        >
          {saving ? "reopening…" : "Reopen"}
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming("finalize")}
        disabled={saving || group.member_count === 0}
        title={
          group.member_count === 0
            ? "this set has no members"
            : "Mark this set as done. Members stay editable individually; the set just marks 'I'm done with this grouping.'"
        }
        className={cn(
          "shrink-0 text-sm font-medium px-3 py-2 rounded-md border",
          saving
            ? "border-emerald-300 bg-emerald-100 text-emerald-700 cursor-progress dark:border-emerald-700 dark:bg-emerald-900/40"
            : "border-emerald-600 bg-white text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:bg-slate-800 dark:text-emerald-300 dark:hover:bg-emerald-900/30 disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        Finalize set
      </button>
      {confirming === "finalize" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) setConfirming(null);
          }}
        >
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 w-full max-w-md p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Finalize set "{group.name}"?
            </h2>
            <p className="text-sm text-slate-700 dark:text-slate-300">
              Marks this set as done. Members stay editable
              individually — finalize is curator intent on the
              grouping, not a lock on the per-experiment reviews.
              Reopen any time.
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="optional finalize note (handoff context, what's left, etc.)"
              className="w-full text-xs border border-slate-300 dark:border-slate-600 dark:bg-slate-800 rounded px-2 py-1.5 resize-y"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                disabled={saving}
                className="text-xs px-3 py-1 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                cancel
              </button>
              <button
                type="button"
                onClick={doFinalize}
                disabled={saving}
                className={cn(
                  "text-xs px-3 py-1 rounded font-semibold",
                  saving
                    ? "bg-emerald-200 text-emerald-700 cursor-progress dark:bg-emerald-900/40 dark:text-emerald-200"
                    : "bg-emerald-600 text-white hover:bg-emerald-700",
                )}
              >
                {saving ? "finalizing…" : "Finalize"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ExperimentQueue({ groupId }: { groupId?: string }) {
  const [activeFilter, setActiveFilter] = useState<QuickFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("-lastUpdated");
  const [offset, setOffset] = useState(0);

  // ``includeSummaries`` so the header progress bar can roll up
  // per-member audit_status without an extra round trip.
  const { data: group } = useGroup(groupId ?? null, {
    includeSummaries: true,
  });

  // Group-scoped view: pass member IDs as comma-separated ids param.
  const groupIds = useMemo(() => {
    if (!groupId || !group) return undefined;
    return group.member_ids.join(",");
  }, [groupId, group]);

  const filterStr = QUICK_FILTERS.find((f) => f.id === activeFilter)?.serverFilter;

  const { data: page, isLoading, isFetching } = useDatasetsPaginated({
    query: search.trim() || undefined,
    filter: filterStr,
    sort,
    limit: PAGE_SIZE,
    offset,
    ids: groupIds,
  });

  const rows = page?.data ?? [];
  const total = page?.total_elements ?? 0;

  const { data: statusMap = {} } = usePipelineStatusBulk(rows.map((r) => r.id));

  // Curator-side signals layered onto each row. Both are cheap:
  // - ``dirtyDraftIds``: one localStorage scan (no network). Keyed
  //   on the page's row list so it recomputes when the page
  //   changes; the popover-style "open + close" doesn't apply
  //   here (we're a persistent panel), so consider refining if
  //   curator commits a draft and expects the dot to flip without
  //   a route change.
  // - ``tickets``: cached by useMyTickets's query, shared with the
  //   curator dashboard.
  const dirtyDraftIds = useMemo(() => readDirtyExperimentIds(), [rows]);
  const { data: tickets } = useMyTickets();

  // For group-scoped views, the member_ids carry the prefix form
  // (`preboarding:1` vs bare `91188`). The /datasets rows ship the
  // numeric tail only. Build a numeric-id → original-member-id map
  // so PipelineStatusRow can navigate with the prefix preserved
  // (handoff: HANDOFF_2026-05-24_UI_PREBOARDING_DRILLDOWN.md).
  const memberIdByNumericId = useMemo(() => {
    const map = new Map<number, string>();
    for (const mid of group?.member_ids ?? []) {
      const tail = mid.includes(":") ? mid.split(":")[1] : mid;
      const numeric = Number(tail);
      if (Number.isFinite(numeric)) map.set(numeric, mid);
    }
    return map;
  }, [group]);

  // Reset to page 0 when filters change.
  function changeFilter(f: QuickFilter) {
    setActiveFilter(f);
    setOffset(0);
  }
  function changeSearch(s: string) {
    setSearch(s);
    setOffset(0);
  }
  function changeSort(s: SortKey) {
    setSort(s);
    setOffset(0);
  }

  const heading = group ? group.name : "All experiments";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
            {heading}
            {group ? (
              <span
                className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
                title={
                  group.task_kind
                    ? `Set task: ${group.task_kind}`
                    : "Set task derived from group type (no explicit task_kind set)"
                }
              >
                {taskKindHeaderLabel(group.task_kind, group.type)}
              </span>
            ) : null}
            {isFetching && (
              <span className="text-[10px] text-slate-400 dark:text-slate-600 font-normal">
                refreshing…
              </span>
            )}
          </h1>
          {group && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {group.type} · {group.member_count} experiment{group.member_count !== 1 ? "s" : ""}
            </p>
          )}
          {group ? (
            <div className="mt-2 max-w-md">
              <SetProgressBar
                counts={progressFromGroup(group, dirtyDraftIds)}
                size="regular"
                showCaption
              />
            </div>
          ) : null}
        </div>
        {group ? (
          <div className="flex items-center gap-2 shrink-0">
            <FinalizeSetButton group={group} />
            <ExportSetButton group={group} />
          </div>
        ) : null}
      </div>

      <FilterBar
        active={activeFilter}
        onChange={changeFilter}
        search={search}
        onSearch={changeSearch}
        sort={sort}
        onSort={changeSort}
      />

      {/* Row list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="px-4 py-8 text-xs text-slate-400 dark:text-slate-600 text-center">
            Loading experiments…
          </div>
        )}
        {!isLoading && rows.length === 0 && (
          <div className="px-4 py-8 text-xs text-slate-400 dark:text-slate-600 text-center">
            No experiments match this filter.
          </div>
        )}
        {rows.map((d) => (
          <PipelineStatusRow
            key={d.id}
            dataset={d}
            status={statusMap[String(d.id)]}
            groupContext={groupId}
            // Lossless identifier from the group's member_ids when
            // available; falls back to the dataset's numeric id (the
            // non-group / global queue view).
            navId={memberIdByNumericId.get(d.id) ?? String(d.id)}
            hasLocalDraft={dirtyDraftIds.has(String(d.id))}
            tickets={tickets ?? null}
            groupType={group?.type}
            groupTaskKind={group?.task_kind ?? null}
          />
        ))}
      </div>

      {/* Pagination */}
      {total > 0 && (
        <PaginationBar
          offset={offset}
          limit={PAGE_SIZE}
          total={total}
          onPrev={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          onNext={() => setOffset((o) => o + PAGE_SIZE)}
        />
      )}
    </div>
  );
}
