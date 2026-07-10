import {
  useDatasets,
  datasetMatchesQuery,
  type DatasetSummary,
} from "@/api/datasets";
import { experimentRoute, navigate, type ExperimentTab } from "@/routes";
import { useMemo, useState } from "react";
import { useStickyState } from "@/lib/useStickyState";
import { AppHeader } from "@/components/ui/AppHeader";
import {
  useMyTickets,
  ticketTypeLabel,
  type Ticket,
} from "@/api/tickets";
import { cn } from "@/lib/cn";

/**
 * Landing page: lists every experiment in the curation store. Click
 * one to navigate to its curation surface.
 *
 * The pull-from-Gemma import bar that used to sit at the top of
 * this page was removed 2026-05-26 (Paul: "too confusing to use the
 * ui to pull data from remote to local"). Imports happen via the
 * workflow / ticket pipeline now.
 */
export function ExperimentList({
  onSelect,
  reviewer,
}: {
  onSelect: (experimentId: number | string) => void;
  reviewer: string;
}) {
  // Experiment → tickets index. Driven by ``useMyTickets`` (open +
  // in-progress only — resolved/cancelled don't get badges, they'd
  // just add visual noise to a table whose primary axis is "what
  // needs work"). Built once per fetch and consulted per-row.
  //
  // Polled every 5s while the page is mounted so the "anyUnderway"
  // signal below picks up status flips made by background runners
  // (e.g. PRELOAD). Cheap — tickets is a small payload.
  const { data: tickets } = useMyTickets({ refetchInterval: 5000 });
  const ticketsByExp = useMemo(
    () => buildTicketsByExperiment(tickets ?? []),
    [tickets],
  );
  // While any ticket has UNDERWAY targets, an async runner is
  // populating designs — poll the datasets list at 3s so newly-
  // loaded rows bubble to the top of an updated_at-sorted view.
  // Stops polling as soon as nothing is in flight (returns false).
  const anyUnderway = (tickets ?? []).some((t) =>
    t.targets.some((target) => target.status === "UNDERWAY"),
  );
  const { data, isLoading, error, refetch, isFetching } = useDatasets({
    refetchInterval: anyUnderway ? 3000 : false,
  });
  // Seed the free-text filter from the ``?q=`` param so the dashboard
  // quick-search can hand a multi-hit query off to this page with the
  // filter already applied.
  const [filter, setFilter] = useState(readInitialQuery);
  // Status pill filter: "all", "troubled", "needs_attention", "proposals", "notes".
  const [statusFilter, setStatusFilter] = useStickyState<StatusFilter>(
    "experiments.statusFilter",
    "all",
  );
  // Sort: keyed by column id, ascending or descending. Default is the
  // server's order (newest-first by updated_at).
  const [sort, setSort] = useStickyState<{ key: SortKey; dir: SortDir }>(
    "experiments.sort",
    { key: "updated_at", dir: "desc" },
  );

  const all = data ?? [];
  const counts = {
    all: all.length,
    troubled: all.filter((r) => r.troubled).length,
    needs_attention: all.filter((r) => r.needs_attention).length,
    proposals: all.filter((r) => (r.n_pending_proposals ?? 0) > 0).length,
    notes: all.filter((r) => r.has_curation_note).length,
    audit_issues: all.filter((r) => actionableAuditCount(r) > 0).length,
  };

  const rows = all
    .filter((r) => {
      if (statusFilter === "troubled" && !r.troubled) return false;
      if (statusFilter === "needs_attention" && !r.needs_attention) return false;
      if (statusFilter === "proposals" && (r.n_pending_proposals ?? 0) === 0)
        return false;
      if (statusFilter === "notes" && !r.has_curation_note) return false;
      if (statusFilter === "audit_issues" && actionableAuditCount(r) === 0)
        return false;
      return datasetMatchesQuery(r, filter);
    })
    .slice()
    .sort((a, b) => compareRows(a, b, sort.key) * (sort.dir === "asc" ? 1 : -1));

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: defaultDirFor(key) },
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <AppHeader reviewer={reviewer} />

      <main className="mx-auto w-full max-w-[1800px] px-4 py-6 flex-1">
        <div className="card">
          <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 flex-wrap">
            <h1 className="section-h">Experiments staged for curation</h1>
            <div className="flex items-center gap-2">
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="filter by accession, title, taxon…"
                className="text-xs border border-slate-300 rounded px-2 py-1 w-72"
              />
              <button
                type="button"
                className="btn ghost text-xs"
                onClick={() => refetch()}
                disabled={isFetching}
                title="refresh the list"
              >
                {isFetching ? "↻…" : "↻"}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-100 flex-wrap">
            <StatusPill
              active={statusFilter === "all"}
              onClick={() => setStatusFilter("all")}
              label="all"
              count={counts.all}
              tone="slate"
            />
            <StatusPill
              active={statusFilter === "needs_attention"}
              onClick={() => setStatusFilter("needs_attention")}
              label="needs attention"
              count={counts.needs_attention}
              tone="amber"
            />
            <StatusPill
              active={statusFilter === "troubled"}
              onClick={() => setStatusFilter("troubled")}
              label="troubled"
              count={counts.troubled}
              tone="rose"
            />
            <StatusPill
              active={statusFilter === "proposals"}
              onClick={() => setStatusFilter("proposals")}
              label="pending proposals"
              count={counts.proposals}
              tone="indigo"
            />
            <StatusPill
              active={statusFilter === "notes"}
              onClick={() => setStatusFilter("notes")}
              label="has note"
              count={counts.notes}
              tone="sky"
            />
            <StatusPill
              active={statusFilter === "audit_issues"}
              onClick={() => setStatusFilter("audit_issues")}
              label="audit issues"
              count={counts.audit_issues}
              tone="rose"
            />
          </div>

          {isLoading ? (
            <div className="px-3 py-6 text-sm text-slate-500">loading…</div>
          ) : error ? (
            <div className="px-3 py-6 text-sm text-rose-700">
              couldn't load: {(error as Error).message}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState filter={filter} statusFilter={statusFilter} />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600 uppercase tracking-wide">
                <tr>
                  <SortableTh sort={sort} sortKey="short_name" onToggle={toggleSort} className="w-32">
                    short name
                  </SortableTh>
                  <SortableTh sort={sort} sortKey="title" onToggle={toggleSort}>
                    title
                  </SortableTh>
                  <SortableTh sort={sort} sortKey="taxon" onToggle={toggleSort} className="w-32">
                    taxon
                  </SortableTh>
                  <SortableTh sort={sort} sortKey="n_biomaterials" onToggle={toggleSort} className="w-24">
                    samples
                  </SortableTh>
                  <SortableTh sort={sort} sortKey="n_factors" onToggle={toggleSort} className="w-24">
                    factors
                  </SortableTh>
                  <SortableTh sort={sort} sortKey="n_tags" onToggle={toggleSort} className="w-24">
                    tags
                  </SortableTh>
                  <SortableTh sort={sort} sortKey="status" onToggle={toggleSort} className="w-44">
                    status
                  </SortableTh>
                  <th className="text-left px-3 py-1.5 w-32">tickets</th>
                  <SortableTh sort={sort} sortKey="updated_at" onToggle={toggleSort} className="w-40">
                    last updated
                  </SortableTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <Row
                    key={r.experiment_id}
                    r={r}
                    onSelect={onSelect}
                    tickets={ticketsByExp.get(r.experiment_id) ?? []}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}

function Row({
  r,
  onSelect,
  tickets,
}: {
  r: DatasetSummary;
  onSelect: (experimentId: number | string) => void;
  /** Open/in-progress tickets that target this experiment. Empty
   *  array when none — column renders an em-dash placeholder. */
  tickets: Ticket[];
}) {
  const updated = formatTimestamp(r.updated_at);
  // "Thin" / preboarded — imported as a shell, design body has no
  // biomaterials, factors, or tags yet. Reuses the same amber chip
  // styling that PreboardingDetailPage uses on the per-row landing
  // page, so a curator scanning the table sees the same "preboarded"
  // mark they get on the detail surface. Also dims the numeric +
  // status cells so the all-zero row reads as "pending" rather than
  // "broken curation".
  const isThin = r.n_biomaterials === 0 && r.n_factors === 0 && r.n_tags === 0;
  return (
    <tr
      className={cn(
        "cursor-pointer hover:bg-slate-50",
        isThin && "text-slate-400 dark:text-slate-500",
      )}
      onClick={() => onSelect(r.experiment_id)}
    >
      <td className="px-3 py-2 font-mono">
        <div className="flex items-center gap-2">
          <span>{r.short_name}</span>
          {isThin ? (
            <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              preboarded
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-2 text-slate-700">
        <div>
          {r.title || (
            <span className="italic text-slate-400">(no title)</span>
          )}
        </div>
        {isThin && (r.assay || r.platform_short_name) ? (
          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
            {[r.assay, r.platform_short_name].filter(Boolean).join(" · ")}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-2 text-slate-700">
        {r.taxon || <span className="text-slate-300">—</span>}
      </td>
      <td className="px-3 py-2 text-slate-700 tabular-nums">
        {r.n_biomaterials}
      </td>
      <td className="px-3 py-2 text-slate-700 tabular-nums">
        {r.n_factors} ({r.n_fvs} FVs)
      </td>
      <td className="px-3 py-2 text-slate-700 tabular-nums">{r.n_tags}</td>
      <td className="px-3 py-2">
        <StatusChips r={r} />
      </td>
      <td className="px-3 py-2">
        <TicketBadges tickets={tickets} />
      </td>
      <td className="px-3 py-2 text-slate-500 text-xs">{updated}</td>
    </tr>
  );
}

/** Build a per-experiment ticket index from a flat ticket list.
 *  Walks each ticket's targets, filters to ``EXPRESSION_EXPERIMENT``,
 *  and appends the ticket under that target's id. Same ticket can
 *  appear under multiple experiments (multi-target ticket); same
 *  experiment can carry multiple tickets. */
function buildTicketsByExperiment(
  tickets: Ticket[],
): Map<number | string, Ticket[]> {
  const out = new Map<number | string, Ticket[]>();
  for (const t of tickets) {
    for (const target of t.targets) {
      if (target.target_type !== "EXPRESSION_EXPERIMENT") continue;
      const key: number | string = target.target_id;
      const list = out.get(key) ?? [];
      list.push(t);
      out.set(key, list);
    }
  }
  return out;
}

/** Stacked ticket-id badges, one per ticket on this experiment.
 *  Colour-coded by priority (matches the dashboard's PriorityPill
 *  palette so a curator scanning across surfaces sees the same
 *  visual). Click opens the ticket detail page; the row-level click
 *  handler that opens the experiment is suppressed via
 *  ``stopPropagation``. */
function TicketBadges({ tickets }: { tickets: Ticket[] }) {
  if (tickets.length === 0) {
    return <span className="text-slate-300">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {tickets.map((t) => (
        <TicketBadge key={t.id} ticket={t} />
      ))}
    </div>
  );
}

/** Compact #id badge in the same violet palette as
 *  ``TicketContextChip`` (ExperimentBanner.tsx) — the existing
 *  in-banner ticket chip on the experiment page. Matches that
 *  surface so a curator scanning the table recognises the same
 *  thing they see inside an experiment. Priority is in the tooltip
 *  rather than the colour: the violet conveys "this is a ticket",
 *  not "how urgent". */
function TicketBadge({ ticket }: { ticket: Ticket }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // Don't bubble up to the row-level handler (which would open
        // the experiment instead).
        e.stopPropagation();
        navigate(`#/tickets/${ticket.id}`);
      }}
      title={`${ticket.title} · ${ticketTypeLabel(ticket.type)} · ${ticket.priority.toLowerCase()} priority`}
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border tabular-nums hover:bg-violet-200",
        "border-violet-300 bg-violet-100 text-violet-800",
        "dark:border-violet-700 dark:bg-violet-900/40 dark:text-violet-200 dark:hover:bg-violet-900/60",
      )}
    >
      #{ticket.id}
    </button>
  );
}

