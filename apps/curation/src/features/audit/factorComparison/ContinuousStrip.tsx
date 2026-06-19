/**
 * Two-sided rug plot for continuous-factor comparisons.
 *
 * Replaces the index-by-index FV pair list when either side of the
 * comparison declares ``factor_type === "continuous"``. The pair list
 * is wrong for continuous factors:
 *
 *   * Gemma stores per-measurement FVs (one per sample) — GSE9904 has
 *     40 FVs for age across 28 unique values; the agent's
 *     ``continuous_populator`` groups by value and emits 28 FVs. The
 *     pair list pairs them by index, so the live side has phantom
 *     "duplicate" rows the agent has no counterpart for.
 *   * Continuous-factor agreement is fundamentally a numeric range
 *     comparison, not a labelled-level comparison.
 *
 * The rug design: live values are tick marks hanging DOWN from a
 * top axis; agent values are tick marks pointing UP from a bottom
 * axis. Each tick is half the plot height, so when the two sides
 * carry the same value, the down-tick and up-tick meet in the
 * middle — visually forming a full vertical line through the plot.
 * A live-only value shows only the top half; an agent-only value
 * shows only the bottom. Matched / unmatched reads at a glance
 * with no overlap arithmetic in the curator's head.
 *
 * The plot is deliberately compact (~64px tall) and inline.
 */
import { useMemo } from "react";

export interface ContinuousStripValue {
  value: number;
  /** How many samples carry this value. Surfaces in tooltips. */
  n_samples: number;
}

export interface ContinuousStripProps {
  /** Numeric values present on the left (baseline) side. */
  left: ContinuousStripValue[];
  /** Numeric values present on the right (comparator) side. */
  right: ContinuousStripValue[];
  /** Optional column labels — surfaced in the summary line below the
   *  plot. The plot itself uses fixed short "live"/"agent" lane
   *  labels because the column headers can be arbitrarily long
   *  (``"agent original proposal"``) and the gutter has no business
   *  stretching to fit them. */
  leftLabel?: string;
  rightLabel?: string;
}

/** Pixel layout — a touch larger than the strip we had before so
 *  the rug ticks have room to breathe. Lane labels live OUTSIDE the
 *  SVG in a flex gutter so the plot can use its full width. */
const W = 320;
const H = 64; // plot height (top axis to bottom axis)
const PAD_X = 6;
const PAD_TOP = 4;
const PAD_BOTTOM = 14; // room for the min/max x-axis tick labels
const PLOT_W = W - PAD_X * 2;
const Y_TOP = PAD_TOP;
const Y_BOTTOM = H - PAD_BOTTOM;
// Each tick is exactly half the plot interior so matched ticks meet
// in the middle without overlap; tiny ``MEET_GAP`` keeps the two
// strokes from blurring into a single line — they kiss but stay
// visually distinct.
const PLOT_INTERIOR = Y_BOTTOM - Y_TOP;
const MEET_GAP = 1;
const TICK_LEN = PLOT_INTERIOR / 2 - MEET_GAP / 2;

function _axisFor(left: ContinuousStripValue[], right: ContinuousStripValue[]):
  | { lo: number; hi: number; span: number }
  | null {
  const all = [...left, ...right].map((v) => v.value).filter(
    (v) => Number.isFinite(v),
  );
  if (all.length === 0) return null;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  if (lo === hi) {
    return { lo: lo - 1, hi: hi + 1, span: 2 };
  }
  return { lo, hi, span: hi - lo };
}

function _xFor(v: number, axis: { lo: number; span: number }): number {
  return PAD_X + ((v - axis.lo) / axis.span) * PLOT_W;
}

/** Format a number for tooltip + tick labels. */
function _fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v)) return String(v);
  return v.toPrecision(3);
}

