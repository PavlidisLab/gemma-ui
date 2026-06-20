/**
 * Shared side-by-side grid for paired-factor comparison surfaces.
 *
 * Renders the same visual shape on both the partition-mismatch /
 * rename card (``ComparisonFactorCard``) and the factor-match path
 * inside ``FindingDetailsEditor``:
 *
 *  - column-label strip with category chips for each side
 *  - one row per paired FV with the FV index label + sample count,
 *    then the FV's S-P-O representation on each side via
 *    ``FvDisplayRow``
 *  - "(no FV)" placeholder when only one side has a paired FV
 *  - status glyph between the two cells (same / drift / left_only /
 *    right_only)
 *  - per-FV action slot (curator's Confirm / edit … / etc., or empty
 *    when the surface has no per-row affordance)
 *  - footer slot (outer Accept / Dismiss / Park or Agree / Reject /
 *    Park action row)
 *
 * Render-only: no state, no mutations, no fetching. The pairing
 * decision (``PairedFv[]``) is made by the caller via ``pairFvs``
 * (or the auditor-side gold/agent index when that's authoritative)
 * and handed in.
 *
 * History: extracted 2026-06-12 per Paul's "these panels are using
 * different code than the other factor panels. […] This should be
 * unified. Both should use the side-by-side and both should
 * indicate the FVs (FV1, FV2). Propose how to make this so they use
 * more of the same code and are visually comparable."
 */
import { type ReactNode } from "react";
import { FvDisplayRow, type FvTermRenderer } from "@gemma/ontology";
import type { Factor } from "@/features/experiment/types";
import type { FactorValueProposal } from "@/api/types";
import {
  ContinuousStrip,
  type ContinuousStripValue,
} from "./ContinuousStrip";
import { computeFvDiff } from "./fvDiff";

/** One FV on either side of the comparison. ``Factor.factor_values``
 *  (gold) and ``FactorProposal.factor_values`` (agent) both satisfy
 *  this contract; the grid doesn't care which it's looking at. */
export type GridFv =
  | Factor["factor_values"][number]
  | FactorValueProposal
  | null;

/** Continuation marker — a cell slot that the umbrella row above
 *  already filled via rowspan. Lets callers express "this row's left
 *  side is the same FV as the row above's" without re-rendering the
 *  label / count. */
export const CONTINUATION = Symbol("FactorComparisonGrid.CONTINUATION");
export type Continuation = typeof CONTINUATION;

/** One paired row in the grid. The pairing decision is opaque to the
 *  grid — caller supplies ``status`` so the glyph between the cells
 *  reads correctly.
 *
 *  Per-cell rowspan (Paul 2026-06-16, Option B): each cell may be a
 *  ``GridFv`` (renders) or ``CONTINUATION`` (skipped — the umbrella
 *  row above's rowspan covers this slot). The umbrella row sets
 *  ``leftRowSpan`` / ``rightRowSpan`` to N; the next N-1 rows must
 *  set ``left`` / ``right`` to ``CONTINUATION``. Default (omitted)
 *  is one-row-per-pair with no rowspan — back-compat for
 *  factor_match callers. */
export interface FactorComparisonPair {
  left: GridFv | Continuation;
  right: GridFv | Continuation;
  /** Quick visual indicator between the cells:
   *   - ``"same"``       — labels match
   *   - ``"drift"``      — paired by sample partition; labels differ
   *   - ``"left_only"``  — baseline-only (no comparator counterpart)
   *   - ``"right_only"`` — comparator-only (no baseline counterpart)
   *   - ``null``         — no glyph (suppress the column entirely)
   */
  status: "same" | "drift" | "left_only" | "right_only" | null;
  /** Rowspan for the LEFT FV cell. Default 1. */
  leftRowSpan?: number;
  /** Rowspan for the RIGHT FV cell. Default 1. */
  rightRowSpan?: number;
  /** Rowspan for the mid (count) cell. Default 1. Used when the
   *  umbrella side carries a single N that applies to all child
   *  rows — the mid cell rowspans alongside it. */
  midRowSpan?: number;
}