type StatusFilter =
  | "all"
  | "troubled"
  | "needs_attention"
  | "proposals"
  | "notes"
  | "audit_issues";

type SortKey =
  | "short_name"
  | "title"
  | "taxon"
  | "n_biomaterials"
  | "n_factors"
  | "n_tags"
  | "status"
  | "updated_at";

type SortDir = "asc" | "desc";

function defaultDirFor(key: SortKey): SortDir {
  // Numeric / status / date columns default to descending — curators
  // care most about the largest counts and most recent activity.
  if (
    key === "n_biomaterials" ||
    key === "n_factors" ||
    key === "n_tags" ||
    key === "status" ||
    key === "updated_at"
  ) {
    return "desc";
  }
  return "asc";
}

function statusPriority(r: DatasetSummary): number {
  // Bigger = "more attention-worthy". Used by the status sort.
  // Audit blockers outrank everything else — a curated experiment
  // that the auditor flagged as broken is the highest-stakes
  // signal a curator can see on this page.
  let s = 0;
  if ((r.n_unactioned_blocker ?? 0) > 0) s += 5000;
  if (r.troubled) s += 1000;
  if (r.needs_attention) s += 500;
  s += (r.n_unactioned_major ?? 0) * 100;
  s += (r.n_pending_proposals ?? 0) * 10;
  s += (r.n_unactioned_minor ?? 0) * 5;
  if (r.has_curation_note) s += 1;
  return s;
}

