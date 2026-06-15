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
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { FvDisplayRow, type FvTermRenderer } from "@gemma/ontology";
import type { Factor } from "@/features/experiment/types";
import type { FactorValueProposal } from "@/api/types";
import {
  ContinuousStrip,
  type ContinuousStripValue,
} from "./ContinuousStrip";
import { computeFvDiff } from "./fvDiff";
import {
  SamplePartitionSankey,
  type SankeyRowMetric,
} from "./SamplePartitionSankey";

/** One FV on either side of the comparison. ``Factor.factor_values``
 *  (gold) and ``FactorProposal.factor_values`` (agent) both satisfy
 *  this contract; the grid doesn't care which it's looking at. */
export type GridFv =
  | Factor["factor_values"][number]
  | FactorValueProposal
  | null;

/** One paired row in the grid. The pairing decision is opaque to the
 *  grid — caller supplies ``status`` so the glyph between the cells
 *  reads correctly. */
export interface FactorComparisonPair {
  left: GridFv;
  right: GridFv;
  /** Quick visual indicator between the cells:
   *   - ``"same"``       — labels match
   *   - ``"drift"``      — paired by sample partition; labels differ
   *   - ``"left_only"``  — baseline-only (no comparator counterpart)
   *   - ``"right_only"`` — comparator-only (no baseline counterpart)
   *   - ``null``         — no glyph (suppress the column entirely)
   */
  status: "same" | "drift" | "left_only" | "right_only" | null;
}