export interface FactorComparisonHeaderSide {
  /** Column header label — "Current" / "Auditor said" / "Agent
   *  original proposal" / a chip-strip-driven curator name. */
  label: string;
  /** Optional native ``title=`` tooltip for the column-header label.
   *  Carries the self-documenting agent-run provenance (run id / sha /
   *  date / model / batch / git describe) so hovering the comparator
   *  header reveals the full run identity — never something to hunt
   *  for. Empty / undefined → no tooltip. */
  title?: string;
  /** Category chip rendered next to the column label. ``null`` →
   *  "(no factor)" placeholder. */
  category: { label: string | null; uri: string | null } | null;
}

export interface FactorComparisonGridProps {
  leftHeader: FactorComparisonHeaderSide;
  rightHeader: FactorComparisonHeaderSide;
  /** Optional locate-in-Design-tab handler for the LEFT column.
   *  When supplied AND the left side has a real category (not the
   *  "(no factor)" placeholder), the header renders a small 🔍
   *  button next to the column label that triggers it. Mirrors the
   *  affordance FindingDetailsEditor's removal-only card already
   *  carries on the "Current" row. Paul 2026-06-14: factors should
   *  get the same affordance. */
  onLeftLocate?: () => void;
  /** Paired FVs, in render order. Empty list → "(no factor values)" */
  pairs: FactorComparisonPair[];
  /** Term renderer threaded into ``FvDisplayRow``. Same primitive
   *  the design surface uses. */
  termRenderer: FvTermRenderer;
  /** Optional per-FV action slot. Renders to the right of the row,
   *  beneath the comparator columns on narrow widths. Return ``null``
   *  to skip the row's action. */
  renderPerFvAction?: (
    pair: FactorComparisonPair,
    fvIndex: number,
  ) => ReactNode;
  /** Optional outer footer (Accept / Dismiss / Agree / Reject /
   *  Park action row). */
  renderFooter?: () => ReactNode;
  /** When true, the body renders a loading skeleton placeholder
   *  instead of pairs. Caller uses this on the /curations slow path
   *  per the existing ComparisonFactorCard loading semantics. */
  loading?: boolean;
  /** When supplied, the body renders a compact agreement strip
   *  (``ContinuousStrip``) instead of the index-by-index pair grid.
   *  Caller computes the per-side numeric values via
   *  ``continuousValuesFrom(factor.factor_values)`` and supplies
   *  them here; the grid stays agnostic about how each side resolved
   *  to a numeric. Use this when either side's factor is
   *  ``factor_type === "continuous"`` — the labelled pair grid is
   *  the wrong shape for measurement-axis comparison (Gemma's per-
   *  measurement FVs + agent's deduped FVs misalign by index). */
  continuous?: {
    left: ContinuousStripValue[];
    right: ContinuousStripValue[];
  };
}

/** Convert a ``status`` to its glyph + colour + tooltip. */
function statusGlyph(status: FactorComparisonPair["status"]): {
  ch: string;
  cls: string;
  title: string;
} | null {
  switch (status) {
    case "same":
      return {
        ch: "=",
        cls: "text-emerald-600 dark:text-emerald-400",
        title: "labels match",
      };
    case "drift":
      return {
        ch: "≈",
        cls: "text-amber-600 dark:text-amber-400",
        title: "paired by sample partition; labels differ",
      };
    case "left_only":
      return {
        ch: "−",
        cls: "text-amber-600 dark:text-amber-400",
        title: "baseline-only (no comparator counterpart)",
      };
    case "right_only":
      return {
        ch: "+",
        cls: "text-amber-600 dark:text-amber-400",
        title: "comparator-only (no baseline counterpart)",
      };
    case null:
      return null;
  }
}

