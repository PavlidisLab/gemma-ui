/**
 * Column-spanning SVG sankey for the FactorComparisonGrid's middle
 * column. Replaces the single-char ``= / ≈ / + / −`` glyph between
 * paired FVs with width-encoded bezier ribbons showing which samples
 * map between the two sides.
 *
 * Why: per Paul 2026-06-15 — "the SAMPLE matchup should be shown
 * sankey style between the pairs, so that it's easy to [see] the
 * partition equivalence (or not)." A perfectly equivalent partition
 * reads as parallel ribbons; drift reads as crossings.
 *
 * Each ribbon = one (left FV i, right FV j) cell of the cross-overlap
 * table. The ribbon's thickness encodes the size of
 * |left_i.biomaterial_short_names ∩ right_j.biomaterial_short_names|;
 * its colour distinguishes same-row (emerald — exact pairing) from
 * cross-row (amber — drift).
 *
 * Layout: the SVG receives row-center y-coordinates measured by the
 * grid wrapper via refs (so this component stays render-only and
 * doesn't need to know about row heights). Ribbons fan out vertically
 * inside each row when a single FV's samples split across multiple
 * counterparts on the other side.
 *
 * Degrades gracefully: if either side reports zero
 * biomaterial_short_names (the FV ships without sample membership),
 * the corresponding row is skipped and the caller can fall back to
 * the legacy status glyph for that pair via the ``fallbackGlyphRows``
 * set.
 */

import type { GridFv } from "./FactorComparisonGrid";

export interface SankeyRowMetric {
  /** y-coordinate (in container pixels) of the row's vertical centre. */
  centerY: number;
  /** Row's full height in container pixels. Used as the upper bound
   *  for ribbon thickness so a ribbon never overflows its row. */
  height: number;
}

interface Ribbon {
  /** Left row index. */
  i: number;
  /** Right row index. */
  j: number;
  /** Samples shared between left_i and right_j. */
  shared: number;
  /** Total samples on left_i — denominator for the left-edge fraction. */
  leftTotal: number;
  /** Total samples on right_j — denominator for the right-edge fraction. */
  rightTotal: number;
}

export interface SamplePartitionSankeyProps {
  /** Left and right FVs (one per row, same length, paired by the
   *  grid's pairing logic). Either side can be ``null`` for
   *  left_only / right_only rows; those don't get ribbons. */
  leftFvs: ReadonlyArray<GridFv>;
  rightFvs: ReadonlyArray<GridFv>;
  /** Measured row geometry (one per pair). Same length as
   *  ``leftFvs`` / ``rightFvs``. */
  leftMetrics: ReadonlyArray<SankeyRowMetric>;
  rightMetrics: ReadonlyArray<SankeyRowMetric>;
  /** SVG width — the column the sankey occupies. */
  width: number;
  /** SVG height — the full pair-list container's pixel height. */
  height: number;
}

/** Stable identity for a sample on the wire. The wire ships short
 *  names (e.g. ``GSM_3017391``), which already work as the identity
 *  string — no normalisation needed. Trim defensively. */
function sampleKey(s: string): string {
  return s.trim();
}

/** Build the ribbon list — one entry per non-zero overlap in the
 *  left × right cross-table. Ribbons are sorted "main diagonal
 *  first, then by shared count descending" so the curator's eye
 *  follows the dominant pairing before the drift. */
function buildRibbons(
  left: ReadonlyArray<GridFv>,
  right: ReadonlyArray<GridFv>,
): Ribbon[] {
  const leftSets: Array<Set<string>> = left.map((fv) =>
    new Set((fv?.biomaterial_short_names ?? []).map(sampleKey)),
  );
  const rightSets: Array<Set<string>> = right.map((fv) =>
    new Set((fv?.biomaterial_short_names ?? []).map(sampleKey)),
  );
  const ribbons: Ribbon[] = [];
  for (let i = 0; i < left.length; i++) {
    const L = leftSets[i];
    if (L.size === 0) continue;
    for (let j = 0; j < right.length; j++) {
      const R = rightSets[j];
      if (R.size === 0) continue;
      let shared = 0;
      for (const s of L) if (R.has(s)) shared++;
      if (shared === 0) continue;
      ribbons.push({
        i,
        j,
        shared,
        leftTotal: L.size,
        rightTotal: R.size,
      });
    }
  }
  ribbons.sort((a, b) => {
    const aDiag = a.i === a.j ? 0 : 1;
    const bDiag = b.i === b.j ? 0 : 1;
    if (aDiag !== bDiag) return aDiag - bDiag;
    return b.shared - a.shared;
  });
  return ribbons;
}

/** Generate the SVG path for one ribbon. The ribbon is anchored at
 *  full thickness against each FV cell and pinches to a thin neck in
 *  the middle so it reads as a FLOW rather than a solid wall — even
 *  when shared == leftTotal == rightTotal (the exact-pairing case
 *  where the old constant-thickness ribbon rendered as a featureless
 *  block). Paul 2026-06-15: "we could make this nicer — it's just a
 *  big green block. […] make it narrow in the middle."
 *
 *  Each edge uses two cubic bezier segments that meet at the neck.
 *  Horizontal tangent at all three points (left anchor, neck, right
 *  anchor) makes the curve smoothly merge with each cell and round
 *  through the neck without a kink.
 *
 *  Neck thickness is a fraction of the thinner end (clamped to a
 *  small minimum) so a wide ribbon still pinches visibly. */
