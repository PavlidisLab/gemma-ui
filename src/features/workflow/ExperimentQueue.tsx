/**
 * Experiment list for the workflow page. Used for "all experiments",
 * pipeline groups, and review groups.
 *
 * Uses the paginated GET /rest/v2/datasets endpoint — server-side
 * search, filter, sort, and pagination. 50 rows per page. Pipeline
 * status is loaded in one bulk request per page.
 */
import { useGroup, usePipelineStatusBulk, useDatasetsPaginated } from "@/api/workflow";
import { useMemo, useState } from "react";
import { PipelineStatusRow } from "./PipelineStatusRow";

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
// Main component
// ---------------------------------------------------------------------------

export function ExperimentQueue({ groupId }: { groupId?: string }) {
  const [activeFilter, setActiveFilter] = useState<QuickFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("-lastUpdated");
  const [offset, setOffset] = useState(0);

  const { data: group } = useGroup(groupId ?? null);

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
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
        <h1 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          {heading}
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