export function ContinuousStrip({
  left,
  right,
  leftLabel = "current",
  rightLabel = "agent",
}: ContinuousStripProps): JSX.Element {
  const axis = useMemo(() => _axisFor(left, right), [left, right]);

  if (!axis) {
    return (
      <div className="px-1.5 py-2 text-[11px] italic text-slate-500 dark:text-slate-400">
        (continuous factor — no numeric values to plot)
      </div>
    );
  }

  // Exact numeric-equality match (Gemma stores measurements as
  // strings; we parse to float, so 17.0 === 17.0). Colors switch on
  // match so the curator can read agreement at a glance — matched
  // ticks render emerald on both sides, unmatched stay sky (live) /
  // amber (agent).
  const leftSet = new Set(left.map((v) => v.value));
  const rightSet = new Set(right.map((v) => v.value));
  const nMatched = right.filter((v) => leftSet.has(v.value)).length;

  return (
    <div className="px-1.5 py-1.5 text-[10px] text-slate-600 dark:text-slate-300">
      <div className="flex items-start gap-2">
        {/* Lane labels — fixed short, sized to align with the top and
            bottom rug axes inside the SVG. */}
        <div
          className="flex flex-col text-[9px] uppercase tracking-wide text-slate-500 dark:text-slate-400 flex-shrink-0"
          style={{ height: H, width: 30, position: "relative" }}
        >
          <span style={{ position: "absolute", top: Y_TOP - 2, left: 0 }}>
            current
          </span>
          <span
            style={{ position: "absolute", top: Y_BOTTOM - 6, left: 0 }}
          >
            agent
          </span>
        </div>
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="overflow-visible"
          role="img"
          aria-label={`continuous-factor agreement rug: ${left.length} ${leftLabel} values, ${right.length} ${rightLabel} values, ${nMatched} matched`}
        >
          {/* Top axis (live side). */}
          <line
            x1={PAD_X}
            x2={PAD_X + PLOT_W}
            y1={Y_TOP}
            y2={Y_TOP}
            className="stroke-slate-300 dark:stroke-slate-600"
            strokeWidth={1}
          />
          {/* Bottom axis (agent side). */}
          <line
            x1={PAD_X}
            x2={PAD_X + PLOT_W}
            y1={Y_BOTTOM}
            y2={Y_BOTTOM}
            className="stroke-slate-300 dark:stroke-slate-600"
            strokeWidth={1}
          />
          {/* Current rug — ticks hang DOWN from the top axis. Colour
              is fixed (Wong/Okabe blue) regardless of match status;
              the match signal is geometric (top tick + bottom tick
              meet in the middle) rather than chromatic, so the
              palette stays colour-blind friendly. */}
          {left.map((v, i) => {
            const cx = _xFor(v.value, axis);
            const matched = rightSet.has(v.value);
            return (
              <line
                key={`l-${i}`}
                x1={cx}
                x2={cx}
                y1={Y_TOP}
                y2={Y_TOP + TICK_LEN}
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeOpacity={0.9}
                className="stroke-sky-700 dark:stroke-sky-400"
              >
                <title>{`${leftLabel}: ${_fmt(v.value)}${v.n_samples > 1 ? ` (n=${v.n_samples})` : ""}${matched ? " — match" : ""}`}</title>
              </line>
            );
          })}
          {/* Agent rug — ticks point UP from the bottom axis. Wong/
              Okabe orange — maximally separable from the current
              side's blue across all common CVD types. */}
          {right.map((v, i) => {
            const cx = _xFor(v.value, axis);
            const matched = leftSet.has(v.value);
            return (
              <line
                key={`r-${i}`}
                x1={cx}
                x2={cx}
                y1={Y_BOTTOM}
                y2={Y_BOTTOM - TICK_LEN}
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeOpacity={0.9}
                className="stroke-amber-500 dark:stroke-amber-400"
              >
                <title>{`${rightLabel}: ${_fmt(v.value)}${v.n_samples > 1 ? ` (n=${v.n_samples})` : ""}${matched ? " — match" : " — no current counterpart"}`}</title>
              </line>
            );
          })}
          {/* x-axis min / max tick labels. */}
          <text
            x={PAD_X}
            y={H - 2}
            className="fill-slate-400 dark:fill-slate-500"
            fontSize={9}
            fontFamily="monospace"
            textAnchor="start"
          >
            {_fmt(axis.lo)}
          </text>
          <text
            x={PAD_X + PLOT_W}
            y={H - 2}
            className="fill-slate-400 dark:fill-slate-500"
            fontSize={9}
            fontFamily="monospace"
            textAnchor="end"
          >
            {_fmt(axis.hi)}
          </text>
        </svg>
      </div>
      {/* Compact summary line: counts on each side + match count. */}
      <div className="flex items-baseline gap-2 mt-1 text-[10px] text-slate-500 dark:text-slate-400">
        <span>
          {leftLabel}:{" "}
          <strong className="font-semibold text-slate-700 dark:text-slate-200">
            {left.length}
          </strong>{" "}
          values
        </span>
        <span>·</span>
        <span>
          {rightLabel}:{" "}
          <strong className="font-semibold text-slate-700 dark:text-slate-200">
            {right.length}
          </strong>
        </span>
        <span>·</span>
        <span>
          matched:{" "}
          <strong className="font-semibold text-emerald-600 dark:text-emerald-400">
            {nMatched}
          </strong>{" "}
          / {right.length}
        </span>
      </div>
    </div>
  );
}

/** Extract numeric values from a factor-like object's FV list.
 *
 *  Preference order for the numeric: ``numeric_value`` field (the
 *  agent's continuous_populator output), then ``measurement.value``
 *  (real Gemma's continuous FV shape), then ``free_text_label``
 *  parsed as a number.
 *
 *  Returns one row per FV — preserves Gemma's per-measurement
 *  multiplicity. Each row's ``n_samples`` falls back from the FV's
 *  ``biomaterial_short_names.length`` to 1. */
export function continuousValuesFrom(
  factorValues: ReadonlyArray<{
    numeric_value?: number | string | null;
    measurement?: { value?: string | null } | null;
    free_text_label?: string | null;
    biomaterial_short_names?: ReadonlyArray<string> | null;
  }> | null | undefined,
): ContinuousStripValue[] {
  if (!factorValues) return [];
  const out: ContinuousStripValue[] = [];
  for (const fv of factorValues) {
    let v: number | null = null;
    const nv = fv.numeric_value;
    if (typeof nv === "number" && Number.isFinite(nv)) v = nv;
    else if (typeof nv === "string" && nv.trim()) {
      const parsed = Number(nv);
      if (Number.isFinite(parsed)) v = parsed;
    }
    if (v == null) {
      const mv = fv.measurement?.value;
      if (typeof mv === "string" && mv.trim()) {
        const parsed = Number(mv);
        if (Number.isFinite(parsed)) v = parsed;
      }
    }
    if (v == null) {
      const lbl = (fv.free_text_label ?? "").trim();
      const m = /^(-?\d+(?:\.\d+)?)\b/.exec(lbl);
      if (m) {
        const parsed = Number(m[1]);
        if (Number.isFinite(parsed)) v = parsed;
      }
    }
    if (v == null) continue;
    out.push({
      value: v,
      n_samples: fv.biomaterial_short_names?.length ?? 1,
    });
  }
  return out;
}