function CategoryChip({
  label,
  uri,
  termRenderer,
}: {
  label: string | null;
  uri: string | null;
  termRenderer: FvTermRenderer;
}) {
  if (!label) {
    return <em className="text-slate-400">(no factor)</em>;
  }
  return termRenderer({ label, uri: uri ?? null });
}

function FvCell({
  fv,
  termRenderer,
  diffChips,
}: {
  fv: GridFv;
  termRenderer: FvTermRenderer;
  diffChips?: ReadonlySet<string>;
}) {
  if (!fv) {
    return <em className="text-slate-400">(no FV)</em>;
  }
  // FV-index prefix ("FV 1" / "FV 2" / …) dropped 2026-06-16 — Paul:
  // "The FV1, FV1, FV2 etc is not needed as long as separate FVs are
  // visibly separate." Row separation now relies on backdrop +
  // padding only.
  return (
    <FvDisplayRow
      fv={fv}
      termRenderer={termRenderer}
      diffChips={diffChips}
      suppressSampleCount
    />
  );
}

export function FactorComparisonGrid({
  leftHeader,
  rightHeader,
  pairs,
  termRenderer,
  renderPerFvAction,
  renderFooter,
  loading,
  onLeftLocate,
  continuous,
}: FactorComparisonGridProps): JSX.Element {
  // Header: column labels + factor category chip pair. Same shape on
  // both surfaces — moving it into the grid means we have one
  // canonical "factor identity row" rather than two slightly-
  // different inline implementations.
  const header = (
    <div
      className="grid items-baseline gap-x-2 py-1 px-1.5 rounded bg-slate-50/60 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 text-[11px]"
      style={{
        gridTemplateColumns:
          "[label-l] auto [chip-l] 1fr [glyph] auto [label-r] auto [chip-r] 1fr [action] auto",
      }}
    >
      <span
        className="text-[9px] uppercase tracking-wide text-slate-400 dark:text-slate-500 inline-flex items-baseline gap-1"
        title={leftHeader.title || undefined}
      >
        {leftHeader.label}
        {onLeftLocate && leftHeader.category?.label ? (
          <button
            type="button"
            onClick={onLeftLocate}
            title="show in Design tab"
            aria-label="show in Design tab"
            className="text-[10px] text-slate-400 hover:text-sky-700 dark:text-slate-500 dark:hover:text-sky-300"
          >
            🔍
          </button>
        ) : null}
      </span>
      <span className="min-w-0">
        <CategoryChip
          label={leftHeader.category?.label ?? null}
          uri={leftHeader.category?.uri ?? null}
          termRenderer={termRenderer}
        />
      </span>
      <span />
      <span
        className="text-[9px] uppercase tracking-wide text-slate-400 dark:text-slate-500 pl-2 border-l border-slate-200 dark:border-slate-700"
        title={rightHeader.title || undefined}
      >
        {rightHeader.label}
      </span>
      <span className="min-w-0">
        <CategoryChip
          label={rightHeader.category?.label ?? null}
          uri={rightHeader.category?.uri ?? null}
          termRenderer={termRenderer}
        />
      </span>
      <span />
    </div>
  );
  const body = loading ? (
    <div className="px-1.5 py-2 text-[11px] italic text-slate-500 dark:text-slate-400">
      <span className="inline-block w-2 h-2 rounded-full bg-amber-400 dark:bg-amber-500 mr-1 animate-pulse align-middle" />
      loading comparison data…
    </div>
  ) : continuous ? (
    <ContinuousStrip
      left={continuous.left}
      right={continuous.right}
      // Strip always uses fixed short lane labels ("current" /
      // "agent") regardless of what the chip strip named the
      // sources — the column-header strip above already surfaces
      // the long names, and the strip's gutter is too narrow to
      // fit ``"agent original proposal"`` without stealing plot
      // width. Defaults inside ContinuousStrip do the right thing;
      // we don't thread the header labels in.
    />
  ) : pairs.length === 0 ? (
    <div className="px-1.5 py-2 text-[11px] italic text-slate-400">
      (no factor values)
    </div>
  ) : (
    <PairGridBody
      pairs={pairs}
      termRenderer={termRenderer}
      renderPerFvAction={renderPerFvAction}
    />
  );
  return (
    <div className="space-y-1">
      {header}
      <div className="rounded border border-slate-200 dark:border-slate-700 bg-white/40 dark:bg-slate-900/30">
        {body}
      </div>
      {renderFooter ? <div>{renderFooter()}</div> : null}
    </div>
  );
}