function ribbonPath(
  x0: number,
  x1: number,
  yL: number,
  yR: number,
  leftThickness: number,
  rightThickness: number,
): string {
  const lTop = yL - leftThickness / 2;
  const lBot = yL + leftThickness / 2;
  const rTop = yR - rightThickness / 2;
  const rBot = yR + rightThickness / 2;
  const xMid = (x0 + x1) / 2;
  const yMid = (yL + yR) / 2;
  // Neck thickness: ~35% of the thinner end, with a floor of 1.5px
  // so very thin ribbons still pinch perceptibly without vanishing.
  const neck = Math.max(1.5, Math.min(leftThickness, rightThickness) * 0.35);
  const nTop = yMid - neck / 2;
  const nBot = yMid + neck / 2;
  // Quarter-x control points keep horizontal tangents at each end
  // AND at the neck (incoming + outgoing). Result: smooth S-curve
  // from each cell into the neck, no visible kink at the pinch.
  const xQ1 = (x0 + xMid) / 2;
  const xQ2 = (xMid + x1) / 2;
  return (
    // Top edge: left anchor → neck → right anchor.
    `M ${x0} ${lTop} ` +
    `C ${xQ1} ${lTop}, ${xQ1} ${nTop}, ${xMid} ${nTop} ` +
    `C ${xQ2} ${nTop}, ${xQ2} ${rTop}, ${x1} ${rTop} ` +
    // Right cell wall.
    `L ${x1} ${rBot} ` +
    // Bottom edge: right anchor → neck → left anchor (reverse direction).
    `C ${xQ2} ${rBot}, ${xQ2} ${nBot}, ${xMid} ${nBot} ` +
    `C ${xQ1} ${nBot}, ${xQ1} ${lBot}, ${x0} ${lBot} ` +
    `Z`
  );
}

export function SamplePartitionSankey({
  leftFvs,
  rightFvs,
  leftMetrics,
  rightMetrics,
  width,
  height,
}: SamplePartitionSankeyProps): JSX.Element | null {
  if (leftFvs.length === 0 || rightFvs.length === 0) return null;
  // Trim metric arrays defensively in case the measurement pass ran
  // before the render settled. Fewer metrics than FVs → skip the
  // un-measured rows; never crash on undefined.
  const ribbons = buildRibbons(leftFvs, rightFvs);
  if (ribbons.length === 0) return null;
  // Per-row remaining capacity — ribbons stack vertically inside each
  // row so multiple outgoing/incoming ribbons don't overlap. Tracked
  // as remaining height after each ribbon takes its slice.
  const leftRemaining = leftMetrics.map((m) => m.height * 0.85);
  const rightRemaining = rightMetrics.map((m) => m.height * 0.85);
  const leftCursor = leftMetrics.map((m) => m.centerY - (m.height * 0.85) / 2);
  const rightCursor = rightMetrics.map((m) => m.centerY - (m.height * 0.85) / 2);
  // Margin so the ribbon's edges visually land NEXT to (not on top
  // of) the FV cells.
  const x0 = 2;
  const x1 = Math.max(8, width - 2);
  const paths: JSX.Element[] = [];
  for (let k = 0; k < ribbons.length; k++) {
    const r = ribbons[k];
    const lm = leftMetrics[r.i];
    const rm = rightMetrics[r.j];
    if (!lm || !rm) continue;
    const leftFraction = r.shared / r.leftTotal;
    const rightFraction = r.shared / r.rightTotal;
    // Clamp thickness to the row's available capacity. With multiple
    // ribbons sharing a row, each gets a proportional slice of the
    // remaining height so they stack without overlap.
    const leftThickness = Math.max(
      1.5,
      Math.min(leftRemaining[r.i], lm.height * leftFraction * 0.85),
    );
    const rightThickness = Math.max(
      1.5,
      Math.min(rightRemaining[r.j], rm.height * rightFraction * 0.85),
    );
    // Position cursor → ribbon centred on the next free slot in the row.
    const yL = leftCursor[r.i] + leftThickness / 2;
    const yR = rightCursor[r.j] + rightThickness / 2;
    leftCursor[r.i] += leftThickness;
    rightCursor[r.j] += rightThickness;
    leftRemaining[r.i] -= leftThickness;
    rightRemaining[r.j] -= rightThickness;
    const isDiagonal = r.i === r.j;
    // Palette: emerald for same-row (the intended pairing), amber for
    // any cross-row ribbon (samples drifted to a different partition).
    const fill = isDiagonal
      ? "rgba(16, 185, 129, 0.55)"
      : "rgba(245, 158, 11, 0.55)";
    const stroke = isDiagonal
      ? "rgba(5, 150, 105, 0.85)"
      : "rgba(217, 119, 6, 0.85)";
    const title =
      isDiagonal
        ? `${r.shared} of ${r.leftTotal} sample(s) stay in FV ${r.i + 1}`
        : `${r.shared} sample(s) drift from FV ${r.i + 1} → FV ${r.j + 1}`;
    paths.push(
      <path
        key={`ribbon-${k}-${r.i}-${r.j}`}
        d={ribbonPath(x0, x1, yL, yR, leftThickness, rightThickness)}
        fill={fill}
        stroke={stroke}
        strokeWidth={0.5}
      >
        <title>{title}</title>
      </path>,
    );
  }
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
      style={{ pointerEvents: "auto" }}
    >
      {paths}
    </svg>
  );
}