/** Total unactioned major+blocker findings on the latest audit.
 *  Drives the "audit issues" filter pill and the audit chip's
 *  visibility — `clean` audits with no actionable findings still
 *  show a chip (positive confirmation), but the filter is for
 *  triage so it counts only actionable. */
function actionableAuditCount(r: DatasetSummary): number {
  return (r.n_unactioned_blocker ?? 0) + (r.n_unactioned_major ?? 0);
}

function compareRows(a: DatasetSummary, b: DatasetSummary, key: SortKey): number {
  switch (key) {
    case "short_name":
      return a.short_name.localeCompare(b.short_name);
    case "title":
      return (a.title || "").localeCompare(b.title || "");
    case "taxon":
      return (a.taxon || "").localeCompare(b.taxon || "");
    case "n_biomaterials":
      return a.n_biomaterials - b.n_biomaterials;
    case "n_factors":
      return a.n_factors - b.n_factors;
    case "n_tags":
      return a.n_tags - b.n_tags;
    case "status":
      return statusPriority(a) - statusPriority(b);
    case "updated_at":
      return (a.updated_at || "").localeCompare(b.updated_at || "");
  }
}

function SortableTh({
  children,
  sort,
  sortKey,
  onToggle,
  className = "",
}: {
  children: React.ReactNode;
  sort: { key: SortKey; dir: SortDir };
  sortKey: SortKey;
  onToggle: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const arrow = active ? (sort.dir === "asc" ? "↑" : "↓") : "";
  return (
    <th className={`text-left px-3 py-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-slate-900 ${active ? "text-slate-900" : ""}`}
      >
        <span>{children}</span>
        <span className="opacity-60 text-[10px] w-2 inline-block">{arrow}</span>
      </button>
    </th>
  );
}

function StatusPill({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone: "slate" | "amber" | "rose" | "indigo" | "sky";
}) {
  // Use static class strings (Tailwind purge needs them literal).
  const palette: Record<typeof tone, { active: string; idle: string }> = {
    slate: {
      active: "bg-slate-800 text-white border-slate-800",
      idle: "border-slate-200 text-slate-700 hover:bg-slate-50",
    },
    amber: {
      active: "bg-amber-600 text-white border-amber-600",
      idle: "border-amber-200 text-amber-800 hover:bg-amber-50",
    },
    rose: {
      active: "bg-rose-700 text-white border-rose-700",
      idle: "border-rose-200 text-rose-800 hover:bg-rose-50",
    },
    indigo: {
      active: "bg-indigo-700 text-white border-indigo-700",
      idle: "border-indigo-200 text-indigo-800 hover:bg-indigo-50",
    },
    sky: {
      active: "bg-sky-700 text-white border-sky-700",
      idle: "border-sky-200 text-sky-800 hover:bg-sky-50",
    },
  };
  const cls = active ? palette[tone].active : palette[tone].idle;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-2 py-0.5 border rounded-full inline-flex items-center gap-1 ${cls}`}
    >
      <span>{label}</span>
      <span className="tabular-nums opacity-80">{count}</span>
    </button>
  );
}

function StatusChips({ r }: { r: DatasetSummary }) {
  const chips: {
    label: string;
    cls: string;
    title?: string;
    tab: ExperimentTab;
  }[] = [];
  if (r.troubled) {
    chips.push({
      label: "troubled",
      cls: "bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100",
      title: "Marked troubled in CurationDetails — click to open notes",
      tab: "notes",
    });
  }
  if (r.needs_attention) {
    chips.push({
      label: "needs attention",
      cls: "bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100",
      title: "Marked needs-attention in CurationDetails — click to open notes",
      tab: "notes",
    });
  }
  const pending = r.n_pending_proposals ?? 0;
  if (pending > 0) {
    chips.push({
      label: `${pending} proposal${pending === 1 ? "" : "s"}`,
      cls: "bg-indigo-50 border-indigo-200 text-indigo-800 hover:bg-indigo-100",
      title: "Open agent proposals — click to review",
      tab: "proposals",
    });
  }
  if (r.has_curation_note) {
    chips.push({
      label: "note",
      cls: "bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100",
      title: "Curation note set — click to open",
      tab: "notes",
    });
  }
  if (chips.length === 0 && r.latest_audit_verdict == null) {
    return <span className="text-slate-300 text-xs">—</span>;
  }
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {chips.map((c) => (
        <button
          key={c.label}
          type="button"
          title={c.title}
          onClick={(e) => {
            e.stopPropagation();
            navigate(experimentRoute(r.experiment_id, c.tab));
          }}
          className={`text-[11px] px-1.5 py-0.5 border rounded ${c.cls}`}
        >
          {c.label}
        </button>
      ))}
      <AuditChip r={r} />
    </div>
  );
}

/** Audit summary chip — verdict + unactioned-finding count.
 *  Renders only when the server has populated `latest_audit_verdict`
 *  (older mocks that don't track audit state hide the chip
 *  entirely). Click prefers the audit detail page when a
 *  `latest_audit_id` is available; falls back to opening the
 *  experiment's audit sidebar otherwise. */
function AuditChip({ r }: { r: DatasetSummary }) {
  const verdict = r.latest_audit_verdict;
  if (verdict == null) return null;
  const blocker = r.n_unactioned_blocker ?? 0;
  const major = r.n_unactioned_major ?? 0;
  const minor = r.n_unactioned_minor ?? 0;
  // Color picks the highest *unactioned* severity, not the
  // verdict — a "blockers" verdict that's been fully dispositioned
  // shouldn't keep painting the chip rose forever.
  const cls =
    blocker > 0
      ? "bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100"
      : major > 0
        ? "bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100"
        : minor > 0
          ? "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
          : verdict === "clean"
            ? "bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100"
            : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100";
  // Label leads with the actionable cue when there's something to
  // do; otherwise falls back to the verdict so a clean audit still
  // surfaces as positive confirmation.
  const label =
    blocker > 0
      ? `${blocker} blocker${blocker === 1 ? "" : "s"}`
      : major > 0
        ? `${major} major`
        : minor > 0
          ? `${minor} minor`
          : verdict === "clean"
            ? "✓ audit clean"
            : verdict.replace("_", " ");
  const title = `Latest audit: ${verdict.replace("_", " ")}${
    blocker || major || minor
      ? ` · unactioned: ${blocker} blocker${blocker === 1 ? "" : "s"}, ${major} major, ${minor} minor`
      : " · all findings actioned"
  }${r.latest_audited_at ? `\nAudited ${formatTimestamp(r.latest_audited_at)}` : ""}\nClick to open the audit.`;
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        if (r.latest_audit_id) {
          navigate(`#/audits/${encodeURIComponent(r.latest_audit_id)}`);
        } else {
          navigate(experimentRoute(r.experiment_id));
        }
      }}
      className={`text-[11px] px-1.5 py-0.5 border rounded inline-flex items-center gap-1 ${cls}`}
    >
      <span aria-hidden>◆</span>
      <span>{label}</span>
    </button>
  );
}