/** Inner pair-grid body. Renders the side-by-side FV rows with a
 *  per-row sample-partition summary in the middle column ("N ↔ M",
 *  colour-coded green/amber/red). Replaces an earlier SVG sankey
 *  experiment — Paul 2026-06-15: "the sankey is no good; just put
 *  30 ↔ 60 or something … double-headed arrow, with colour
 *  indicating green/amber/red". The ↔ is a comparison glyph (not a
 *  direction marker), so it shows regardless of which way drift
 *  runs.
 *
 *  Falls back to the per-row status glyph (= / ≈ / + / −) when the
 *  pair lacks sample-membership info (``biomaterial_short_names``
 *  empty on both sides) — no counts to compare, the glyph is the
 *  only available pairing hint. */
const MID_COL_PX = 76;

/** Compute the middle-column content for one pair: a coloured count
 *  summary when sample data is present, the legacy glyph otherwise.
 *
 *  Colour rule:
 *   - emerald — both sides have samples AND counts match (clean
 *     partition equivalence)
 *   - amber — both sides have samples but counts differ (partial
 *     overlap / drift)
 *   - rose — one side has samples and the other doesn't (left_only
 *     / right_only at the sample level) */
export function midCellRender(pair: FactorComparisonPair): {
  text: string;
  cls: string;
  title: string;
} | null {
  const leftFv = pair.left === CONTINUATION ? null : pair.left;
  const rightFv = pair.right === CONTINUATION ? null : pair.right;
  const leftN = leftFv?.biomaterial_short_names?.length ?? 0;
  const rightN = rightFv?.biomaterial_short_names?.length ?? 0;
  if (leftN === 0 && rightN === 0) return null;
  // The middle column communicates the SAMPLE-COUNT axis only:
  // ``N ↔ M`` always, coloured by whether the counts agree. Label
  // drift is a different axis — it's communicated by the per-chip
  // diff rings on the side cells, NOT here. Per Paul 2026-06-15:
  // "the number 12 is agreeing in both. What happened to 12 ↔ 12?"
  // The earlier ``≈ 12`` / ``= 12`` glyphs collapsed the two axes
  // and read as "approximately 12 samples" which was wrong — the
  // count is exact, the drift is on the labels.
  if (leftN > 0 && rightN > 0) {
    const equal = leftN === rightN;
    return {
      text: `${leftN} ↔ ${rightN}`,
      cls: equal
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-amber-600 dark:text-amber-400",
      title: equal
        ? `${leftN} sample(s) on each side — partition agrees`
        : `${leftN} sample(s) left vs ${rightN} right — partition disagrees`,
    };
  }
  // One-sided: surface whichever count we have with a direction arrow.
  const n = leftN || rightN;
  const side = leftN > 0 ? "left" : "right";
  return {
    text: leftN > 0 ? `${n} →` : `← ${n}`,
    cls: "text-rose-600 dark:text-rose-400",
    title: `${n} sample(s) on the ${side} only`,
  };
}

