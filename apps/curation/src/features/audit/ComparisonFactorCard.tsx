/**
 * ComparisonFactorCard — modular, compact, side-by-side factor display
 * for calibration findings. Replaces FindingDetailsEditor's per-element
 * editor for findings whose primary curator question is "what's the
 * difference between Polished Gemma's curation and the agent's proposal?".
 *
 * Per HANDOFF_2026-06-08_FACTOR_DISPLAY_BASELINE_COMPARATOR.md the goal
 * is ONE factor display that works across (rename / extra / miss /
 * match) variants and across comparator sources (Polished Gemma / curator /
 * agent / preboard / none). v1 of this file handles rename specifically
 * with the structure generalized so extending to other codes is
 * config-only, no new components.
 *
 * Design constraints (Paul, 2026-06-08, "FLEXIBILITY and CLARITY and
 * CONSISTENCY ... modular ... reused everywhere we have this need ...
 * never touched again unless we want to adjust it"):
 *
 * - **No per-FV decision buttons.** ONE accept / dismiss / park per
 *   card. Per-row pick buttons were the noise the editor produced.
 * - **Side-by-side two-column layout.** LEFT = baseline (Polished Gemma current
 *   by default), RIGHT = comparator (agent proposal here). Curator's
 *   eye lands on what differs.
 * - **Full statements on each side.** Subject — predicate — object
 *   rendered with the shared FvDisplayRow renderer so the chip / URI
 *   treatment matches everywhere else in the app.
 * - **Judge content surfaces at the top.** When the finding has a
 *   defender_verdict (boss / arbiter / defender), the rationale +
 *   verdict pill render as a "Judge:" row above the category. NO
 *   "[agent emitted no details]" fallback — when there's no judge
 *   verdict, the whole row is suppressed.
 * - **Modular shoulders.** All side labels, factors, and actions come
 *   from props. The wrapper component for each issue_code wires the
 *   right source for each prop.
 */

import { useMemo, useState } from "react";
import { FvDisplayRow, type FvTermRenderer } from "@gemma/ontology";

import type {
  AuditFinding,
  AttachedDefenderVerdict,
  DismissReason,
} from "@/api/auditTypes";
import type { FactorProposal, FactorValueProposal } from "@/api/types";
import type { Factor } from "@/features/experiment/types";

import { useAudit } from "./AuditContext";
import { useDesign } from "@/api/design";