function EmptyState({
  filter,
  statusFilter,
}: {
  filter: string;
  statusFilter: StatusFilter;
}) {
  if (statusFilter !== "all") {
    const label = {
      troubled: "troubled",
      needs_attention: "needs-attention",
      proposals: "with pending proposals",
      notes: "with curation notes",
      audit_issues: "with unactioned audit issues",
      all: "",
    }[statusFilter];
    return (
      <div className="px-3 py-6 text-sm text-slate-500">
        No experiments {label}
        {filter ? ` match "${filter}"` : ""}.
      </div>
    );
  }
  if (filter) {
    return (
      <div className="px-3 py-6 text-sm text-slate-500">
        No experiments match "{filter}".
      </div>
    );
  }
  return (
    <div className="px-3 py-6 text-sm text-slate-500">
      No experiments staged yet. Imports land via the workflow /
      ticket pipeline.
    </div>
  );
}

/** Read the initial free-text filter from the hash query string
 *  (``#/all-experiments?q=<query>``). Empty when absent. */
function readInitialQuery(): string {
  if (typeof window === "undefined") return "";
  try {
    const hash = window.location.hash;
    const qs = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    return new URLSearchParams(qs).get("q") ?? "";
  } catch {
    return "";
  }
}

function formatTimestamp(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
