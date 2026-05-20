import { useMemo } from "react";
import { useAuditsInbox } from "@/api/audits";
import { useLogout } from "@/api/session";
import { experimentRoute, navigate } from "@/routes";
import { useStickyState } from "@/lib/useStickyState";
import { cn } from "@/lib/cn";
import type { AuditReport, OverallVerdict, Severity } from "@/api/auditTypes";
import { ModeChip } from "@/components/ui/ModeChip";

/**
 * Cross-experiment inbox of audit reports.
 *
 * Mirrors `ProposalsInbox` in shape — header / filter strip / grouped
 * list — but the lifecycle model is different: audits don't sit in
 * "pending → accepted/rejected" buckets like proposals do. Each
 * audit carries a roll-up `summary.overall_verdict` instead, and the
 * useful triage axis is "what needs attention right now":
 *
 *   - **blockers** / **major issues** — the curator's queue
 *   - **minor issues** — known small drift, batchable
 *   - **clean** — confirmation runs, mostly skim
 *   - **all** — debug / search
 *
 * Filter default lands on "blockers + major" because that's the
 * actionable set; the curator opts in to the quieter buckets.
 *
 * Click a row → navigate to the experiment with the sidebar
 * pre-set to "audit" view. Deep-linking to a *specific* audit
 * (``?audit_id=…``) is deferred — the per-experiment sidebar
 * always loads the most recent, which is what curators want when
 * landing from a fresh-from-overnight inbox.
 */
type VerdictFilter = OverallVerdict | "all" | "actionable";