const Term: FvTermRenderer = ({ label, uri, variant }) => {
  if (variant === "predicate") {
    return (
      <span
        className="text-[10px] text-slate-500 dark:text-slate-300 font-mono"
        title={uri || undefined}
      >
        {label}
      </span>
    );
  }
  return (
    <span
      className={
        uri
          ? "inline-flex items-baseline gap-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-100"
          : "inline-flex items-baseline rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px] italic text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
      }
      title={uri || "free-text (no ontology URI)"}
    >
      <span>{label}</span>
      {uri ? (
        <span className="text-[9px] font-mono text-emerald-700/70 dark:text-emerald-300/70">
          {uri.split(/[\/#:]/).filter(Boolean).pop()}
        </span>
      ) : null}
    </span>
  );
};

/** A factor side — what the column header reads + the factor it points
 *  at. Either side may be null (e.g. an extra finding has no baseline
 *  factor; a miss finding has no comparator). */
export interface FactorSide {
  /** Column header label — "Polished Gemma" / "Agent" / "Cyan" / "Preboard". */
  label: string;
  /** Provenance hint — rendered as a small subtitle under the label
   *  (e.g. "current curation" / "proposed" / "polished gold"). */
  source: string;
  /** The factor itself. Mixed type because Polished Gemma-side carries the
   *  full ``Factor`` shape (with category URIs and FV ids from the DB)
   *  whereas the agent comparison-proposal side carries
   *  ``FactorProposal`` (no DB ids; richer statement structure). */
  factor: Factor | FactorProposal | null;
}

/** Each FV pair: an LEFT FV (baseline side) optionally paired with a
 *  RIGHT FV (comparator side). Either may be null when the partition
 *  doesn't align. */
interface PairedFv {
  left: Factor["factor_values"][number] | FactorValueProposal | null;
  right: Factor["factor_values"][number] | FactorValueProposal | null;
  /** Quick visual indicator: "same" (labels match), "drift" (labels
   *  differ), "left_only", "right_only". */
  status: "same" | "drift" | "left_only" | "right_only";
}

function fvLabel(
  fv: Factor["factor_values"][number] | FactorValueProposal | null,
): string {
  if (!fv) return "";
  return (fv.free_text_label || "").trim().toLowerCase();
}

function fvBms(
  fv: Factor["factor_values"][number] | FactorValueProposal | null,
): Set<string> {
  if (!fv) return new Set();
  return new Set(fv.biomaterial_short_names ?? []);
}

/** Pair FVs across baseline + comparator factors. Strategy:
 *  1. Bijective match by biomaterial-set overlap (Jaccard ≥ 0.5).
 *  2. Any unmatched on either side render as left_only / right_only. */
function pairFvs(
  leftFactor: FactorSide["factor"],
  rightFactor: FactorSide["factor"],
): PairedFv[] {
  const leftFvs = leftFactor?.factor_values ?? [];
  const rightFvs = rightFactor?.factor_values ?? [];
  const claimedRight = new Set<number>();
  const pairs: PairedFv[] = [];
  for (const l of leftFvs) {
    const lBms = fvBms(l);
    let bestIx = -1;
    let bestJ = 0;
    for (let ix = 0; ix < rightFvs.length; ix++) {
      if (claimedRight.has(ix)) continue;
      const rBms = fvBms(rightFvs[ix]);
      const inter = [...lBms].filter((b) => rBms.has(b)).length;
      const union = new Set([...lBms, ...rBms]).size;
      const j = union > 0 ? inter / union : 0;
      if (j > bestJ) {
        bestJ = j;
        bestIx = ix;
      }
    }
    if (bestIx >= 0 && bestJ >= 0.5) {
      claimedRight.add(bestIx);
      const r = rightFvs[bestIx];
      const status =
        fvLabel(l) === fvLabel(r) && fvLabel(l) !== "" ? "same" : "drift";
      pairs.push({ left: l, right: r, status });
    } else {
      pairs.push({ left: l, right: null, status: "left_only" });
    }
  }
  for (let ix = 0; ix < rightFvs.length; ix++) {
    if (!claimedRight.has(ix)) {
      pairs.push({ left: null, right: rightFvs[ix], status: "right_only" });
    }
  }
  return pairs;
}

function statusGlyph(status: PairedFv["status"]): {
  ch: string;
  cls: string;
  title: string;
} {
  switch (status) {
    case "same":
      return { ch: "=", cls: "text-emerald-600 dark:text-emerald-400", title: "labels match" };
    case "drift":
      return { ch: "≈", cls: "text-amber-600 dark:text-amber-400", title: "paired by sample partition; labels differ" };
    case "left_only":
      return { ch: "−", cls: "text-amber-600 dark:text-amber-400", title: "baseline-only (no comparator counterpart)" };
    case "right_only":
      return { ch: "+", cls: "text-amber-600 dark:text-amber-400", title: "comparator-only (no baseline counterpart)" };
  }
}

/** Category chip pair — baseline category vs comparator category, with
 *  URI tags. Free-text categories (no URI) render with a "free-text"
 *  visual cue so the curator sees the agent skipped ontology grounding. */
function CategoryPair({
  leftLabel,
  leftCategory,
  rightLabel,
  rightCategory,
}: {
  leftLabel: string;
  leftCategory: { label: string | null; uri: string | null } | null;
  rightLabel: string;
  rightCategory: { label: string | null; uri: string | null } | null;
}) {
  const showCategoryRow = !!(leftCategory?.label || rightCategory?.label);
  if (!showCategoryRow) return null;
  return (
    <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-2 items-baseline text-[11px] py-1 px-1.5 rounded bg-slate-50/60 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
      <span className="text-[9px] uppercase tracking-wide text-slate-400">
        {leftLabel}
      </span>
      <span>
        {leftCategory?.label ? (
          <Term
            label={leftCategory.label}
            uri={leftCategory.uri ?? null}
          />
        ) : (
          <em className="text-slate-400">(no factor)</em>
        )}
      </span>
      <span className="text-[9px] uppercase tracking-wide text-slate-400 pl-2 border-l border-slate-200 dark:border-slate-700">
        {rightLabel}
      </span>
      <span>
        {rightCategory?.label ? (
          <Term
            label={rightCategory.label}
            uri={rightCategory.uri ?? null}
          />
        ) : (
          <em className="text-slate-400">(no factor)</em>
        )}
      </span>
    </div>
  );
}

/** Per-FV side-by-side row. One row per paired (left, right) FV. */
function FvPairRow({ pair }: { pair: PairedFv }) {
  const g = statusGlyph(pair.status);
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 items-baseline text-[11px] px-1.5 py-1 border-b border-slate-100 dark:border-slate-800 last:border-b-0">
      <div className="min-w-0">
        {pair.left ? (
          <FvDisplayRow fv={pair.left} termRenderer={Term} />
        ) : (
          <em className="text-slate-400">(no FV)</em>
        )}
      </div>
      <span
        className={`${g.cls} text-center select-none`}
        title={g.title}
        aria-label={pair.status}
      >
        {g.ch}
      </span>
      <div className="min-w-0">
        {pair.right ? (
          <FvDisplayRow fv={pair.right} termRenderer={Term} />
        ) : (
          <em className="text-slate-400">(no FV)</em>
        )}
      </div>
    </div>
  );
}

function JudgeRow({
  verdict,
}: {
  verdict: AttachedDefenderVerdict | null;
}) {
  if (!verdict || !verdict.rationale?.trim()) return null;
  const sidePalette =
    verdict.side === "boss"
      ? "border-purple-300/70 bg-purple-50/60 text-purple-900 dark:border-purple-700/60 dark:bg-purple-900/15 dark:text-purple-100"
      : "border-blue-300/70 bg-blue-50/60 text-blue-900 dark:border-blue-700/60 dark:bg-blue-900/15 dark:text-blue-100";
  return (
    <div className={`rounded border px-2 py-1 text-[11px] leading-snug ${sidePalette}`}>
      <div className="flex items-baseline gap-1.5">
        <span className="font-semibold uppercase tracking-wide text-[9px]">
          {verdict.side}
        </span>
        <span className="font-mono text-[10px]">{verdict.verdict}</span>
        {verdict.confidence ? (
          <span className="text-[9px] opacity-70">
            · {verdict.confidence}
          </span>
        ) : null}
      </div>
      <div className="italic opacity-90 mt-0.5">{verdict.rationale}</div>
    </div>
  );
}

export interface ComparisonFactorCardProps {
  finding: AuditFinding;
  /** Custom title — defaults to a rename-style framing built from
   *  the rename payload. Caller overrides for extra / miss / match
   *  variants. */
  title?: React.ReactNode;
  /** Column header label for the LEFT (baseline) side. When
   *  omitted, falls back to the chip strip's currently-selected
   *  baseline source label. When the chip strip has no opinion
   *  either, falls back to "Baseline".
   *
   *  Per memory project-curation-overlay-model (2026-06-08): the
   *  card doesn't know which curation is on which side; that's
   *  the chip strip's job. The card's role is to render
   *  "baseline vs comparator with delta on the right" given
   *  whatever the chip strip selected. */
  leftLabel?: string;
  /** Column header label for the RIGHT (comparator) side. Same
   *  semantics as `leftLabel`. */
  rightLabel?: string;
}

/** The card itself. Pulls baseline (Polished Gemma) from the design and
 *  comparator (agent) from the comparison_proposal, then renders the
 *  side-by-side layout. */
export function ComparisonFactorCard({
  finding,
  title,
  leftLabel: leftLabelProp,
  rightLabel: rightLabelProp,
}: ComparisonFactorCardProps) {
  const { report, experimentId, setDisposition, dispositionByTarget } =
    useAudit();
  const { data: design } = useDesign(experimentId);
  const [busy, setBusy] = useState(false);

  // Labels: prop > chip-strip selection > generic fallback.
  // Reading chip-strip selection requires the flow context the
  // experiment-shell sets — defer that wiring to the proper Source-
  // enum elimination (step 3b). For now: prop wins; generic fallback
  // when no prop. This keeps the card structurally honest (labels
  // come from outside, not hardcoded "POLISHED GEMMA") without
  // taking on the deeper Source-type refactor in this commit.
  const leftLabel = leftLabelProp ?? "Baseline";
  const rightLabel = rightLabelProp ?? "Comparator";

  const dispo = dispositionByTarget.get(finding.target_id) ?? null;
  const status = dispo?.status ?? "pending";

  // LEFT = baseline = Polished Gemma (current design's factor at gold_target_index).
  // RIGHT = comparator = Agent (comparison_proposal factor at agent_target_index).
  const leftFactor: Factor | null = useMemo(() => {
    const ix = finding.gold_target_index;
    if (ix == null) return null;
    return design?.factors?.[ix] ?? null;
  }, [finding.gold_target_index, design]);

  const rightFactor: FactorProposal | null = useMemo(() => {
    const ix = finding.agent_target_index;
    if (ix == null) return null;
    return (
      report?.evidence?.comparison_proposal?.factors?.[ix] ?? null
    );
  }, [finding.agent_target_index, report]);

  const leftCategory = leftFactor
    ? {
        label: leftFactor.category?.label ?? null,
        uri: leftFactor.category?.uri ?? null,
      }
    : null;
  const rightCategory = rightFactor
    ? {
        label: rightFactor.category?.label ?? null,
        uri: rightFactor.category?.uri ?? null,
      }
    : null;

  const pairs = useMemo(
    () => pairFvs(leftFactor, rightFactor),
    [leftFactor, rightFactor],
  );

  // Default title: "Rename `left.category` → `right.category`" for
  // rename, generic verb-tagged for other codes (callers can override).
  const derivedTitle =
    title ??
    (finding.issue_code === "calibration_factor_rename"
      ? (
          <span className="text-[12px] font-semibold">
            Rename factor: <span className="font-mono">{leftCategory?.label ?? "?"}</span>
            <span className="text-slate-400"> → </span>
            <span className="font-mono">{rightCategory?.label ?? "?"}</span>
          </span>
        )
      : finding.issue_code === "calibration_factor_match_near"
        ? (
            <span className="text-[12px] font-semibold">
              Partition mismatch: <span className="font-mono">{leftCategory?.label ?? "?"}</span>
              <span className="text-slate-400 font-normal text-[11px] ml-1">
                ({rightFactor?.factor_values?.length ?? "?"} vs {leftFactor?.factor_values?.length ?? "?"} levels)
              </span>
            </span>
          )
      : finding.issue_code === "calibration_factor_extra"
        ? (
            <span className="text-[12px] font-semibold">
              Add factor: <span className="font-mono">{rightCategory?.label ?? "?"}</span>
            </span>
          )
        : finding.issue_code === "calibration_factor_gold_only_miss"
          ? (
              <span className="text-[12px] font-semibold">
                Remove factor: <span className="font-mono">{leftCategory?.label ?? "?"}</span>
              </span>
            )
          : (
              <span className="text-[12px] font-semibold">
                {(leftCategory?.label || rightCategory?.label) ?? "(factor)"}
              </span>
            ));

  async function dispatch(
    next: "accepted" | "dismissed" | "needs_more_info",
    extras?: { dismissReason?: DismissReason; notes?: string },
  ) {
    setBusy(true);
    try {
      await setDisposition(finding.target_id, next, extras);
    } finally {
      setBusy(false);
    }
  }

  // Action labels follow the action shape — for renames, accept =
  // "adopt rename" (curator takes the agent's category), dismiss =
  // "keep current". Modularizable per issue_code.
  const acceptLabel =
    finding.issue_code === "calibration_factor_rename"
      ? "Adopt rename"
      : finding.issue_code === "calibration_factor_extra"
        ? "Add factor"
        : finding.issue_code === "calibration_factor_gold_only_miss"
          ? "Remove factor"
          : "Accept";
  const dismissLabel =
    finding.issue_code === "calibration_factor_rename"
      ? "Keep current"
      : finding.issue_code === "calibration_factor_extra"
        ? "Don't add"
        : finding.issue_code === "calibration_factor_gold_only_miss"
          ? "Keep current"
          : "Dismiss";

  const sevPalette =
    status === "accepted"
      ? "border-emerald-400/70 bg-emerald-50/30 dark:bg-emerald-900/10"
      : status === "dismissed"
        ? "border-slate-400/70 bg-slate-50/30 dark:bg-slate-900/10 opacity-70"
        : finding.severity === "ok"
          ? "border-emerald-300/70 bg-white dark:border-emerald-700/40 dark:bg-slate-900/40"
          : finding.severity === "major" || finding.severity === "blocker"
            ? "border-amber-300/70 bg-amber-50/30 dark:border-amber-700/60 dark:bg-amber-900/10"
            : "border-slate-300/70 bg-white dark:border-slate-700 dark:bg-slate-900/40";

  return (
    <div className={`rounded border ${sevPalette} px-2.5 py-2 space-y-2`}>
      <div className="flex items-baseline gap-2">
        {derivedTitle}
        <span className="text-[9px] uppercase tracking-wide text-slate-400 ml-auto">
          {status === "pending" ? "open" : status}
        </span>
      </div>
      <JudgeRow verdict={finding.defender_verdict ?? null} />
      <CategoryPair
        leftLabel={leftLabel}
        leftCategory={leftCategory}
        rightLabel={rightLabel}
        rightCategory={rightCategory}
      />
      {pairs.length > 0 ? (
        <div className="rounded border border-slate-200 dark:border-slate-700 bg-white/40 dark:bg-slate-900/30">
          <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 px-1.5 py-1 border-b border-slate-200 dark:border-slate-700 text-[9px] uppercase tracking-wide text-slate-400">
            <span>{leftLabel}</span>
            <span>&nbsp;</span>
            <span>{rightLabel}</span>
          </div>
          {pairs.map((p, i) => (
            <FvPairRow key={i} pair={p} />
          ))}
        </div>
      ) : null}
      {finding.proposer_defense ? (
        <div className="text-[11px] text-slate-600 dark:text-slate-300 italic">
          <span className="font-semibold not-italic text-slate-700 dark:text-slate-200">
            Agent says:{" "}
          </span>
          {finding.proposer_defense}
        </div>
      ) : null}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => dispatch("accepted")}
          className="text-[11px] px-2 py-0.5 rounded font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {acceptLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => dispatch("dismissed", { dismissReason: "wont_fix" })}
          className="text-[11px] px-2 py-0.5 rounded font-medium bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 disabled:opacity-50"
        >
          {dismissLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => dispatch("needs_more_info")}
          className="text-[11px] px-2 py-0.5 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
        >
          Park
        </button>
      </div>
    </div>
  );
}
