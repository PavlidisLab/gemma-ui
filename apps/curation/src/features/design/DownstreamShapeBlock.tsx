import type { Design } from "@/features/experiment/types";

/**
 * Downstream-shape recommendations — split / subset-DEA / partial-coverage
 * the agent landed on ``Design.should_split_on_factor_id`` and
 * ``Design.subset_recommendations`` (seeded at calibration import from the
 * live S2o/S2n split-subset machinery). Read-only at proposal surfaces —
 * the canonical accept/reject UI still lives in the design tab's
 * "Experiment-wide decisions" pane (per Paul 2026-06-14: leave them in both
 * places). The curator scanning a proposal needs to SEE these so they don't
 * miss the recommendation; the full disposition lives where it always did.
 *
 * Shared by ProposalCardV2 (legacy full card) and ProposalSidebarPanel (the
 * newer sidebar) — single source so the two surfaces can't drift.
 */
export function DownstreamShapeBlock({ draft }: { draft: Design | null }) {
  if (!draft) return null;
  const splitFactorId = draft.should_split_on_factor_id;
  const splitFactor =
    typeof splitFactorId === "number" && splitFactorId > 0
      ? draft.factors.find((f) => f.id === splitFactorId) ?? null
      : null;
  const agentSubsets = (draft.subset_recommendations ?? []).filter(
    (r) =>
      r.status === "agent_recommended" &&
      (r.source === "agent" || !r.source),
  );
  if (!splitFactor && agentSubsets.length === 0) return null;

  const fvChipStrip = (fvs: { id: number; free_text_label: string }[]) =>
    fvs.length === 0 ? (
      <span className="text-[10px] italic text-slate-500">
        (no factor values yet)
      </span>
    ) : (
      <span className="inline-flex flex-wrap items-baseline gap-1">
        {fvs.map((fv) => (
          <span
            key={fv.id}
            className="inline-flex items-baseline rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[10px] text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-100"
          >
            {fv.free_text_label || `fv ${fv.id}`}
          </span>
        ))}
      </span>
    );

  return (
    <div className="px-3 py-2 border-b border-slate-100 space-y-1.5 bg-amber-50/40 dark:bg-amber-900/10">
      <div className="flex items-baseline gap-2">
        <span className="text-[9px] uppercase tracking-wide font-semibold text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded">
          downstream shape
        </span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
          agent recommendation · review on design tab
        </span>
      </div>
      {splitFactor ? (
        <div className="text-[11px] flex items-baseline flex-wrap gap-1.5">
          <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
            split
          </span>
          <span className="text-slate-700 dark:text-slate-200">on</span>
          <span className="font-medium text-slate-800 dark:text-slate-100">
            {splitFactor.name ||
              splitFactor.category?.label ||
              `factor ${splitFactor.id}`}
          </span>
          <span className="text-slate-400 dark:text-slate-500">·</span>
          {fvChipStrip(splitFactor.factor_values ?? [])}
          {draft.should_split_rationale ? (
            <span
              className="text-[10px] italic text-slate-500 dark:text-slate-400 truncate max-w-[40ch]"
              title={draft.should_split_rationale}
            >
              — {draft.should_split_rationale}
            </span>
          ) : null}
        </div>
      ) : null}
      {agentSubsets.map((r) => {
        const f =
          typeof r.by_factor_id === "number"
            ? draft.factors.find((x) => x.id === r.by_factor_id) ?? null
            : null;
        const matchedFvs = f
          ? (f.factor_values ?? []).filter((fv) =>
              r.level_labels.includes(fv.free_text_label),
            )
          : [];
        return (
          <div
            key={r.id}
            className="text-[11px] flex items-baseline flex-wrap gap-1.5"
          >
            <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
              subset
            </span>
            {f ? (
              <>
                <span className="text-slate-700 dark:text-slate-200">on</span>
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {f.name || f.category?.label || `factor ${f.id}`}
                </span>
                <span className="text-slate-400 dark:text-slate-500">·</span>
                {fvChipStrip(matchedFvs)}
              </>
            ) : (
              <span className="italic text-slate-500 dark:text-slate-400">
                (factor not yet in design)
              </span>
            )}
            {r.rationale ? (
              <span
                className="text-[10px] italic text-slate-500 dark:text-slate-400 truncate max-w-[40ch]"
                title={r.rationale}
              >
                — {r.rationale}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