export interface FactorComparisonHeaderSide {
  /** Column header label — "Current" / "Auditor said" / "Agent
   *  original proposal" / a chip-strip-driven curator name. */
  label: string;
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
  fvIndex,
  termRenderer,
  diffChips,
}: {
  fv: GridFv;
  fvIndex: number;
  termRenderer: FvTermRenderer;
  diffChips?: ReadonlySet<string>;
}) {
  if (!fv) {
    return <em className="text-slate-400">(no FV)</em>;
  }
  // ``FvDisplayRow`` reads ``free_text_label`` + ``statements[*]`` +
  // ``biomaterial_short_names`` from the FV. ``indexLabel`` drives the
  // "FV N" prefix Paul asked for on both surfaces. ``diffChips`` is
  // the side-specific differing-chip set computed by ``computeFvDiff``
  // — the row tags matching chips with ``diff: true`` and the caller's
  // term renderer rings them.
  return (
    <FvDisplayRow
      fv={fv}
      termRenderer={termRenderer}
      indexLabel={fvIndex + 1}
      diffChips={diffChips}
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
      <span className="text-[9px] uppercase tracking-wide text-slate-400 dark:text-slate-500 inline-flex items-baseline gap-1">
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
      <span className="text-[9px] uppercase tracking-wide text-slate-400 dark:text-slate-500 pl-2 border-l border-slate-200 dark:border-slate-700">
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

/** Inner pair-grid body. Renders the side-by-side FV rows AND a
 *  column-spanning sample-partition sankey through the middle column.
 *  Measures per-row geometry via refs so the sankey's ribbon
 *  endpoints land on the FV row centres regardless of statement
 *  count / wrap height.
 *
 *  Falls back to the per-row status glyph (= / ≈ / + / −) when the
 *  pair lacks sample-membership info (``biomaterial_short_names``
 *  empty on both sides) — the sankey can't draw a ribbon, but the
 *  curator still gets the per-row pairing hint. */
const SANKEY_COL_PX = 56;

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
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const leftRefs = useRef<Array<HTMLDivElement | null>>([]);
  const rightRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [leftMetrics, setLeftMetrics] = useState<SankeyRowMetric[]>([]);
  const [rightMetrics, setRightMetrics] = useState<SankeyRowMetric[]>([]);
  const [containerHeight, setContainerHeight] = useState<number>(0);

  useLayoutEffect(() => {
    function measure() {
      const wrap = wrapperRef.current;
      if (!wrap) return;
      const wrapTop = wrap.getBoundingClientRect().top;
      const nextLeft: SankeyRowMetric[] = [];
      const nextRight: SankeyRowMetric[] = [];
      for (let i = 0; i < pairs.length; i++) {
        const lr = leftRefs.current[i];
        const rr = rightRefs.current[i];
        if (lr) {
          const r = lr.getBoundingClientRect();
          nextLeft.push({
            centerY: r.top - wrapTop + r.height / 2,
            height: r.height,
          });
        } else {
          nextLeft.push({ centerY: 0, height: 0 });
        }
        if (rr) {
          const r = rr.getBoundingClientRect();
          nextRight.push({
            centerY: r.top - wrapTop + r.height / 2,
            height: r.height,
          });
        } else {
          nextRight.push({ centerY: 0, height: 0 });
        }
      }
      setLeftMetrics(nextLeft);
      setRightMetrics(nextRight);
      setContainerHeight(wrap.getBoundingClientRect().height);
    }
    measure();
    // Recompute on viewport / font-load / content-changes.
    const ro = new ResizeObserver(measure);
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    for (const el of leftRefs.current) if (el) ro.observe(el);
    for (const el of rightRefs.current) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [pairs]);

  const leftFvs = pairs.map((p) => p.left);
  const rightFvs = pairs.map((p) => p.right);
  // Whether the sankey can render — every pair must have at least
  // one side with sample membership. When ALL pairs lack samples on
  // both sides the SVG would have nothing to draw, so we fall back
  // to the per-row glyph entirely.
  const sankeyHasData = pairs.some(
    (p) =>
      (p.left?.biomaterial_short_names?.length ?? 0) > 0 &&
      (p.right?.biomaterial_short_names?.length ?? 0) > 0,
  );

  return (
    <div
      ref={wrapperRef}
      className="relative grid items-stretch text-[11px]"
      style={{
        gridTemplateColumns: `[left] 1fr [sankey] ${SANKEY_COL_PX}px [right] 1fr [action] auto`,
        rowGap: 6,
        padding: 4,
      }}
    >
      {/* Per-row backdrop — sits behind each pair's cells so the row
          reads as one self-contained unit instead of running into
          its neighbours. Paul 2026-06-15: "the fvs sort of run into
          each other - they should visually separate better - a
          small space + stronger tint of background or outline."
          Each backdrop spans all four columns at its gridRow and is
          z-indexed below the cell content + sankey SVG. */}
      {pairs.map((_, ix) => (
        <div
          key={`backdrop-${ix}`}
          aria-hidden
          style={{
            gridColumn: "1 / -1",
            gridRow: ix + 1,
            zIndex: 0,
          }}
          className="rounded bg-slate-100/60 dark:bg-slate-800/40 ring-1 ring-slate-200/70 dark:ring-slate-700/60"
        />
      ))}
      {/* Column-spanning sankey SVG. Sits in the dedicated middle
          column at gridRow 1 / -1 so it draws BEHIND the per-row
          glyphs (which we keep visible as a fallback per-row hint
          when the sankey can't render anything for the pair). */}
      {sankeyHasData && containerHeight > 0 ? (
        <div
          aria-hidden
          className="pointer-events-none"
          style={{
            gridColumn: "sankey",
            gridRow: `1 / span ${pairs.length}`,
            alignSelf: "stretch",
            justifySelf: "stretch",
            position: "relative",
            zIndex: 2,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "auto",
            }}
          >
            <SamplePartitionSankey
              leftFvs={leftFvs}
              rightFvs={rightFvs}
              leftMetrics={leftMetrics}
              rightMetrics={rightMetrics}
              width={SANKEY_COL_PX}
              height={containerHeight}
            />
          </div>
        </div>
      ) : null}
      {pairs.map((pair, ix) => {
        const glyph = statusGlyph(pair.status);
        const perFvAction = renderPerFvAction?.(pair, ix) ?? null;
        const { leftKeys, rightKeys } = computeFvDiff(pair.left, pair.right);
        // Per-row glyph stays as a fallback when this specific pair
        // can't be drawn by the sankey (one side missing sample
        // membership, OR the pair is left_only / right_only). When
        // the sankey covers the row, suppress the glyph so it
        // doesn't compete visually.
        const sankeyCoversRow =
          sankeyHasData &&
          (pair.left?.biomaterial_short_names?.length ?? 0) > 0 &&
          (pair.right?.biomaterial_short_names?.length ?? 0) > 0;
        return (
          <div key={`pair-${ix}`} className="contents">
            <div
              ref={(el) => {
                leftRefs.current[ix] = el;
              }}
              style={{ gridColumn: "left", gridRow: ix + 1, position: "relative", zIndex: 1 }}
              className="min-w-0 px-2 py-1.5"
            >
              <FvCell
                fv={pair.left}
                fvIndex={ix}
                termRenderer={termRenderer}
                diffChips={leftKeys}
              />
            </div>
            <span
              style={{ gridColumn: "sankey", gridRow: ix + 1, position: "relative", zIndex: 1 }}
              className={
                "select-none text-center px-1 py-1.5 " +
                (sankeyCoversRow ? "text-transparent" : glyph?.cls ?? "text-transparent")
              }
              title={sankeyCoversRow ? undefined : glyph?.title ?? undefined}
              aria-label={pair.status ?? undefined}
            >
              {sankeyCoversRow ? " " : glyph?.ch ?? " "}
            </span>
            <div
              ref={(el) => {
                rightRefs.current[ix] = el;
              }}
              style={{ gridColumn: "right", gridRow: ix + 1, position: "relative", zIndex: 1 }}
              className="min-w-0 px-2 py-1.5"
            >
              <FvCell
                fv={pair.right}
                fvIndex={ix}
                termRenderer={termRenderer}
                diffChips={rightKeys}
              />
            </div>
            <div
              style={{ gridColumn: "action", gridRow: ix + 1, position: "relative", zIndex: 1 }}
              className="px-2 py-1.5 flex items-baseline justify-end gap-1.5"
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
