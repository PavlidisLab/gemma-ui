/**
 * Candidate screening queue for a screening-type group.
 *
 * Shows candidates loaded from GET /rest/v2/candidates filtered to
 * the current group's member_ids. Includes:
 *  - status filter pills (pending / in_review / approved / excluded /
 *    deferred / loaded / all)
 *  - source filter (GEO / ArrayExpress / SRA / manual)
 *  - source_batch filter (populated dynamically from visible candidates)
 *  - text search (accession, title)
 *  - bulk intake button (opens inline paste form)
 *  - one CandidateRow per match
 */
import {
  useCandidates,
  useCreateCandidatesBulk,
  useGroup,
} from "@/api/workflow";
import type { CandidateSource, CandidateStatus } from "@/api/workflowTypes";
import { useMemo, useState } from "react";
import { CandidateRow } from "./CandidateRow";

// ---------------------------------------------------------------------------
// Status filter pills
// ---------------------------------------------------------------------------

const ALL_STATUSES: CandidateStatus[] = [
  "pending",
  "in_review",
  "approved",
  "excluded",
  "deferred",
  "loaded",
];

const STATUS_LABEL: Record<CandidateStatus, string> = {
  pending:   "Pending",
  in_review: "In review",
  approved:  "Approved",
  excluded:  "Excluded",
  deferred:  "Deferred",
  loaded:    "Loaded",
};

const SOURCES: CandidateSource[] = ["GEO", "ArrayExpress", "SRA", "manual"];

// ---------------------------------------------------------------------------
// Bulk intake form
// ---------------------------------------------------------------------------

