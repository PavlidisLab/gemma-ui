/**
 * Curator dashboard — the curation app's landing surface.
 *
 * Replaces the legacy nav strip ``proposals · audits · workflow`` +
 * raw experiment table. Surfaces **tickets** (Gemma 2.0's curator
 * work-item concept; see ``ubic.gemma.model.common.auditAndSecurity.
 * curation.Ticket``) as the primary content — each ticket is a
 * scoped piece of work the curator can pick up (a calibration batch,
 * a GEO scrape batch, a batch-info-needed flag, …).
 *
 * Sections (top → bottom):
 *  1. Your active tickets — ``useMyTickets()``; cards click through
 *     to the targeted experiment(s).
 *  2. Find / import — the existing "Import from Gemma" search.
 *  3. All experiments — a link out to ``#/all-experiments`` (the
 *     legacy table is still accessible there for the
 *     browse-everything case).
 *
 * Ticket backend is mocked (see ``api/tickets.ts``). When local-api
 * exposes /rest/v2/tickets, swap the hook implementation and this
 * surface keeps working unchanged.
 */
import { useState } from "react";
import { useImportFromGemma, useGemmaSearch, type GemmaDatasetHit } from "@/api/datasets";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useLogout } from "@/api/session";
import {
  useMyTickets,
  ticketTypeLabel,
  ticketPriorityRank,
  type Ticket,
  type TicketPriority,
  type TicketState,
  type TicketTarget,
} from "@/api/tickets";
import { useGroups } from "@/api/workflow";
import type { Group, GroupType } from "@/api/workflowTypes";
import { navigate, workflowRoute } from "@/routes";
import { ModeChip } from "@/components/ui/ModeChip";
import { HealthChip } from "@/components/ui/HealthChip";
import { cn } from "@/lib/cn";

