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
import type { ReactNode } from "react";
import { FvDisplayRow, type FvTermRenderer } from "@gemma/ontology";
import type { Factor } from "@/features/experiment/types";
import type { FactorValueProposal } from "@/api/types";

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
}: {
  fv: GridFv;
  fvIndex: number;
  termRenderer: FvTermRenderer;
}) {
  if (!fv) {
    return <em className="text-slate-400">(no FV)</em>;
  }
  // ``FvDisplayRow`` reads ``free_text_label`` + ``statements[*]`` +
  // ``biomaterial_short_names`` from the FV. ``indexLabel`` drives the
  // "FV N" prefix Paul asked for on both surfaces.
  return (
    <FvDisplayRow
      fv={fv}
      termRenderer={termRenderer}
      indexLabel={fvIndex + 1}
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
  ) : pairs.length === 0 ? (
    <div className="px-1.5 py-2 text-[11px] italic text-slate-400">
      (no factor values)
    </div>
  ) : (
    <div
      className="grid items-baseline gap-x-2 text-[11px]"
      style={{
        gridTemplateColumns: "[left] 1fr [glyph] auto [right] 1fr [action] auto",
      }}
    >
      {pairs.map((pair, ix) => {
        const glyph = statusGlyph(pair.status);
        const perFvAction = renderPerFvAction?.(pair, ix) ?? null;
        return (
          <div
            key={`pair-${ix}`}
            className="contents"
          >
            <div className="min-w-0 px-1.5 py-1 border-t border-slate-100 dark:border-slate-800">
              <FvCell fv={pair.left} fvIndex={ix} termRenderer={termRenderer} />
            </div>
            <span
              className={
                "select-none text-center px-1 py-1 border-t border-slate-100 dark:border-slate-800 " +
                (glyph?.cls ?? "text-transparent")
              }
              title={glyph?.title ?? undefined}
              aria-label={pair.status ?? undefined}
            >
              {glyph?.ch ?? " "}
            </span>
            <div className="min-w-0 px-1.5 py-1 border-t border-slate-100 dark:border-slate-800">
              <FvCell fv={pair.right} fvIndex={ix} termRenderer={termRenderer} />
            </div>
            <div className="px-1.5 py-1 border-t border-slate-100 dark:border-slate-800 flex items-baseline justify-end gap-1.5">
              {perFvAction}
            </div>
          </div>
        );
      })}
    </div>
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

// ---------------------------------------------------------------------------
// Re-exports — the pairing helper + FV-shape contract live here so
// callers don't have to reach back into ComparisonFactorCard for them.
// ---------------------------------------------------------------------------

export { pairFvs } from "./pairFvs";
