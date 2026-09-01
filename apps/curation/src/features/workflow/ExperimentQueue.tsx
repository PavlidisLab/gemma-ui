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
import { useEffect, useMemo, useState } from "react";
import { PipelineStatusRow, type BadgeTone } from "./PipelineStatusRow";
import { useMe } from "@/api/session";
import { useToast } from "@/components/ui/Toast";
import { exportSetAsGzip } from "./exportSet";
import type {
  ExperimentPipelineStatus,
  Group,
  PipelineStep,
  StepStatus,
} from "@/api/workflowTypes";
import { readDirtyExperimentIds } from "@/features/design/draftCache";
import { useTicket } from "@/api/tickets";
import { useAuditsForExperiments } from "@/api/audits";
import { useProposalReviewsForExperiments } from "@/api/reviewProposals";
import { reasonSlugLabel } from "@/features/audit/dispositionChips";
import {
  DISPOSITION_FILTER_ANY,
  DISPOSITION_STATUS_CHIPS,
  dispositionBadgeNoun,
  isDispositionFilterActive,
  mergeTriageRows,
  triageRowMatches,
  triageRowsForReport,
  type DispositionFilterState,
  type TriageRow,
} from "./dispositionFilter";
import { taskKindHeaderLabel } from "./nextTask";
import { SetProgressBar } from "@/components/ui/SetProgressBar";
import { progressFromGroup } from "./setProgress";
import { cn } from "@/lib/cn";
import { useStickyState } from "@/lib/useStickyState";
import { useGemmaMode } from "@/lib/gemmaMode";
import { maxDatasetPageSize } from "@/api/workflow";
import { rememberTicketMemberOrder } from "@/features/tickets/ticketMemberOrder";

/** Default page size + user-settable picker options.
 *
 *  Design review 2026-06-14 asked for a 200 default ("typical ticket fits in
 *  one page"). The agents side raised the ``/rest/v2/datasets`` cap from 100
 *  to 1000 to make that workable, so we ship the 200 default + headroom.
 *
 *  🛑 **Gemma did NOT follow, and in remote mode this row is capped at
 *  100** — see `MAX_DATASET_PAGE_SIZE`. So the options are filtered by
 *  mode rather than shipped as one list: a picker offering 500 against
 *  a server that refuses it hands the curator a 400 and no queue. The
 *  request itself is clamped too, so a stale sticky 200 cannot fire one
 *  either. */
const PAGE_SIZE_DEFAULT = 200;
const PAGE_SIZE_OPTIONS = [50, 100, 200, 500, 1000] as const;

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

/**
 * Progress-state filters that mirror the ticket-page Started /
 * Finished / Not started / All chips. Derived client-side from the
 * pipeline track step statuses on each row's
 * ``ExperimentPipelineStatus`` rather than the legacy server-side
 * ``troubled`` / ``needs_attention`` / ``is_public`` query params
 * (those are quality flags, not progress signals — different axis,
 * the curator's "where am I in the work" question keys off step
 * state).
 *
 * State derivation (10 steps: 5 analysis + 5 curation):
 *   - **Not started** — every step is ``not_run`` or ``na`` (no work
 *     yet, or steps that don't apply to this dataset).
 *   - **Finished**    — every step is ``ok`` or ``na`` (every
 *     applicable step is done).
 *   - **Started**     — anywhere in between — at least one step has
 *     left ``not_run`` but not every step has reached ``ok``.
 *     ``needs_attention`` / ``failed`` / ``in_progress`` all count
 *     as "started, more to do".
 *   - **All**         — no filter.
 *
 * Filter runs client-side on the rows the server returned (the
 * /datasets endpoint doesn't carry a "step-state aggregate" query
 * param yet — flag if curators hit pagination edge cases where a
 * page is mostly hidden after filtering).
 */
type QuickFilter =
  | "all"
  | "started"
  | "finished"
  | "not_started"
  | "uncommitted";

const QUICK_FILTERS: { id: QuickFilter; label: string }[] = [
  { id: "all",         label: "All" },
  { id: "started",     label: "Started" },
  { id: "finished",    label: "Finished" },
  { id: "not_started", label: "Not started" },
  { id: "uncommitted", label: "Uncommitted" },
];

