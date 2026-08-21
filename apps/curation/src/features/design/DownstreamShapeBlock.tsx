import type { Design, SubsetRecommendation } from "@/features/experiment/types";
import { useDesignDraft } from "./DesignDraftContext";
import { useIsReadOnly } from "@/features/comparison/FlowContext";
import {
  proposedSubsets,
  resolveSubset,
  sourceChip,
  sourceLabel,
  subsetFactorLabel,
  tierMetaOf,
  tierTitle,
} from "./subsetRecommendations";

/**
 * Downstream-shape recommendations — split / subset-DEA — as the
 * proposer and audit panels show them. Reads
 * ``Design.should_split_on_factor_id`` and
 * ``Design.subset_recommendations``, seeded at import from Gemma's own
 * analysis structure and from the agent's split/subset machinery.
 *
 * It sits at the TOP of the panel (Paul, 2026-08-20) because it is a
 * statement about the whole experiment: a curator who reads the
 * per-factor cards first has already started reviewing a design whose
 * analysis scope they haven't been told about.
 *
 * 🛑 **In effect by default; reject is the only affordance.** Paul,
 * 2026-08-20: *"the default is to accept it unless you disagree"*.
 * There is deliberately no Accept button — the recommendation already
 * rides on the design draft (which IS the left-hand side of this
 * review), so "accept" would be a click that changes nothing but the
 * curator's sense that they owed one. 64 of the 69 seeded
 * recommendations are routine convention; asking for 69 confirmations
 * to record 5 real signals is the wrong trade.
 *
 * Shared by ProposalCardV2 (legacy full card), ProposalSidebarPanel and
 * AuditSidebarPanel — single source so the three can't drift.
 */
export function DownstreamShapeBlock({
  draft,
  framed = false,
}: {
  draft: Design | null;
  /** Draw the block's own rounded border. The proposal surfaces nest
   *  it inside a card and want only the bottom rule it ships with; the
   *  audit panel renders it standalone and needs the frame. It lives
   *  here rather than in a wrapper at the call site because the block
   *  returns null when there is nothing to say — a caller's wrapper
   *  would leave an empty bordered box on every experiment without a
   *  recommendation, which is most of them. */
  framed?: boolean;
}) {
  const { apply } = useDesignDraft();
  const readOnly = useIsReadOnly();

  if (!draft) return null;
  const splitFactorId = draft.should_split_on_factor_id;
  const splitFactor =
    typeof splitFactorId === "number" && splitFactorId > 0
      ? draft.factors.find((f) => f.id === splitFactorId) ?? null
      : null;

  // 🛑 What the agent is PROPOSING — Paul, 2026-08-20: *"these should
  // be in the proposal panel on the right, if they are coming from a
  // proposal. If they are already in the system, obviously they are
  // shown."* Gemma's own rows are already part of the record and sit in
  // the design tab's Experiment-wide decisions, which is on screen
  // beside this panel; repeating them here was half of what made the
  // surface feel duplicated.
  //
  // Silent (tier 1) and stale ones drop out too: nothing to say, and
  // "no longer applies" belongs where the full list lives, not in a
  // panel whose job is to flag what wants a look.
  const subsets = proposedSubsets(draft);
  if (!splitFactor && subsets.length === 0) return null;

  const reject = (id: string) => {
    apply((d) => ({
      ...d,
      subset_recommendations: (d.subset_recommendations ?? []).map((r) =>
        r.id === id ? { ...r, status: "rejected" as const } : r,
      ),
    }));
  };

  const fvChipStrip = (fvs: { id: number; free_text_label: string }[]) =>
    fvs.length === 0 ? null : (
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
    <div
      className={
        (framed
          ? "rounded-lg border border-slate-200 dark:border-slate-700 "
          : "border-b border-slate-100 dark:border-slate-800 ") +
        "px-3 py-2 space-y-1.5 bg-slate-50/70 dark:bg-slate-900/30"
      }
    >
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[9px] uppercase tracking-wide font-semibold text-slate-700 dark:text-slate-200 bg-slate-200 dark:bg-slate-700/60 px-1.5 py-0.5 rounded">
          proposed analysis scope
        </span>
        {/* Says what is true rather than what is owed. The old strip
            read "agent recommendation · review on design tab", which
            announced a task on a surface where none of these are
            tasks. */}
        <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
          in effect unless you reject
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
          {fvChipStrip(splitFactor.factor_values ?? []) ?? (
            <span className="text-[10px] italic text-slate-500">
              (no factor values yet)
            </span>
          )}
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
      {subsets.map((r) => (
        <SubsetRow
          key={r.id}
          rec={r}
          draft={draft}
          readOnly={readOnly}
          onReject={() => reject(r.id)}
          fvChipStrip={fvChipStrip}
        />
      ))}
    </div>
  );
}

function SubsetRow({
  rec,
  draft,
  readOnly,
  onReject,
  fvChipStrip,
}: {
  rec: SubsetRecommendation;
  draft: Design;
  readOnly: boolean;
  onReject: () => void;
  fvChipStrip: (
    fvs: { id: number; free_text_label: string }[],
  ) => React.ReactNode;
}) {
  const { factor, matchedLevels } = resolveSubset(rec, draft);
  const tier = tierMetaOf(rec);
  const axis = subsetFactorLabel(rec, draft);

  return (
    <div className="text-[11px] flex items-baseline flex-wrap gap-1.5">
      {/* A row naming no axis is a note, not a subset. "subset on (no
          factor) · every level" claimed a DEA per level of nothing. */}
      <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
        {axis ? "subset" : "note"}
      </span>
      {axis ? (
        <>
          <span className="text-slate-700 dark:text-slate-200">on</span>
          <span className="font-medium text-slate-800 dark:text-slate-100">
            {axis}
          </span>
        </>
      ) : null}
      {!axis ? null : factor === null ? (
        <span className="italic text-slate-500 dark:text-slate-400">
          (not yet a factor in this design)
        </span>
      ) : matchedLevels.length > 0 ? (
        <>
          <span className="text-slate-400 dark:text-slate-500">·</span>
          {fvChipStrip(matchedLevels)}
        </>
      ) : (
        // Empty level_labels means the whole factor is the axis — one
        // DEA per level. Say it, or the row looks like a subset whose
        // levels went missing.
        <span className="text-[10px] text-slate-500 dark:text-slate-400">
          · every level
        </span>
      )}
      {tier ? (
        <span
          className="text-[10px] uppercase tracking-wide rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200 px-1.5 py-0.5"
          title={tierTitle(rec)}
        >
          {tier.label}
        </span>
      ) : null}
      <span
        className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400"
        title={sourceLabel(rec)}
      >
        {sourceChip(rec)}
      </span>
      {rec.rationale ? (
        <span
          className={
            "text-[10px] italic text-slate-500 dark:text-slate-400 " +
            // A note has nothing but its rationale, so it gets the room;
            // a subset row already said the axis and the levels, so its
            // rationale is a trailing gloss and is clamped.
            (axis ? "truncate max-w-[40ch]" : "")
          }
          title={rec.rationale}
        >
          {axis ? "— " : ""}
          {rec.rationale}
        </span>
      ) : null}
      {/* Reject only, and it sits last: the recommendation is already
          in force, so the button is the exit, not the entrance. */}
      {readOnly ? null : (
        <button
          type="button"
          onClick={onReject}
          title="In effect by default. Reject if you disagree — it stays on the design tab as a recorded no-vote."
          className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          Reject
        </button>
      )}
    </div>
  );
}