function PairGridBody({
  pairs,
  termRenderer,
  renderPerFvAction,
}: {
  pairs: FactorComparisonPair[];
  termRenderer: FvTermRenderer;
  renderPerFvAction?: (
    pair: FactorComparisonPair,
    fvIndex: number,
  ) => ReactNode;
}): JSX.Element {
  return (
    <div
      className="relative grid items-stretch text-[11px]"
      style={{
        gridTemplateColumns: `[left] 1fr [mid] ${MID_COL_PX}px [right] 1fr [action] auto`,
        rowGap: 10,
        padding: 6,
      }}
    >
      {/* Per-row backdrop — sits behind each pair's cells so the row
          reads as one self-contained unit instead of running into
          its neighbours. Stronger ring + slightly darker fill per
          Paul 2026-06-16 ("They barely [separate] right now"). */}
      {pairs.map((_, ix) => (
        <div
          key={`backdrop-${ix}`}
          aria-hidden
          data-testid="factor-comparison-row-backdrop"
          style={{
            gridColumn: "1 / -1",
            gridRow: ix + 1,
            zIndex: 0,
          }}
          className="rounded bg-slate-200/50 ring-1 ring-slate-300 dark:bg-slate-800/60 dark:ring-slate-600/80"
        />
      ))}
      {pairs.map((pair, ix) => {
        const glyph = statusGlyph(pair.status);
        const perFvAction = renderPerFvAction?.(pair, ix) ?? null;
        const leftFv = pair.left === CONTINUATION ? null : pair.left;
        const rightFv = pair.right === CONTINUATION ? null : pair.right;
        const { leftKeys, rightKeys } = computeFvDiff(leftFv, rightFv);
        const mid = midCellRender(pair);
        const leftSpan = Math.max(1, pair.leftRowSpan ?? 1);
        const rightSpan = Math.max(1, pair.rightRowSpan ?? 1);
        const midSpan = Math.max(1, pair.midRowSpan ?? 1);
        const renderLeft = pair.left !== CONTINUATION;
        const renderRight = pair.right !== CONTINUATION;
        // Mid cell is suppressed only when BOTH sides are
        // continuations (umbrella above covers the entire row's
        // semantic).
        const renderMid =
          pair.left !== CONTINUATION || pair.right !== CONTINUATION;
        return (
          <div key={`pair-${ix}`} className="contents">
            {renderLeft ? (
              <div
                style={{
                  gridColumn: "left",
                  gridRow: `${ix + 1} / span ${leftSpan}`,
                  position: "relative",
                  zIndex: 1,
                }}
                className="min-w-0 px-2 py-2 self-center"
              >
                <FvCell
                  fv={leftFv}
                  termRenderer={termRenderer}
                  diffChips={leftKeys}
                />
              </div>
            ) : null}
            {renderMid ? (
            <span
              style={{
                gridColumn: "mid",
                gridRow: `${ix + 1} / span ${midSpan}`,
                position: "relative",
                zIndex: 1,
              }}
              className={
                "select-none text-center px-1 py-2 self-center font-semibold text-[13px] whitespace-nowrap " +
                (mid ? mid.cls : glyph?.cls ?? "text-transparent")
              }
              title={mid ? mid.title : glyph?.title ?? undefined}
              aria-label={pair.status ?? undefined}
            >
              {mid ? mid.text : glyph?.ch ?? " "}
            </span>
            ) : null}
            {renderRight ? (
              <div
                style={{
                  gridColumn: "right",
                  gridRow: `${ix + 1} / span ${rightSpan}`,
                  position: "relative",
                  zIndex: 1,
                }}
                className="min-w-0 px-2 py-2 self-center"
              >
                <FvCell
                  fv={rightFv}
                  termRenderer={termRenderer}
                  diffChips={rightKeys}
                />
              </div>
            ) : null}
            <div
              style={{ gridColumn: "action", gridRow: ix + 1, position: "relative", zIndex: 1 }}
              className="px-2 py-2 flex items-baseline justify-end gap-1.5"
            >
              {perFvAction}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Re-exports — the pairing helper + FV-shape contract live here so
// callers don't have to reach back into ComparisonFactorCard for them.
// ---------------------------------------------------------------------------

export { pairFvs } from "./pairFvs";
export {
  ContinuousStrip,
  continuousValuesFrom,
  type ContinuousStripValue,
} from "./ContinuousStrip";
