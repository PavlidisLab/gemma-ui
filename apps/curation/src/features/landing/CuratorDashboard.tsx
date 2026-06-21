/**
 * Curator dashboard — the curation app's landing surface.
 *
 * Sections (top → bottom):
 *  1. Tickets — ``useMyTickets()`` hits local-api ``/rest/v2/tickets``.
 *     Empty until the curator's queue has open / in-progress tickets.
 *  2. All data — link out to all-experiments table + cross-
 *     experiment inboxes.
 *
 * The "Import from Gemma" search bar was removed 2026-05-26 (Paul:
 * "too confusing to use the ui to pull data from remote to local").
 * Imports happen via the workflow / ticket pipeline now; the
 * ``useImportFromGemma`` hook is kept for the experiment-reset path
 * and the 404-fallback ImportPrompt, but no curator-facing UI calls
 * it directly any more.
 */
import { useEffect, useState } from "react";

import {
  useMyTickets,
  ticketTypeLabel,
  ticketPriorityRank,
  type Ticket,
  type TicketPriority,
  type TicketState,
  type TicketTarget,
} from "@/api/tickets";
import { navigate } from "@/routes";
import { cn } from "@/lib/cn";
import { AppHeader } from "@/components/ui/AppHeader";

/** Dashboard ticket-list filter. Maps to a (state, progress)
 *  predicate on each Ticket. ``all`` includes RESOLVED + CANCELLED;
 *  the other three filter within the open universe. */
type DashboardFilter = "all" | "not_started" | "started" | "completed";

const FILTER_OPTIONS: { id: DashboardFilter; label: string; title: string }[] = [
  { id: "all",         label: "All",         title: "Every ticket — open, in-progress, completed, cancelled." },
  { id: "not_started", label: "Not started", title: "Open tickets where no target has been touched yet." },
  { id: "started",     label: "Started",     title: "Open or in-progress tickets where some targets are done or underway." },
  { id: "completed",   label: "Completed",   title: "Resolved tickets, plus any open ticket whose targets are all done." },
];

const FILTER_STORAGE_KEY = "curator_dashboard.ticket_filter";

function isDashboardFilter(v: string | null): v is DashboardFilter {
  return v === "all" || v === "not_started" || v === "started" || v === "completed";
}

/** Read the persisted filter from URL ``?filter=`` (wins) or fallback
 *  to localStorage, then default ``all``. Dashboard is
 *  cross-experiment so a single key — no per-experiment scoping
 *  needed. */
function readInitialFilter(): DashboardFilter {
  if (typeof window === "undefined") return "all";
  try {
    const hash = window.location.hash;
    const q = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    const params = new URLSearchParams(q);
    const fromUrl = params.get("filter");
    if (isDashboardFilter(fromUrl)) return fromUrl;
    const fromStore = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (isDashboardFilter(fromStore)) return fromStore;
  } catch {
    // Fall through to default.
  }
  return "all";
}

/** Apply the (state, progress) predicate for a dashboard filter to
 *  a single ticket. Reads progress from target counts so a backend
 *  that doesn't flip state OPEN→IN_PROGRESS still groups correctly. */
function ticketMatchesFilter(ticket: Ticket, filter: DashboardFilter): boolean {
  const n = ticket.targets.length;
  const nDone = ticket.targets.filter((t) => t.status === "DONE").length;
  const nUnderway = ticket.targets.filter(
    (t) => t.status === "UNDERWAY",
  ).length;
  const isClosedState =
    ticket.state === "RESOLVED" || ticket.state === "CANCELLED";
  const allDone = n > 0 && nDone === n;
  switch (filter) {
    case "all":
      return true;
    case "not_started":
      return !isClosedState && nDone === 0 && nUnderway === 0;
    case "started":
      return !isClosedState && (nDone > 0 || nUnderway > 0) && !allDone;
    case "completed":
      return isClosedState || allDone;
  }
}

function formatFiledDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function CuratorDashboard({
  reviewer,
  onSelect,
}: {
  reviewer: string;
  /** ``ticketId`` is threaded when the experiment is opened from a
   *  ticket, so the experiment URL keeps ``?ticket=<id>`` and the
   *  banner can render the ticket breadcrumb / back-link. Omitted for
   *  non-ticket opens. */
  onSelect: (experimentId: number | string, ticketId?: number) => void;
}) {
  const [filter, setFilter] = useState<DashboardFilter>(() =>
    readInitialFilter(),
  );

  // Persist filter selection to URL + localStorage. URL wins on
  // bookmarks; localStorage is the soft default for a fresh tab.
  useEffect(() => {
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, filter);
      const hash = window.location.hash || "#/";
      const [path, queryStr] = hash.split("?");
      const params = new URLSearchParams(queryStr ?? "");
      if (filter === "all") params.delete("filter");
      else params.set("filter", filter);
      const next = params.toString();
      const newHash = next ? `${path}?${next}` : path;
      if (newHash !== hash) {
        window.history.replaceState(null, "", newHash);
      }
    } catch {
      // Best-effort — no fallback needed; the state's still live in
      // React.
    }
  }, [filter]);

  // Need RESOLVED/CANCELLED in the fetched list when the curator
  // wants to see them — otherwise the open-only filter on the hook
  // hides every completed ticket. Two states need closed tickets:
  // "all" and "completed".
  const includeClosed = filter === "all" || filter === "completed";
  const { data: tickets, isLoading: ticketsLoading } = useMyTickets({
    includeClosed,
  });

  // Apply the chip filter, then sort by priority + recency.
  const filteredTickets = (tickets ?? []).filter((t) =>
    ticketMatchesFilter(t, filter),
  );
  const sortedTickets = filteredTickets.slice().sort((a, b) => {
    const pa = ticketPriorityRank(a.priority);
    const pb = ticketPriorityRank(b.priority);
    if (pa !== pb) return pa - pb;
    return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
  });

  // Per-filter counts for the chip labels. Always computed over the
  // most-inclusive fetch we have on hand — when the curator's on a
  // filter that didn't fetch closed tickets, the "completed" count
  // chip still shows zero. That's an honest under-count rather than
  // a guess; flipping to "All" or "Completed" updates the chip
  // labels.
  const totalForLabel = tickets ?? [];
  const counts: Record<DashboardFilter, number> = {
    all: totalForLabel.length,
    not_started: totalForLabel.filter((t) => ticketMatchesFilter(t, "not_started")).length,
    started: totalForLabel.filter((t) => ticketMatchesFilter(t, "started")).length,
    completed: totalForLabel.filter((t) => ticketMatchesFilter(t, "completed")).length,
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 dark:text-slate-100">
      <AppHeader reviewer={reviewer} />

      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 flex-1 space-y-6">
        <header className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              Curator dashboard
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
              Your open tickets and entry points into the experiment
              queues, inboxes, and workflow surfaces.
            </p>
          </div>
          {/* All-data entry points — narrow inline cluster, lives at
              the top so it's reachable without scrolling past the
              ticket grid. Primary CTA (browse the curation catalog)
              reads as a link; the inbox/workflow secondaries trail
              behind in muted text. Per Paul 2026-05-27. */}
          <nav className="flex items-baseline gap-3 text-sm">
            <button
              type="button"
              className="text-blue-700 hover:underline font-medium"
              onClick={() => navigate("#/all-experiments")}
              title="Browse the full catalog of experiments in curation"
            >
              Browse all experiments in curation →
            </button>
            <span className="text-slate-300 dark:text-slate-700" aria-hidden>
              |
            </span>
            <button
              type="button"
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 underline-offset-2 hover:underline"
              onClick={() => navigate("#/inbox")}
              title="Cross-experiment proposal inbox"
            >
              Proposals inbox
            </button>
            <button
              type="button"
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 underline-offset-2 hover:underline"
              onClick={() => navigate("#/audits")}
              title="Cross-experiment audit inbox"
            >
              Audits inbox
            </button>
            {/* Workflow link retired from the dashboard 2026-05-27 —
                ticket-driven flow has superseded the typed-group
                navigator for most curator paths. The page is still
                reachable at #/workflow for the few set-walk cases. */}
          </nav>
        </header>

        {/* Tickets — live from local-api /rest/v2/tickets. */}
        <section>
          <header className="flex items-baseline gap-2 mb-2 flex-wrap">
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
              Tickets
            </h2>
            {/* Count chip sits next to the heading so the reader's
                eye finds it on the same gaze as the section title.
                Moved off the right per Paul 2026-05-27 — far-right
                badge was too small + too disconnected. */}
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {ticketsLoading
                ? "loading…"
                : sortedTickets.length === 0
                  ? "—"
                  : `(${sortedTickets.length})`}
            </span>
          </header>
          {/* Filter chips — completed / started / not started / all.
              Reuses the same chip palette as the workflow page's
              FilterBar (active = blue-600 fill, inactive = neutral
              slate) so curators read one visual idiom across
              ticket-list + experiment-list. Filter persists via
              ``?filter=`` on the dashboard URL + localStorage
              fallback. */}
          <div className="flex items-center gap-1 flex-wrap mb-3 text-xs">
            {FILTER_OPTIONS.map((opt) => {
              const active = filter === opt.id;
              const count = counts[opt.id];
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setFilter(opt.id)}
                  title={opt.title}
                  className={cn(
                    "px-2.5 py-1 rounded-full transition-colors",
                    active
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700",
                  )}
                >
                  {opt.label}
                  <span
                    className={cn(
                      "ml-1.5 tabular-nums",
                      active ? "text-blue-100" : "text-slate-400 dark:text-slate-500",
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          {ticketsLoading ? (
            <div className="card p-6 text-sm text-slate-500 italic">
              loading tickets…
            </div>
          ) : sortedTickets.length === 0 ? (
            <div className="card p-6 text-sm text-slate-500">
              {filter === "all"
                ? "No tickets."
                : filter === "completed"
                  ? "No completed tickets."
                  : filter === "started"
                    ? "No tickets in progress."
                    : "No open tickets waiting to start."}
            </div>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {sortedTickets.map((t) => (
                <li key={t.id} className="h-full">
                  <TicketCard ticket={t} onOpenTarget={onSelect} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}


function TicketCard({
  ticket,
  onOpenTarget,
}: {
  ticket: Ticket;
  onOpenTarget: (experimentId: number | string, ticketId?: number) => void;
}) {
  // Whole card opens the ticket detail page. The detail page lists
  // the targets; the curator clicks from there into individual EEs.
  // Single-target tickets skip straight to the EE (the only useful
  // landing for them) — but carry the ticket id so the experiment
  // keeps its ticket context (breadcrumb / back-link); without it the
  // curator lands on the EE with no way back to the ticket (Paul
  // 2026-06-21).
  const expTargets = ticket.targets.filter(
    (t) => t.target_type === "EXPRESSION_EXPERIMENT",
  );
  const primaryClick =
    expTargets.length === 1
      ? () => onOpenTarget(expTargets[0].target_id, ticket.id)
      : () => navigate(`#/tickets/${ticket.id}`);
  // Progress: same shape as Sets used. Per-target status drives it.
  const n = ticket.targets.length;
  const nDone = ticket.targets.filter((t) => t.status === "DONE").length;
  const nUnderway = ticket.targets.filter(
    (t) => t.status === "UNDERWAY",
  ).length;
  const pctDone = n === 0 ? 0 : Math.round((nDone / n) * 100);
  const pctUnderway = n === 0 ? 0 : Math.round((nUnderway / n) * 100);
  return (
    <div
      className={cn(
        "card p-3 transition-shadow",
        "cursor-pointer hover:shadow-md",
        "h-full flex flex-col gap-2 min-h-[220px]",
      )}
      onClick={primaryClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          primaryClick();
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="font-mono text-base font-semibold text-slate-800 dark:text-slate-100"
            title={`Ticket #${ticket.id}`}
          >
            #{ticket.id}
          </span>
          <PriorityPill priority={ticket.priority} />
          <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {ticketTypeLabel(ticket.type)}
          </span>
          <StatePill state={ticket.state} />
        </div>
        {ticket.due_date ? (
          <span
            className="text-[10px] text-slate-500 dark:text-slate-400"
            title={`due ${ticket.due_date}`}
          >
            due {ticket.due_date}
          </span>
        ) : null}
      </div>
      <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
        {ticket.title}
      </div>
      {ticket.body ? (
        <p
          className="text-xs text-slate-600 dark:text-slate-300 flex-1 whitespace-pre-line overflow-hidden"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 4,
            WebkitBoxOrient: "vertical",
          }}
          title={ticket.body}
        >
          {ticket.body}
        </p>
      ) : (
        <div className="flex-1" />
      )}
      <ProgressBar pctDone={pctDone} pctUnderway={pctUnderway} />
      <TargetList targets={ticket.targets} onOpenTarget={onOpenTarget} />
      <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-slate-400">
        <span>
          {ticket.assignee_name
            ? `assigned to ${ticket.assignee_name}`
            : "unassigned"}
          {ticket.reporter_name ? ` · filed by ${ticket.reporter_name}` : ""}
        </span>
        {ticket.created_at ? (
          <span title={`filed ${ticket.created_at}`}>
            {formatFiledDate(ticket.created_at)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function TargetList({
  targets,
}: {
  targets: TicketTarget[];
  onOpenTarget: (experimentId: number | string) => void;
}) {
  if (targets.length === 0) {
    return (
      <div className="text-[11px] italic text-slate-400">no targets</div>
    );
  }
  // Roll up by status. Per the 2026-05-26 chip-overflow fix: don't
  // render a chip per target — even at N=20 the card gets cluttered,
  // and at N=300 it explodes. Summary count + per-status pills make
  // the work-remaining visible in constant space.
  const n = targets.length;
  let nDone = 0, nUnderway = 0, nNotDone = 0;
  for (const t of targets) {
    switch (t.status) {
      case "DONE":     nDone++;     break;
      case "UNDERWAY": nUnderway++; break;
      default:         nNotDone++;  break; // NOT_DONE or undefined
    }
  }
  const noun = n === 1 ? "experiment" : "experiments";
  return (
    <div className="flex items-baseline gap-2 flex-wrap text-xs">
      <span className="font-medium text-slate-700 dark:text-slate-200">
        {n} {noun}
      </span>
      <span className="flex items-baseline gap-1.5 text-[11px]">
        <StatusPill tone="done"     count={nDone}     label="done" />
        <StatusPill tone="underway" count={nUnderway} label="underway" />
        <StatusPill tone="notdone"  count={nNotDone}  label="not started" />
      </span>
    </div>
  );
}

function ProgressBar({
  pctDone,
  pctUnderway,
}: {
  pctDone: number;
  pctUnderway: number;
}) {
  // Two-segment bar: emerald = done, amber = underway, slate-200
  // background = not started. Reads as a roll-up of the ticket's
  // target.status counts. Matches the visual the Sets cards used.
  return (
    <div
      className="h-1.5 w-full rounded bg-slate-200 dark:bg-slate-700 overflow-hidden flex"
      title={`${pctDone}% done · ${pctUnderway}% underway`}
    >
      <div
        className="bg-emerald-500 dark:bg-emerald-400 h-full"
        style={{ width: `${pctDone}%` }}
      />
      <div
        className="bg-amber-400 dark:bg-amber-300 h-full"
        style={{ width: `${pctUnderway}%` }}
      />
    </div>
  );
}

function StatusPill({
  tone,
  count,
  label,
}: {
  tone: "done" | "underway" | "notdone";
  count: number;
  label: string;
}) {
  if (count === 0) return null;
  const palette = {
    done:
      "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700",
    underway:
      "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700",
    notdone:
      "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600",
  }[tone];
  return (
    <span className={cn("px-1.5 py-0.5 rounded border tabular-nums", palette)}>
      {count} {label}
    </span>
  );
}

function PriorityPill({ priority }: { priority: TicketPriority }) {
  const palette: Record<TicketPriority, string> = {
    URGENT:
      "bg-rose-200 text-rose-900 border-rose-500 dark:bg-rose-900/60 dark:text-rose-100 dark:border-rose-500",
    HIGH:
      "bg-amber-100 text-amber-900 border-amber-400 dark:bg-amber-900/50 dark:text-amber-100 dark:border-amber-600",
    NORMAL:
      "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600",
    LOW: "bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-500 dark:border-slate-700",
  };
  return (
    <span
      className={cn(
        "inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border",
        palette[priority],
      )}
    >
      {priority.toLowerCase()}
    </span>
  );
}

function StatePill({ state }: { state: TicketState }) {
  // Resolved + cancelled tickets get a muted pill so the curator can
  // see at a glance which cards are closed when browsing the
  // Completed / All filters. Open + in-progress lean into emerald
  // / blue so the active work stands out.
  const palette: Record<TicketState, string> = {
    OPEN: "bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-600",
    IN_PROGRESS:
      "bg-blue-100 text-blue-900 border-blue-400 dark:bg-blue-900/40 dark:text-blue-100 dark:border-blue-600",
    RESOLVED:
      "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-600",
    CANCELLED:
      "bg-slate-100 text-slate-500 border-slate-300 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-600",
  };
  return (
    <span
      className={cn(
        "inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border",
        palette[state],
      )}
    >
      {state.toLowerCase().replace("_", " ")}
    </span>
  );
}