function BulkIntakeForm({
  onClose,
  reviewer,
}: {
  onClose: () => void;
  reviewer: string;
}) {
  const [source, setSource] = useState<CandidateSource>("GEO");
  const [batchLabel, setBatchLabel] = useState("");
  const [rawAccessions, setRawAccessions] = useState("");
  const bulk = useCreateCandidatesBulk();

  function submit() {
    const accessions = rawAccessions
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!accessions.length || !batchLabel.trim()) return;
    bulk.mutate(
      {
        source,
        source_batch: batchLabel.trim(),
        items: accessions.map((accession) => ({ accession })),
      },
      {
        onSuccess: () => {
          setBatchLabel("");
          setRawAccessions("");
          onClose();
        },
      },
    );
  }

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg mx-4 my-3 p-4 bg-white dark:bg-slate-900 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          Bulk intake
        </span>
        <button
          onClick={onClose}
          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          cancel
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] text-slate-500">Source</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as CandidateSource)}
            className="text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-0.5 flex-1">
          <label className="text-[10px] text-slate-500">
            Batch label (e.g. "GEO scrape 2025-10")
          </label>
          <input
            value={batchLabel}
            onChange={(e) => setBatchLabel(e.target.value)}
            placeholder="Batch label…"
            className="text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] text-slate-500">
          Accessions (one per line, or comma/space separated)
        </label>
        <textarea
          value={rawAccessions}
          onChange={(e) => setRawAccessions(e.target.value)}
          rows={5}
          placeholder={"GSE12345\nGSE67890\nE-MTAB-1234"}
          className="text-xs font-mono rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 resize-y focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {bulk.isError && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {(bulk.error as Error).message}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          disabled={
            !batchLabel.trim() ||
            !rawAccessions.trim() ||
            bulk.isPending
          }
          onClick={submit}
          className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition-colors"
        >
          {bulk.isPending
            ? "Adding…"
            : `Add ${rawAccessions.split(/[\s,;]+/).filter(Boolean).length || 0} candidates`}
        </button>
        <span className="text-[10px] text-slate-400">
          Added by: {reviewer}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ScreeningQueue({
  groupId,
  reviewer,
}: {
  groupId: string;
  reviewer: string;
}) {
  const { data: group } = useGroup(groupId);

  const [statusFilter, setStatusFilter] = useState<CandidateStatus | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<CandidateSource | "all">("all");
  const [batchFilter, setBatchFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showBulkIntake, setShowBulkIntake] = useState(false);

  // Fetch candidates for this group by passing member IDs.
  // The group's member_ids are candidate UUIDs for screening groups.
  const memberIdSet = useMemo(
    () => new Set(group?.member_ids ?? []),
    [group],
  );

  // Load all candidates (unfiltered at server level — screening groups
  // are bounded by design; filtering is client-side for instant response).
  const { data: allCandidates = [], isLoading } = useCandidates();

  // Restrict to group members.
  const groupCandidates = useMemo(
    () =>
      group
        ? allCandidates.filter((c) => memberIdSet.has(c.id))
        : allCandidates,
    [allCandidates, memberIdSet, group],
  );

  // Collect unique source_batch labels for the batch filter dropdown.
  const batchOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const c of groupCandidates) {
      if (c.source_batch) seen.add(c.source_batch);
    }
    return Array.from(seen).sort();
  }, [groupCandidates]);

  // Apply filters.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groupCandidates.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (sourceFilter !== "all" && c.source !== sourceFilter) return false;
      if (batchFilter !== "all" && c.source_batch !== batchFilter) return false;
      if (q) {
        const hay = `${c.accession} ${c.title ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [groupCandidates, statusFilter, sourceFilter, batchFilter, search]);

  // Status counts for pill badges.
  const statusCounts = useMemo(() => {
    const counts: Partial<Record<CandidateStatus, number>> = {};
    for (const c of groupCandidates) {
      counts[c.status] = (counts[c.status] ?? 0) + 1;
    }
    return counts;
  }, [groupCandidates]);

  const heading = group?.name ?? "Screening queue";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {heading}
            </h1>
            {group && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                screening · {group.member_count} candidate{group.member_count !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <button
            onClick={() => setShowBulkIntake((v) => !v)}
            className="text-xs px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            + Bulk intake
          </button>
        </div>
      </div>

      {showBulkIntake && (
        <BulkIntakeForm
          reviewer={reviewer}
          onClose={() => setShowBulkIntake(false)}
        />
      )}

      {/* Filter bar */}
      <div className="flex items-start gap-2 px-4 py-2 border-b border-slate-100 dark:border-slate-800 flex-wrap bg-white dark:bg-slate-900 sticky top-0 z-10">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search accession or title…"
          className="text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 w-48 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />

        {/* Status pills */}
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setStatusFilter("all")}
            className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
              statusFilter === "all"
                ? "bg-blue-600 text-white"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            All ({groupCandidates.length})
          </button>
          {ALL_STATUSES.map((s) => {
            const count = statusCounts[s] ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                  statusFilter === s
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {STATUS_LABEL[s]} ({count})
              </button>
            );
          })}
        </div>

        {/* Source select */}
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as CandidateSource | "all")}
          className="text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">All sources</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {/* Batch select */}
        {batchOptions.length > 0 && (
          <select
            value={batchFilter}
            onChange={(e) => setBatchFilter(e.target.value)}
            className="text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">All batches</option>
            {batchOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Row list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="px-4 py-8 text-xs text-slate-400 dark:text-slate-600 text-center">
            Loading candidates…
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="px-4 py-8 text-xs text-slate-400 dark:text-slate-600 text-center">
            {groupCandidates.length === 0
              ? "No candidates in this group yet — use Bulk intake to add some."
              : "No candidates match this filter."}
          </div>
        )}
        {filtered.map((c) => (
          <CandidateRow key={c.id} candidate={c} reviewer={reviewer} />
        ))}
      </div>

      {/* Footer count */}
      {filtered.length > 0 && filtered.length !== groupCandidates.length && (
        <div className="px-4 py-1.5 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 text-[10px] text-slate-400 dark:text-slate-600 shrink-0">
          Showing {filtered.length} of {groupCandidates.length} candidates
        </div>
      )}
    </div>
  );
}