export function AuditsInbox({ reviewer }: { reviewer: string }) {
  const [filter, setFilter] = useStickyState<VerdictFilter>(
    "audits.inbox.verdictFilter",
    "actionable",
  );
  const { data, isLoading, error, refetch, isFetching } = useAuditsInbox();
  const logout = useLogout();
  const items = data?.items ?? [];

  // Server returns the full set; filter client-side. The mock's audit
  // table is small enough that pagination isn't on the path; if that
  // changes we add a query param + push the filter down to the GET.
  const filtered = useMemo(() => filterByVerdict(items, filter), [items, filter]);
  const grouped = useMemo(() => groupByExperiment(filtered), [filtered]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-[1800px] px-4 py-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate("#/")}
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              ← experiments
            </button>
            <span className="text-xs text-slate-400">/</span>
            <span className="font-semibold">Audits</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <a
              href="#/inbox"
              className="text-slate-500 hover:text-slate-900 hover:underline"
              title="proposals inbox"
            >
              proposals
            </a>
            <span>
              signed in as <span className="font-medium">{reviewer}</span>
            </span>
            <ModeChip />
            <button
              type="button"
              className="text-slate-500 hover:text-slate-900 underline"
              onClick={() => logout.mutate()}
            >
              sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1800px] px-4 py-6 flex-1 space-y-4">
        <div className="card">
          <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 flex-wrap">
            <h1 className="section-h">
              Curation audits
              <span className="ml-2 text-xs text-slate-500 font-normal">
                {filtered.length} of {items.length}
              </span>
            </h1>
            <div className="flex items-center gap-1 flex-wrap">
              <VerdictTab value="actionable" current={filter} onChange={setFilter}>
                actionable
              </VerdictTab>
              <VerdictTab value="blockers" current={filter} onChange={setFilter}>
                blockers
              </VerdictTab>
              <VerdictTab value="major_issues" current={filter} onChange={setFilter}>
                major
              </VerdictTab>
              <VerdictTab value="minor_issues" current={filter} onChange={setFilter}>
                minor
              </VerdictTab>
              <VerdictTab value="clean" current={filter} onChange={setFilter}>
                clean
              </VerdictTab>
              <VerdictTab value="all" current={filter} onChange={setFilter}>
                all
              </VerdictTab>
              <button
                type="button"
                className="btn ghost text-xs ml-1"
                onClick={() => refetch()}
                disabled={isFetching}
                title="refresh"
              >
                {isFetching ? "↻…" : "↻"}
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="px-3 py-6 text-sm text-slate-500">loading…</div>
          ) : error ? (
            <div className="px-3 py-6 text-sm text-rose-700">
              couldn't load: {(error as Error).message}
            </div>
          ) : grouped.length === 0 ? (
            <div className="px-3 py-6 text-sm text-slate-500">
              {items.length === 0
                ? "No audits on the local server yet. Submit one with `gca audit-curation … --submit` from the agents repo."
                : `No audits matching "${filter}".`}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {grouped.map((g) => (
                <ExperimentGroup key={g.experimentId} group={g} />
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}

function VerdictTab({
  value,
  current,
  onChange,
  children,
}: {
  value: VerdictFilter;
  current: VerdictFilter;
  onChange: (v: VerdictFilter) => void;
  children: React.ReactNode;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={cn(
        "text-xs px-2 py-1 border rounded",
        active
          ? "bg-slate-800 text-white border-slate-800"
          : "border-slate-200 text-slate-700 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

interface Group {
  experimentId: number;
  experimentShortName: string;
  items: AuditReport[];
}

function groupByExperiment(items: AuditReport[]): Group[] {
  const m = new Map<number, Group>();
  for (const a of items) {
    const g = m.get(a.experiment_id) ?? {
      experimentId: a.experiment_id,
      experimentShortName: a.experiment_short_name,
      items: [],
    };
    g.items.push(a);
    m.set(a.experiment_id, g);
  }
  // Items inside each group: most-recent first.
  for (const g of m.values()) {
    g.items.sort((a, b) => (b.audited_at || "").localeCompare(a.audited_at || ""));
  }
  // Groups: by recency of newest audit, descending.
  return Array.from(m.values()).sort((a, b) => {
    const aMax = a.items[0]?.audited_at ?? "";
    const bMax = b.items[0]?.audited_at ?? "";
    return bMax.localeCompare(aMax);
  });
}

function filterByVerdict(
  items: AuditReport[],
  filter: VerdictFilter,
): AuditReport[] {
  if (filter === "all") return items;
  if (filter === "actionable") {
    return items.filter(
      (a) =>
        a.summary.overall_verdict === "blockers" ||
        a.summary.overall_verdict === "major_issues",
    );
  }
  return items.filter((a) => a.summary.overall_verdict === filter);
}

function ExperimentGroup({ group }: { group: Group }) {
  return (
    <li>
      {/* Group header — click opens the experiment shell so the
          curator can act on findings in-context (inline severity
          dots, design editor, sample table). The per-row click
          below lands on the standalone audit detail page instead. */}
      <button
        type="button"
        onClick={() => navigate(experimentRoute(group.experimentId))}
        className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-baseline gap-3"
        title="open the experiment shell with the audit sidebar"
      >
        <span className="font-mono text-sm shrink-0">
          {group.experimentShortName}
        </span>
        <span className="text-xs text-slate-500 shrink-0">
          {group.items.length} audit{group.items.length === 1 ? "" : "s"}
        </span>
        <span className="text-xs text-slate-400">
          newest {formatTimestamp(group.items[0]?.audited_at ?? "")}
        </span>
        <span className="ml-auto text-[11px] text-blue-700 hover:underline">
          experiment →
        </span>
      </button>
      <ul className="border-t border-slate-100 bg-slate-50/40">
        {group.items.map((a, i) => {
          const linkable = !!a.audit_id;
          const onClick = linkable
            ? () => navigate(`#/audits/${encodeURIComponent(a.audit_id!)}`)
            : undefined;
          return (
            <li
              key={a.audit_id ?? `${a.experiment_id}|${a.audited_at}|${i}`}
            >
              <button
                type="button"
                onClick={onClick}
                disabled={!linkable}
                className={cn(
                  "w-full text-left px-6 py-1.5 text-xs flex items-baseline gap-3",
                  linkable
                    ? "hover:bg-slate-100 cursor-pointer"
                    : "cursor-default",
                )}
                title={
                  linkable
                    ? "open this audit's detail page"
                    : "no audit_id — can't deep-link"
                }
              >
                <VerdictPill verdict={a.summary.overall_verdict} />
                <span className="text-slate-700 flex-1 inline-flex items-baseline gap-2 flex-wrap">
                  <SeverityCount label="blocker" count={a.summary.n_blocker} severity="blocker" />
                  <SeverityCount label="major" count={a.summary.n_major} severity="major" />
                  <SeverityCount label="minor" count={a.summary.n_minor} severity="minor" />
                  <SeverityCount label="ok" count={a.summary.n_ok} severity="ok" />
                  {a.model ? (
                    <span className="text-slate-400">· {a.model}</span>
                  ) : null}
                </span>
                <span className="text-slate-400 shrink-0">
                  {formatTimestamp(a.audited_at)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

function VerdictPill({ verdict }: { verdict: OverallVerdict }) {
  const cls = {
    clean: "bg-emerald-100 text-emerald-900 border-emerald-300",
    minor_issues: "bg-slate-100 text-slate-700 border-slate-300",
    major_issues: "bg-amber-100 text-amber-900 border-amber-300",
    blockers: "bg-rose-100 text-rose-900 border-rose-300",
  }[verdict];
  const label = {
    clean: "clean",
    minor_issues: "minor",
    major_issues: "major",
    blockers: "blockers",
  }[verdict];
  return (
    <span
      className={cn(
        "inline-block text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border shrink-0",
        cls,
      )}
      title={`overall verdict: ${verdict}`}
    >
      {label}
    </span>
  );
}

function SeverityCount({
  label,
  count,
  severity,
}: {
  label: string;
  count: number;
  severity: Severity;
}) {
  if (count === 0) return null;
  const cls = {
    blocker: "text-rose-700",
    major: "text-amber-700",
    minor: "text-slate-600",
    ok: "text-emerald-700",
  }[severity];
  return (
    <span className={cn("inline-flex items-baseline gap-0.5", cls)}>
      <span className="font-semibold">{count}</span>
      <span>{label}</span>
    </span>
  );
}

function formatTimestamp(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