type PipelineState = "not_started" | "started" | "finished" | "uncommitted";

/** Walk every step in both the analysis and curation tracks and
 *  reduce to one progress state. ``undefined`` status (no bulk row
 *  yet) is treated as "not_started" so a row not yet covered by
 *  the bulk fetch doesn't accidentally read as Finished. */
function derivePipelineState(
  status: ExperimentPipelineStatus | undefined,
): PipelineState {
  if (!status) return "not_started";
  const steps: PipelineStep[] = [
    status.analysis.missing_value_analysis,
    status.analysis.batch_info,
    status.analysis.preprocessing,
    status.analysis.dea,
    status.analysis.diagnostics,
    status.curation.design,
    status.curation.tags,
    status.curation.outlier_review,
    status.curation.batch_decision,
    status.curation.audit,
  ];
  let anyStarted = false;
  let allFinished = true;
  for (const step of steps) {
    const st: StepStatus = step.status;
    if (st === "na") continue; // n/a steps don't count for either gate.
    if (st !== "not_run") anyStarted = true;
    if (st !== "ok") allFinished = false;
  }
  if (allFinished && anyStarted) return "finished";
  if (anyStarted) return "started";
  return "not_started";
}

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
  counts,
  pageSize,
  onPageSize,
  total,
  offset,
  onPrev,
  onNext,
}: {
  active: QuickFilter;
  onChange: (f: QuickFilter) => void;
  search: string;
  onSearch: (s: string) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  /** Per-filter row count — visible on the chip so curators can see
   *  the filter is doing something even when their ticket only
   *  matches one bucket. Design review 2026-06-14: "these buttons don't do
   *  anything" — they did, but with a 1-experiment ticket 3 of 4
   *  chips emptied the list silently. Counts make the filter
   *  effect legible. */
  counts: Record<QuickFilter, number>;
  /** Page-size dropdown — Design review 2026-06-14: "extend what you have now
   *  to have a user-settable number per page, with a default of 200."
   *  Persisted in localStorage via useStickyState upstream. */
  pageSize: number;
  onPageSize: (n: number) => void;
  /** Pagination state — surfaced inline so it sits at the TOP of the
   *  list (was below the rows; the reviewer wanted it up here). */
  total: number;
  offset: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  // Only offer page sizes this backend will serve — Gemma caps
  // `/rest/v2/datasets` at 100 where the local store allows 1000.
  const pageSizeCap = maxDatasetPageSize(useGemmaMode().mode);
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + pageSize, total);
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
        {QUICK_FILTERS.map((f) => {
          const n = counts[f.id];
          // Uncommitted chip carries the amber dot's palette so the
          // chip + row-dot read as the same state. All others stay
          // on the blue active style.
          const isAmberChip = f.id === "uncommitted";
          const activeCls = isAmberChip
            ? "bg-amber-500 text-white"
            : "bg-blue-600 text-white";
          const idleCls = isAmberChip
            ? "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700";
          const activeCountCls = isAmberChip ? "text-amber-100" : "text-blue-100";
          const idleCountCls = isAmberChip
            ? "text-amber-600 dark:text-amber-400"
            : "text-slate-400 dark:text-slate-500";
          return (
            <button
              key={f.id}
              onClick={() => onChange(f.id)}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                active === f.id ? activeCls : idleCls
              }`}
            >
              {f.label}{" "}
              <span
                className={`text-[10px] ${
                  active === f.id ? activeCountCls : idleCountCls
                }`}
              >
                ({n})
              </span>
            </button>
          );
        })}
      </div>
      {/* Pagination + page-size — sits at the top per design review 2026-06-14
          ("the page navigation should be at the top"). Hidden when
          the whole list fits in one page since there's nothing to
          paginate. */}
      {total > pageSize ? (
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300">
          <button
            type="button"
            onClick={onPrev}
            disabled={offset === 0}
            title="Previous page"
            className="px-1 font-bold text-[14px] leading-none disabled:opacity-30 disabled:cursor-not-allowed hover:text-slate-900 dark:hover:text-slate-100"
          >
            ‹
          </button>
          <span className="tabular-nums">
            {from}–{to} of {total}
          </span>
          <button
            type="button"
            onClick={onNext}
            disabled={to >= total}
            title="Next page"
            className="px-1 font-bold text-[14px] leading-none disabled:opacity-30 disabled:cursor-not-allowed hover:text-slate-900 dark:hover:text-slate-100"
          >
            ›
          </button>
        </span>
      ) : (
        <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
          {total} {total === 1 ? "experiment" : "experiments"}
        </span>
      )}
      <select
        value={pageSize}
        onChange={(e) => onPageSize(Number(e.target.value))}
        title="Page size"
        className="text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {PAGE_SIZE_OPTIONS.filter((n) => n <= pageSizeCap).map((n) => (
          <option key={n} value={n}>
            {n}/page
          </option>
        ))}
      </select>
      <select
        value={sort}
        onChange={(e) => onSort(e.target.value as SortKey)}
        className="text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
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

// Pagination moved into FilterBar 2026-06-14 — the standalone
// ``PaginationBar`` is gone. The "‹ N–M of TOTAL ›" cluster lives at
// the top-right of the filter row.

// ---------------------------------------------------------------------------
// Finding-disposition filter (ticket context only)
// ---------------------------------------------------------------------------

/**
 * Second filter row for ticket queues: filter the target list by
 * finding disposition (status · reason · reviewer). Unlocks the
 * auto-triage workflow (handoff 2026-07-23): `agent-triage`
 * dispositions the bulk of a ticket's findings and leaves the
 * genuinely-uncertain pile as `needs_more_info`; this row is the one
 * click that shows the curator that pile.
 *
 * Collapsed by default — expanding it is what triggers the audit
 * fan-out (one GET per ticket target; a 400-target ticket is 400
 * requests, cached and shared with each row's sidebar). Collapsing
 * clears the filter so a hidden filter can never silently empty the
 * list.
 *
 * Counts are faceted: each status chip counts the targets that would
 * match if that status were selected, under the OTHER active axes —
 * and likewise for the reason / reviewer options. Counts span the
 * whole ticket, not the visible page (same rule as the progress
 * chips, design review 2026-06-14).
 */
function DispositionFilterBar({
  open,
  onToggle,
  filter,
  onFilter,
  rows,
  loaded,
  total,
}: {
  open: boolean;
  onToggle: () => void;
  filter: DispositionFilterState;
  onFilter: (f: DispositionFilterState) => void;
  /** Every triage row across the ticket's targets (loaded so far). */
  rows: TriageRow[];
  /** Experiments whose audit list has resolved / total targets. */
  loaded: number;
  total: number;
}) {
  const active = isDispositionFilterActive(filter);
  const loading = open && loaded < total;

  const countForStatus = (status: DispositionFilterState["status"]) =>
    rows.filter((r) => triageRowMatches(r, { ...filter, status })).length;

  // Observed option lists, counted under the other axes. Sorted by
  // count so the big buckets (the auto-triage reasons) lead.
  const optionCounts = (
    axis: "reason" | "reviewer",
  ): Array<{ value: string; n: number }> => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = r[axis];
      if (!v) continue;
      if (!triageRowMatches(r, { ...filter, [axis]: v })) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([value, n]) => ({ value, n }))
      .sort((a, b) => b.n - a.n || a.value.localeCompare(b.value));
  };

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-slate-100 dark:border-slate-800 flex-wrap bg-white dark:bg-slate-900">
      <button
        type="button"
        onClick={onToggle}
        title={
          open
            ? "Hide the finding-disposition filter (clears it)"
            : "Filter this ticket's targets by finding disposition — status, reason, reviewer"
        }
        className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
        aria-expanded={open}
      >
        Findings {open ? "▾" : "▸"}
      </button>
      {open ? (
        <>
          <div className="flex items-center gap-1 flex-wrap">
            {DISPOSITION_STATUS_CHIPS.map((c) => {
              const isActive = filter.status === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onFilter({ ...filter, status: c.id })}
                  className={`text-xs px-2.5 py-0.5 rounded-full transition-colors ${
                    isActive
                      ? "bg-violet-600 text-white"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                  }`}
                >
                  {c.label}{" "}
                  <span
                    className={`text-[10px] ${
                      isActive
                        ? "text-violet-100"
                        : "text-slate-400 dark:text-slate-500"
                    }`}
                  >
                    ({countForStatus(c.id)})
                  </span>
                </button>
              );
            })}
          </div>
          <select
            value={filter.reason}
            onChange={(e) => onFilter({ ...filter, reason: e.target.value })}
            title="Filter by the structured reason on the latest disposition"
            className="text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-500"
          >
            <option value="any">reason: any</option>
            {optionCounts("reason").map((o) => (
              <option key={o.value} value={o.value}>
                {reasonSlugLabel(o.value)} ({o.n})
              </option>
            ))}
          </select>
          <select
            value={filter.reviewer}
            onChange={(e) => onFilter({ ...filter, reviewer: e.target.value })}
            title="Filter by who made the disposition — agent-triage vs a curator"
            className="text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-500"
          >
            <option value="any">reviewer: any</option>
            {optionCounts("reviewer").map((o) => (
              <option key={o.value} value={o.value}>
                {o.value} ({o.n})
              </option>
            ))}
          </select>
          {loading ? (
            <span className="text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">
              loading dispositions… {loaded}/{total}
            </span>
          ) : null}
          {active ? (
            <button
              type="button"
              onClick={() => onFilter(DISPOSITION_FILTER_ANY)}
              title="Clear the disposition filter"
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            >
              clear ×
            </button>
          ) : null}
        </>
      ) : null}
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

export function ExperimentQueue({
  groupId,
  experimentIds,
  leadingBadge,
  ticketId,
}: {
  groupId?: string;
  /** Explicit list of experiment IDs to scope the queue by. Used by
   *  the ticket detail page to render the same row layout as the
   *  workflow page, without going through a Group. Takes precedence
   *  over ``groupId`` when both are set. */
  experimentIds?: number[];
  /** Optional badge rendered at the front of every row (before the
   *  status disc + accession). The ticket detail page uses this to
   *  surface the ticket task on each target — e.g. "Audit" on every
   *  row of an AUDIT-typed ticket. */
  leadingBadge?: { label: string; tone: BadgeTone };
  /** Ticket id whose targets are being listed. When set, each row's
   *  click-through navigation appends ``?ticket=<id>`` so the
   *  experiment page's ``TicketContextChip`` lights up with the
   *  back-to-ticket affordance + prev/next walker. Mirrors how
   *  ``groupId`` threads ``?group=<id>`` for set context. */
  ticketId?: number;
}) {
  const [activeFilter, setActiveFilter] = useState<QuickFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("-lastUpdated");
  const [offset, setOffset] = useState(0);
  const [dispOpen, setDispOpen] = useState(false);
  const [dispFilter, setDispFilter] = useState<DispositionFilterState>(
    DISPOSITION_FILTER_ANY,
  );
  const { mode } = useGemmaMode();
  const [pageSizeRaw, setPageSize] = useStickyState<number>(
    "experimentQueue.pageSize",
    PAGE_SIZE_DEFAULT,
  );
  // Clamp against THIS MODE's max. A curator who picked 200 in local
  // mode carries that value into remote mode, where Gemma refuses it
  // and the queue is a 400 with no rows — so the clamp reads the mode,
  // not just the option list. Read-time, so it self-heals without the
  // curator finding the picker.
  const pageSize = Math.min(
    pageSizeRaw,
    maxDatasetPageSize(mode),
  );

  // ``includeSummaries`` so the header progress bar can roll up
  // per-member audit_status without an extra round trip.
  const { data: group } = useGroup(groupId ?? null, {
    includeSummaries: true,
  });

  // 🛑 **An EMPTY scope is not an absent scope.** A ticket with no
  // targets passed `experimentIds: []`, which fell through to
  // `ids: undefined` and listed the ENTIRE corpus — Paul opened his
  // brand-new empty scratchpad (ticket 7, 0 targets) and found it full
  // of experiments. "No filter" and "a filter that matches nothing"
  // must never render the same way; the second has to show nothing.
  const scopedToNothing =
    Array.isArray(experimentIds) && experimentIds.length === 0 && !groupId;

  // Scope ids: ``experimentIds`` wins (ticket targets); otherwise
  // fall back to the group's member_ids when a groupId is set.
  const scopeIds = useMemo(() => {
    if (experimentIds && experimentIds.length > 0) {
      return experimentIds.map(String).join(",");
    }
    if (!groupId || !group) return undefined;
    return group.member_ids.join(",");
  }, [experimentIds, groupId, group]);

  const { data: page, isLoading, isFetching } = useDatasetsPaginated({
    query: search.trim() || undefined,
    sort,
    limit: pageSize,
    offset,
    ids: scopeIds,
    // Not merely filtered to nothing — not asked at all. A corpus-wide
    // page for a scope that matches nothing is wasted either way, and
    // fetching it is what made the bug above look like real data.
    enabled: !scopedToNothing,
  });

  const allRows = scopedToNothing ? [] : (page?.data ?? []);
  const total = scopedToNothing ? 0 : (page?.total_elements ?? 0);

  const { data: statusMap = {} } = usePipelineStatusBulk(allRows.map((r) => r.id));

  // Ticket-target-status lookup. In a ticket context, the ticket's
  // ``targets[i].status`` (NOT_DONE / UNDERWAY / DONE) is the truth
  // for what the CURATOR has done — independent of the dataset's
  // pipeline-step status (which counts Gemma's pre-imported Design /
  // Tags as already "ok"). Design review 2026-06-14 on tickets/45: header
  // says "0/200 done · 200 not started" but the filter was showing
  // Started (50) because every row's pipeline-step status carried
  // pre-existing ✓Design / ✓Tags from Gemma. The ticket target
  // status is the right signal here.
  //
  // ``useTicket(ticketId)`` shares the query cache with
  // ``TicketDetailPage``, so the queue's chip counts + row dots
  // stay in sync with the header's done/underway/not-started
  // counters whenever the detail page's polling layer refetches.
  // Earlier this used ``useMyTickets()`` which is a separate cache
  // entry; the agents side mutating targets behind the scenes refreshed the
  // detail-page header (when polling fired) but the queue's row
  // dots + chip counts stayed stale on a different timer. The reviewer
  // 2026-06-14 on ticket #52: row dots showed Started but the
  // chip filter read "Started (0)". */
  const { data: ticket } = useTicket(ticketId ?? null);
  const ticketTargetStatusById = useMemo(() => {
    const m = new Map<number, "not_started" | "started" | "finished">();
    if (ticketId == null || !ticket) return m;
    for (const tgt of ticket.targets) {
      if (tgt.target_type !== "EXPRESSION_EXPERIMENT") continue;
      const mapped =
        tgt.status === "DONE"
          ? "finished"
          : tgt.status === "UNDERWAY"
            ? "started"
            : "not_started";
      m.set(tgt.target_id, mapped);
    }
    return m;
  }, [ticket, ticketId]);

  // Curator-side "uncommitted local draft" signal — read once per
  // page from localStorage. Defined here (above ``stateFor``) so the
  // row-state computation can lift a "not_started" target to
  // "started" when the curator has touched it locally but the
  // server hasn't received the commit yet. Without this, the row
  // dot reads amber (uncommitted) while the chip count reads
  // "Started (0)" — Design review 2026-06-15.
  const dirtyDraftIds = useMemo(() => readDirtyExperimentIds(), [allRows]);

  // Per-row progress state. In a ticket context, prefer the ticket's
  // own target status (matches the header's done/not-started counts).
  // Outside a ticket context, fall back to the pipeline-step heuristic.
  // An uncommitted local draft overrides everything except ``finished``
  // — the amber StatusDisc on the row reads "uncommitted", so the
  // chip count and filter need a matching bucket.
  const stateFor = (datasetId: number): PipelineState => {
    const base: PipelineState =
      ticketTargetStatusById.size > 0
        ? ticketTargetStatusById.get(datasetId) ?? "not_started"
        : derivePipelineState(statusMap[String(datasetId)]);
    if (base !== "finished" && dirtyDraftIds.has(String(datasetId))) {
      return "uncommitted";
    }
    return base;
  };

  // Finding-disposition filter (ticket context only). The audit
  // fan-out is gated on the curator opening the filter row — one GET
  // per ticket target, riding the same cache keys as each row's
  // sidebar, so nothing is fetched twice. Targets span the WHOLE
  // ticket (not just the visible page) so chip counts follow the
  // same whole-ticket rule as the progress chips.
  const ticketExperimentIds = useMemo(
    () => [...ticketTargetStatusById.keys()],
    [ticketTargetStatusById],
  );
  const dispEngaged =
    ticketId != null &&
    dispOpen &&
    ticketExperimentIds.length > 0;
  // BOTH review kinds: a ticket's findings are ``kind='proposal'``
  // rows for review tickets and ``kind='audit'`` rows for audit
  // tickets, and the queue can't know which up front — reading one
  // kind returns confident zeros for the other (measured on ticket
  // 140: all 37 targets have zero audit-kind rows).
  const auditQueries = useAuditsForExperiments(ticketExperimentIds, {
    enabled: dispEngaged,
  });
  const proposalQueries = useProposalReviewsForExperiments(
    ticketExperimentIds,
    { enabled: dispEngaged },
  );
  const dispLoaded = dispEngaged
    ? auditQueries.filter(
        (q, i) => q.isSuccess && proposalQueries[i]?.isSuccess,
      ).length
    : 0;
  // Per-target triage rows, folded from each experiment's MOST RECENT
  // report of each kind (the same reports the row's sidebar shows).
  // Keyed on the queries' dataUpdatedAt fingerprint rather than the
  // array identity — useQueries returns a fresh array every render.
  const auditDataStamp = [...auditQueries, ...proposalQueries]
    .map((q) => q.dataUpdatedAt)
    .join(",");
  const triageByExperiment = useMemo(() => {
    const m = new Map<number, TriageRow[]>();
    if (!dispEngaged) return m;
    ticketExperimentIds.forEach((id, i) => {
      m.set(
        id,
        mergeTriageRows(
          triageRowsForReport(id, auditQueries[i]?.data?.items?.[0]),
          triageRowsForReport(id, proposalQueries[i]?.data?.items?.[0]),
        ),
      );
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispEngaged, auditDataStamp, ticketExperimentIds]);
  const allTriageRows = useMemo(
    () => [...triageByExperiment.values()].flat(),
    [triageByExperiment],
  );
  const dispActive = dispEngaged && isDispositionFilterActive(dispFilter);
  const matchingTriageCount = (datasetId: number): number =>
    (triageByExperiment.get(datasetId) ?? []).filter((r) =>
      triageRowMatches(r, dispFilter),
    ).length;

  // Apply the progress-state filter client-side on the rows the
  // server returned. The /datasets endpoint doesn't carry a step-
  // state aggregate query param, so this happens after the fetch.
  // Empty results are honest — the bottom-of-list "no experiments
  // match" caption fires when the filter clears the whole page.
  // The disposition filter stacks on top (AND): a row survives when
  // at least one of its findings matches every active axis.
  const rows = useMemo(() => {
    let r = allRows;
    if (activeFilter !== "all") {
      r = r.filter((d) => stateFor(d.id) === activeFilter);
    }
    if (dispActive) {
      r = r.filter((d) => matchingTriageCount(d.id) > 0);
    }
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeFilter,
    allRows,
    statusMap,
    ticketTargetStatusById,
    dispActive,
    dispFilter,
    triageByExperiment,
  ]);

  // Hand the displayed order to the experiment page's ticket walker.
  // The rows here are ordered by the SERVER (``sort``, default
  // ``-lastUpdated``) and narrowed by the curator's filters; the
  // ``‹ N/M ›`` chip on the experiment page has neither of those and
  // was walking the ticket's raw target order instead — on an
  // 18-member ticket, near-exactly the reverse of this list. Recording
  // what was shown is the only way the two can agree, since the chip
  // can't re-derive a server sort without re-fetching every member.
  useEffect(() => {
    if (ticketId == null || rows.length === 0) return;
    rememberTicketMemberOrder(
      ticketId,
      rows.map((d) => d.id),
    );
  }, [ticketId, rows]);

  // Per-filter counts for the chip labels. In a ticket context the
  // counts come from the ticket's target list (ALL targets, not just
  // the rows on the current page) so "Started (12)" actually means
  // "12 across the whole ticket", not "12 of the 50 visible." the reviewer
  // 2026-06-14: "this is showing the page view, not the total."
  // Outside ticket context (group / global queue), fall back to
  // counting over the visible page — the only signal available.
  const filterCounts = useMemo<Record<QuickFilter, number>>(() => {
    const counts: Record<QuickFilter, number> = {
      all: 0,
      started: 0,
      finished: 0,
      not_started: 0,
      uncommitted: 0,
    };
    if (ticketTargetStatusById.size > 0) {
      counts.all = ticketTargetStatusById.size;
      for (const [datasetId, base] of ticketTargetStatusById) {
        const lifted: PipelineState =
          base !== "finished" && dirtyDraftIds.has(String(datasetId))
            ? "uncommitted"
            : base;
        counts[lifted] += 1;
      }
    } else {
      counts.all = allRows.length;
      for (const d of allRows) counts[stateFor(d.id)] += 1;
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, statusMap, ticketTargetStatusById, dirtyDraftIds]);

  // For group-scoped views, the member_ids carry the prefix form
  // (`preboarding:1` vs bare `91188`). The /datasets rows ship the
  // numeric tail only. Build a numeric-id → original-member-id map
  // so PipelineStatusRow can navigate with the prefix preserved.
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
        counts={filterCounts}
        pageSize={pageSize}
        onPageSize={(n) => {
          setPageSize(n);
          setOffset(0);
        }}
        total={total}
        offset={offset}
        onPrev={() => setOffset((o) => Math.max(0, o - pageSize))}
        onNext={() => setOffset((o) => o + pageSize)}
      />

      {/* Finding-disposition filter — ticket context only: the axes
          are per-finding triage state, which only exists on audit
          reports, and the whole-ticket fan-out needs a bounded
          target list to be affordable. */}
      {ticketId != null && ticketExperimentIds.length > 0 ? (
        <DispositionFilterBar
          open={dispOpen}
          onToggle={() => {
            // Collapsing clears the filter — a hidden active filter
            // silently emptying the list is the bug.
            if (dispOpen) setDispFilter(DISPOSITION_FILTER_ANY);
            setDispOpen((v) => !v);
          }}
          filter={dispFilter}
          onFilter={(f) => {
            setDispFilter(f);
            setOffset(0);
          }}
          rows={allTriageRows}
          loaded={dispLoaded}
          total={ticketExperimentIds.length}
        />
      ) : null}

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
            ticketContext={ticketId != null ? String(ticketId) : undefined}
            // Lossless identifier from the group's member_ids when
            // available; falls back to the dataset's numeric id (the
            // non-group / global queue view).
            navId={memberIdByNumericId.get(d.id) ?? String(d.id)}
            hasLocalDraft={dirtyDraftIds.has(String(d.id))}
            tickets={ticket ? [ticket] : null}
            groupType={group?.type}
            groupTaskKind={group?.task_kind ?? null}
            leadingBadge={leadingBadge}
            findingsBadge={
              dispActive
                ? {
                    label: `${matchingTriageCount(d.id)} ${dispositionBadgeNoun(
                      dispFilter,
                    )}`,
                    title:
                      "findings on this experiment matching the disposition filter",
                  }
                : undefined
            }
          />
        ))}
      </div>

      {/* Pagination moved to the top per design review 2026-06-14 — see the
          inline cluster in FilterBar above. */}
    </div>
  );
}
