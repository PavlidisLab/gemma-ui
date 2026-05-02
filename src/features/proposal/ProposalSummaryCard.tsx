import { useState } from "react";
import { cn } from "@/lib/cn";
import type { Proposal } from "@/api/types";

/**
 * Compact "you already triaged this" card for the proposals
 * sidebar. Mirrors the closed-audit summary in
 * `AuditSidebarPanel`: keeps a slim trace of the curator's most
 * recent action so the sidebar doesn't go from full ProposalCardV2
 * straight to "no proposals" the moment they accept or reject.
 *
 * Renders for `status === "accepted"` (emerald pill) and
 * `status === "rejected"` (slate pill). Pending proposals get the
 * full v2 card and never reach this component.
 *
 * Click anywhere on the header to expand: today the expanded body
 * is just the per-target counts; v2 surfaces all of those + the
 * full edit shape, but reanimating that here would make the
 * "summary" the same weight as the original card. Curators who
 * want full provenance go to the History tab — link in the
 * footer.
 */
export function ProposalSummaryCard({
  proposal,
  onRequestRedo,
}: {
  proposal: Proposal;
  /** Optional. Wired to the sidebar's "+ propose" button when the
   *  curator wants to follow up on a recent accept / reject with a
   *  fresh run. Hidden when undefined. */
  onRequestRedo?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const accepted = proposal.status === "accepted";

  const nFactors = proposal.factors.length;
  const nFvs = proposal.factors.reduce(
    (n, f) => n + f.factor_values.length,
    0,
  );
  const nTags = proposal.tags.length;
  const nSamples = proposal.factors.reduce(
    (n, f) =>
      n +
      f.factor_values.reduce(
        (m, fv) => m + fv.biomaterial_short_names.length,
        0,
      ),
    0,
  );

  return (
    <div
      className={cn(
        "card text-[11px]",
        accepted
          ? "border-emerald-200 bg-emerald-50/40"
          : "border-slate-200 bg-slate-50/60 opacity-90",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full text-left px-2 py-1.5 flex items-center gap-2 rounded-t",
          accepted ? "hover:bg-emerald-50/80" : "hover:bg-slate-100/80",
        )}
        title={open ? "collapse" : "expand"}
      >
        <span
          className={cn(
            "inline-block text-[9px] uppercase tracking-wide font-bold px-1 py-0 rounded shrink-0",
            accepted
              ? "bg-emerald-200 text-emerald-900"
              : "bg-slate-300 text-slate-800",
          )}
          title={accepted ? "you accepted this proposal" : "you rejected this proposal"}
        >
          {accepted ? "✓ accepted" : "✗ rejected"}
        </span>
        <span className="flex-1 min-w-0 truncate text-slate-700">
          Proposal{" "}
          <span className="font-mono text-[10px] text-slate-500">
            {proposal.proposal_id ?? "(unsaved)"}
          </span>
          {proposal.model ? (
            <span className="text-slate-400"> · {proposal.model}</span>
          ) : null}
        </span>
        <span aria-hidden className="text-slate-400 text-[10px]">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <div
          className={cn(
            "border-t px-2 py-1.5 space-y-1",
            accepted ? "border-emerald-200" : "border-slate-200",
          )}
        >
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-600">
            <SummaryStat label="factors" value={nFactors} />
            <SummaryStat label="FVs" value={nFvs} />
            <SummaryStat label="tags" value={nTags} />
            <SummaryStat label="samples assigned" value={nSamples} />
          </div>
          <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-100">
            submitted by{" "}
            <span className="font-mono text-slate-700">
              {proposal.submitted_by || "—"}
            </span>
            {proposal.submitted_at ? (
              <> · {formatShort(proposal.submitted_at)}</>
            ) : null}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                // History tab inside the same experiment carries the
                // full provenance; navigate via hash so the in-app
                // tab guards (dirty-draft etc.) still apply.
                const m = window.location.hash.match(
                  /^#\/experiments\/(\d+)/,
                );
                if (m) {
                  window.location.hash = `#/experiments/${m[1]}/history`;
                }
              }}
              className="text-[10px] text-blue-700 hover:underline"
              title="see this proposal's full provenance in the History tab"
            >
              full details ↗
            </a>
            {onRequestRedo ? (
              <button
                type="button"
                onClick={onRequestRedo}
                className="text-[10px] text-slate-600 hover:text-slate-900 hover:underline"
                title="request a fresh proposal — useful if the accept turned out to need follow-up"
              >
                propose again
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="font-semibold tabular-nums text-slate-800">{value}</span>
      <span className="text-[10px] text-slate-500">{label}</span>
    </div>
  );
}

function formatShort(iso: string): string {
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