export function CuratorDashboard({
  reviewer,
  onSelect,
}: {
  reviewer: string;
  onSelect: (experimentId: number | string) => void;
}) {
  const logout = useLogout();
  const { data: tickets, isLoading: ticketsLoading } = useMyTickets();
  const sortedTickets = (tickets ?? []).slice().sort((a, b) => {
    const pa = ticketPriorityRank(a.priority);
    const pb = ticketPriorityRank(b.priority);
    if (pa !== pb) return pa - pb;
    return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
  });

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto w-full max-w-[1800px] px-4 py-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="font-semibold">Gemma</span>
            <span className="text-xs text-slate-400">/</span>
            <span className="text-sm text-slate-600 dark:text-slate-300">
              Curation
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
            <span>
              signed in as <span className="font-medium">{reviewer}</span>
            </span>
            <ModeChip />
            <HealthChip />
            <button
              type="button"
              className="text-slate-500 hover:text-slate-900 underline dark:text-slate-400 dark:hover:text-slate-100"
              onClick={() => logout.mutate()}
            >
              sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 flex-1 space-y-6">
        <section>
          <header className="flex items-baseline justify-between gap-2 mb-2">
            <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100">
              Your active tickets
            </h1>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {ticketsLoading
                ? "loading…"
                : sortedTickets.length === 0
                  ? "no open work assigned"
                  : `${sortedTickets.length} open`}
            </span>
          </header>
          {ticketsLoading ? (
            <div className="card p-6 text-sm text-slate-500 italic">
              loading tickets…
            </div>
          ) : sortedTickets.length === 0 ? (
            <div className="card p-6 text-sm text-slate-500">
              No active tickets. Import an experiment below to begin, or
              browse the full catalog in{" "}
              <button
                type="button"
                className="text-blue-700 hover:underline"
                onClick={() => navigate("#/all-experiments")}
              >
                all experiments
              </button>
              .
            </div>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {sortedTickets.map((t) => (
                <li key={t.id}>
                  <TicketCard ticket={t} onOpenTarget={onSelect} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <SetsSection onOpenWorkflow={() => navigate(workflowRoute())} />

        <ImportFromGemmaBar onImported={onSelect} />

        <section>
          <header className="flex items-baseline justify-between gap-2 mb-2">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              All data
            </h2>
          </header>
          <div className="card p-4 text-sm text-slate-600 dark:text-slate-300 flex items-center justify-between gap-3 flex-wrap">
            <button
              type="button"
              className="text-blue-700 hover:underline font-medium"
              onClick={() => navigate("#/all-experiments")}
              title="Browse the full catalog of experiments in the local DB"
            >
              Browse all experiments →
            </button>
            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              <button
                type="button"
                className="hover:text-slate-900 underline-offset-2 hover:underline"
                onClick={() => navigate("#/inbox")}
                title="Cross-experiment proposal inbox"
              >
                Proposals inbox
              </button>
              <button
                type="button"
                className="hover:text-slate-900 underline-offset-2 hover:underline"
                onClick={() => navigate("#/audits")}
                title="Cross-experiment audit inbox"
              >
                Audits inbox
              </button>
              <button
                type="button"
                className="hover:text-slate-900 underline-offset-2 hover:underline"
                onClick={() => navigate("#/workflow")}
                title="Workflow manager"
              >
                Workflow
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

/** Workflow-group "sets" the curator can work through. Each set
 *  groups experiments by some shared concern — screening batch, a
 *  pipeline stage, a review queue. Reads ``useGroups()`` (Gemma
 *  2.0's groups REST) and surfaces them as click-through cards.
 *
 *  ``screening`` / ``pipeline`` / ``review`` group types live
 *  side by side; the curator picks. Empty state links straight
 *  to the workflow manager so a new set can be created. */
function SetsSection({
  onOpenWorkflow,
}: {
  onOpenWorkflow: () => void;
}) {
  // ``useGroups`` falls back gracefully when the backend doesn't
  // expose ``/rest/v2/groups`` (older agents) — the hook returns
  // undefined data + an error, which we surface as a "not
  // available" hint rather than a broken section.
  const { data: groups, isLoading, error } = useGroups();
  return (
    <section>
      <header className="flex items-baseline justify-between gap-2 mb-2">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
          Sets
        </h2>
        <button
          type="button"
          className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 underline-offset-2 hover:underline"
          onClick={onOpenWorkflow}
          title="Open the workflow manager"
        >
          manage →
        </button>
      </header>
      {isLoading ? (
        <div className="card p-4 text-sm text-slate-500 italic">
          loading sets…
        </div>
      ) : error ? (
        <div className="card p-4 text-xs text-slate-500 dark:text-slate-400">
          Sets not available — the backend doesn't expose
          ``/rest/v2/groups`` here.
        </div>
      ) : !groups || groups.length === 0 ? (
        <div className="card p-4 text-sm text-slate-500">
          No sets yet.{" "}
          <button
            type="button"
            className="text-blue-700 hover:underline"
            onClick={onOpenWorkflow}
          >
            Create one in the workflow manager →
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {groups.map((g) => (
            <li key={g.id}>
              <SetCard group={g} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SetCard({ group }: { group: Group }) {
  return (
    <button
      type="button"
      onClick={() => navigate(workflowRoute(group.id))}
      className="card text-left w-full p-3 space-y-1.5 hover:shadow-md transition-shadow"
      title={group.description || `Open set "${group.name}"`}
    >
      <div className="flex items-center gap-2">
        <SetTypePill type={group.type} />
        <span className="text-[10px] text-slate-400 dark:text-slate-500">
          {group.member_count} member{group.member_count === 1 ? "" : "s"}
        </span>
      </div>
      <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
        {group.name}
      </div>
      {group.description ? (
        <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
          {group.description}
        </div>
      ) : null}
      <div className="text-[10px] text-slate-400 dark:text-slate-500">
        by {group.created_by || "—"}
      </div>
    </button>
  );
}

function SetTypePill({ type }: { type: GroupType }) {
  const palette: Record<GroupType, string> = {
    screening:
      "bg-violet-100 text-violet-900 border-violet-300 dark:bg-violet-900/50 dark:text-violet-100 dark:border-violet-700",
    pipeline:
      "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-900/50 dark:text-sky-100 dark:border-sky-700",
    review:
      "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/50 dark:text-emerald-100 dark:border-emerald-700",
  };
  return (
    <span
      className={cn(
        "inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border",
        palette[type],
      )}
    >
      {type}
    </span>
  );
}

function TicketCard({
  ticket,
  onOpenTarget,
}: {
  ticket: Ticket;
  onOpenTarget: (experimentId: number | string) => void;
}) {
  const expTargets = ticket.targets.filter(
    (t) => t.target_type === "EXPRESSION_EXPERIMENT",
  );
  const primaryClick =
    expTargets.length === 1
      ? () => onOpenTarget(expTargets[0].target_id)
      : undefined;
  return (
    <div
      className={cn(
        "card p-3 space-y-2 transition-shadow",
        primaryClick ? "cursor-pointer hover:shadow-md" : null,
      )}
      onClick={primaryClick}
      role={primaryClick ? "button" : undefined}
      tabIndex={primaryClick ? 0 : undefined}
      onKeyDown={
        primaryClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                primaryClick();
              }
            }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
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
      <TargetList targets={ticket.targets} onOpenTarget={onOpenTarget} />
      <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-slate-400">
        <span>
          {ticket.assignee_name
            ? `assigned to ${ticket.assignee_name}`
            : "unassigned"}
        </span>
        {ticket.reporter_name ? (
          <span>filed by {ticket.reporter_name}</span>
        ) : null}
      </div>
    </div>
  );
}

function TargetList({
  targets,
  onOpenTarget,
}: {
  targets: TicketTarget[];
  onOpenTarget: (experimentId: number | string) => void;
}) {
  if (targets.length === 0) {
    return (
      <div className="text-[11px] italic text-slate-400">no targets</div>
    );
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {targets.map((t, i) => {
        const isExperiment = t.target_type === "EXPRESSION_EXPERIMENT";
        const label =
          t.display_label ||
          `${t.target_type.toLowerCase().replace(/_/g, " ")}:${t.target_id}`;
        return (
          <li key={`${t.target_type}-${t.target_id}-${i}`}>
            <button
              type="button"
              disabled={!isExperiment}
              onClick={(e) => {
                e.stopPropagation();
                if (isExperiment) onOpenTarget(t.target_id);
              }}
              className={cn(
                "text-[11px] font-mono px-1.5 py-0.5 rounded border",
                isExperiment
                  ? "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/40 dark:text-blue-200 dark:hover:bg-blue-900/60"
                  : "border-slate-200 bg-slate-50 text-slate-500 cursor-not-allowed dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400",
              )}
              title={
                isExperiment
                  ? `open ${label} in curation`
                  : `target type ${t.target_type} — no UI route yet`
              }
            >
              {label}
            </button>
          </li>
        );
      })}
    </ul>
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
  if (state === "RESOLVED" || state === "CANCELLED") return null;
  const palette: Record<TicketState, string> = {
    OPEN: "bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-600",
    IN_PROGRESS:
      "bg-blue-100 text-blue-900 border-blue-400 dark:bg-blue-900/40 dark:text-blue-100 dark:border-blue-600",
    RESOLVED: "",
    CANCELLED: "",
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

/** Inline import bar — same logic as ExperimentList's import form,
 *  just lifted into a self-contained component so the dashboard
 *  can render it without all the experiment-list machinery. */
function ImportFromGemmaBar({
  onImported,
}: {
  onImported: (experimentId: number | string) => void;
}) {
  const importer = useImportFromGemma();
  const [ref, setRef] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const debounced = useDebouncedValue(ref, 250);
  const looksLikeAccession = /^(GSE|GDS|GPL|GSM|E-[A-Z]+-)\d/i.test(
    debounced.trim(),
  );
  const search = useGemmaSearch(debounced, { enabled: !looksLikeAccession });
  const hits = search.data ?? [];
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = ref.trim();
    if (!r) return;
    importer.mutate(r, {
      onSuccess: (design) => {
        setRef("");
        setSearchOpen(false);
        onImported(design.experiment_id);
      },
    });
  }
  function pickHit(hit: GemmaDatasetHit) {
    const r = hit.accession || hit.short_name || String(hit.experiment_id);
    importer.mutate(r, {
      onSuccess: (design) => {
        setRef("");
        setSearchOpen(false);
        onImported(design.experiment_id);
      },
    });
  }
  return (
    <section>
      <header className="flex items-baseline justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Find / import
        </h2>
      </header>
      <div className="card px-3 py-2 relative">
        <form onSubmit={submit} className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Import from Gemma:
          </span>
          <input
            type="text"
            value={ref}
            onChange={(e) => {
              setRef(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
            placeholder="GSE accession, shortName, numeric id, or free-text search…"
            className="text-sm border border-slate-300 dark:border-slate-600 dark:bg-slate-900 rounded px-2 py-1 flex-1 min-w-[20ch]"
          />
          <button
            type="submit"
            className="btn primary text-xs"
            disabled={!ref.trim() || importer.isPending}
          >
            {importer.isPending ? "importing…" : "import"}
          </button>
          {importer.isError ? (
            <span
              className="text-xs text-rose-700"
              title={(importer.error as Error).message}
            >
              import failed: {(importer.error as Error).message}
            </span>
          ) : null}
        </form>
        {searchOpen && !looksLikeAccession && debounced.trim().length >= 2 ? (
          <div className="absolute left-3 right-3 top-full mt-1 z-30 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded shadow-md max-h-96 overflow-auto text-xs">
            {search.isFetching && hits.length === 0 ? (
              <div className="px-3 py-2 text-slate-500">searching…</div>
            ) : hits.length === 0 ? (
              <div className="px-3 py-2 text-slate-500">
                no Gemma hits for "{debounced}"
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {hits.map((h) => (
                  <li
                    key={h.experiment_id}
                    onMouseDown={() => pickHit(h)}
                    className="px-3 py-1.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono shrink-0">
                        {h.short_name || h.accession}
                      </span>
                      <span className="text-slate-700 dark:text-slate-200 truncate">
                        {h.title || (
                          <span className="italic text-slate-400">
                            (no title)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-3 flex-wrap">
                      {h.taxon ? <span>{h.taxon}</span> : null}
                      {h.n_samples ? <span>{h.n_samples} samples</span> : null}
                      {h.external_database ? (
                        <span>source: {h.external_database}</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
