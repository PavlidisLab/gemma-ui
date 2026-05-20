import { useMemo } from "react";
import { useAllProposals } from "@/api/proposals";
import { useLogout } from "@/api/session";
import { experimentRoute, navigate } from "@/routes";
import type { Proposal, ProposalStatus } from "@/api/types";
import { useStickyState } from "@/lib/useStickyState";
import { ModeChip } from "@/components/ui/ModeChip";

/**
 * Cross-experiment inbox of agent-submitted curation proposals.
 *
 * The single-experiment view (in Shell) shows proposals for the
 * one experiment a curator is working on. This page exists for the
 * complementary workflow: triage what arrived overnight, decide
 * what to look at next.
 *
 * Each row links into the experiment detail page (with the
 * proposals sidebar already in view); the actual accept/reject
 * flow stays in `ProposalCard` so we don't fork the feedback UX.
 */
export function ProposalsInbox({ reviewer }: { reviewer: string }) {
  const [statusFilter, setStatusFilter] = useStickyState<ProposalStatus>(
    "proposals.inbox.statusFilter",
    "pending",
  );
  const { data, isLoading, error, refetch, isFetching } = useAllProposals({
    status: statusFilter,
  });
  const logout = useLogout();
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const grouped = useMemo(() => groupByExperiment(items), [items]);

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
            <span className="font-semibold">Proposals</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <a
              href="#/audits"
              className="text-slate-500 hover:text-slate-900 hover:underline"
              title="audits inbox"
            >
              audits
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
              Curation proposals
              <span className="ml-2 text-xs text-slate-500 font-normal">
                {total} {statusFilter}
              </span>
            </h1>
            <div className="flex items-center gap-2">
              <StatusTab
                value="pending"
                current={statusFilter}
                onChange={setStatusFilter}
              />
              <StatusTab
                value="needs_changes"
                current={statusFilter}
                onChange={setStatusFilter}
              />
              <StatusTab
                value="accepted"
                current={statusFilter}
                onChange={setStatusFilter}
              />
              <StatusTab
                value="rejected"
                current={statusFilter}
                onChange={setStatusFilter}
              />
              <button
                type="button"
                className="btn ghost text-xs"
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
              No {statusFilter} proposals.
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

function StatusTab({
  value,
  current,
  onChange,
}: {
  value: ProposalStatus;
  current: ProposalStatus;
  onChange: (s: ProposalStatus) => void;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`text-xs px-2 py-1 border rounded ${
        active
          ? "bg-slate-800 text-white border-slate-800"
          : "border-slate-200 text-slate-700 hover:bg-slate-50"
      }`}
    >
      {value.replace("_", " ")}
    </button>
  );
}

interface Group {
  experimentId: number;
  experimentShortName: string;
  items: Proposal[];
}

function groupByExperiment(items: Proposal[]): Group[] {
  const m = new Map<number, Group>();
  for (const p of items) {
    const g = m.get(p.experiment_id) ?? {
      experimentId: p.experiment_id,
      experimentShortName: p.experiment_short_name,
      items: [],
    };
    g.items.push(p);
    m.set(p.experiment_id, g);
  }
  // Newest experiment first (most recently-submitted item wins).
  return Array.from(m.values()).sort((a, b) => {
    const aMax = a.items[0]?.submitted_at ?? "";
    const bMax = b.items[0]?.submitted_at ?? "";
    return bMax.localeCompare(aMax);
  });
}

function ExperimentGroup({ group }: { group: Group }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => navigate(experimentRoute(group.experimentId, "proposals"))}
        className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-baseline gap-3"
      >
        <span className="font-mono text-sm shrink-0">
          {group.experimentShortName}
        </span>
        <span className="text-xs text-slate-500 shrink-0">
          {group.items.length} proposal{group.items.length === 1 ? "" : "s"}
        </span>
        <span className="text-xs text-slate-400">
          newest{" "}
          {formatTimestamp(group.items[0]?.submitted_at ?? "")}
        </span>
      </button>
      <ul className="border-t border-slate-100 bg-slate-50/40">
        {group.items.map((p, i) => (
          <li
            // ``proposal_id`` is server-assigned and stable; for any
            // partially-validated payload that lacks one, fall back
            // to a composite key (experiment + submitter + index)
            // that's stable across renders. ``Math.random()`` was
            // here previously and rebuilt the row each render,
            // killing reconciliation and resetting any in-flight
            // state in the row.
            key={
              p.proposal_id ??
              `${p.experiment_id}|${p.submitted_by}|${p.submitted_at}|${i}`
            }
            className="px-6 py-1.5 text-xs flex items-baseline gap-3"
          >
            <span className="text-slate-500 shrink-0 w-32 truncate">
              {p.submitted_by || "agent"}
            </span>
            <span className="text-slate-700 flex-1">
              <ShapeSummary p={p} />
            </span>
            <span className="text-slate-400 shrink-0">
              {formatTimestamp(p.submitted_at)}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

function ShapeSummary({ p }: { p: Proposal }) {
  const nFactors = p.factors?.length ?? 0;
  const nFvs = (p.factors ?? []).reduce(
    (acc, f) => acc + (f.factor_values?.length ?? 0),
    0,
  );
  const nTags = p.tags?.length ?? 0;
  const parts: string[] = [];
  if (nFactors) parts.push(`${nFactors} factor${nFactors === 1 ? "" : "s"} (${nFvs} FV)`);
  if (nTags) parts.push(`${nTags} tag${nTags === 1 ? "" : "s"}`);
  if (!parts.length) parts.push("(empty)");
  return <span>{parts.join(" · ")}</span>;
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
