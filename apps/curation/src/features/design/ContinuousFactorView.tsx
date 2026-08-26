import type { Factor } from "@/features/experiment/types";
import { InlineText } from "@/components/ui/InlineText";

/**
 * Read-side view for a continuous factor. Continuous factors carry
 * per-sample measurements (age, weight, dose, time post infection,
 * …) rather than a discrete partition of FVs, so the categorical
 * FactorValueList rendering — one editable card per FV with statement
 * pickers and a "set baseline" affordance — is the wrong shape:
 * there's nothing to baseline-pick, every "FV" is a single sample,
 * and the curator wants to see the *distribution* not edit row-by-row.
 *
 * What this shows instead:
 *   - A numeric summary strip (n, min, max, mean, median).
 *   - A horizontal SVG strip plot — one dot per sample, x-positioned
 *     by value, jittered vertically so overlapping points stay
 *     visible. No external chart lib; raw SVG keeps the bundle thin.
 *   - A small list of out-of-band values (non-numeric measurements
 *     that survived the import) so the curator can spot data
 *     hygiene issues — e.g. ``"young"`` slipping into an ``age``
 *     column.
 *
 * Editing of individual measurements still happens on the Sample
 * tab, where the per-sample characteristic is the real source of
 * truth. The Design tab's job for continuous factors is overview +
 * sanity-check, not bulk editing.
 *
 * The factor *name* is the exception: the per-measurement FVs aren't
 * meaningfully renameable (each is one sample's reading), but the
 * factor itself must be renameable here, not only via the left-hand
 * FactorList table — a curator looking at this panel couldn't find a
 * way to rename the factor, because the name was static here.
 * ``onNameChange`` wires the same inline editor the FactorList row
 * uses; when omitted (or in review mode, which ``InlineText``
 * self-gates), the name renders read-only.
 */
export function ContinuousFactorView({
  factor,
  onNameChange,
}: {
  factor: Factor;
  onNameChange?: (name: string) => void;
}) {
  // One measurement per FV (we promote BM characteristics 1:1 in
  // ``addContinuousFactorFromCharacteristic``). Prefer ``numeric_value``
  // (the canonical scalar populated by the agents-side continuous-
  // populator from Gemma's ``measurement.value``) and fall back to
  // parsing ``free_text_label`` for FVs created in-UI before the
  // populator landed. ``free_text_label`` itself may be a human
  // rendering like "86 years" or "0.5 mg/ml" — keep it as the
  // display string.
  const points = factor.factor_values
    .map((fv) => {
      const raw = (fv.free_text_label || "").trim();
      let value: number | null = null;
      if (typeof fv.numeric_value === "number" && Number.isFinite(fv.numeric_value)) {
        value = fv.numeric_value;
      } else {
        const n = Number(raw);
        if (Number.isFinite(n)) value = n;
      }
      return {
        raw,
        value,
        samples: fv.biomaterial_short_names,
      };
    })
    .filter((p) => p.raw.length > 0 || p.value != null);
  const numeric = points.filter(
    (p): p is typeof p & { value: number } => p.value != null,
  );
  const nonNumeric = points.filter((p) => p.value == null);

  if (points.length === 0) {
    return (
      <div className="card p-3 text-sm text-slate-500">
        <span className="font-semibold text-slate-700">{factor.name}</span> —
        continuous factor, no measurements yet. Use the "promote to
        factor" affordance on a numeric biomaterial characteristic to
        populate.
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-baseline gap-3 px-3 py-2 border-b border-slate-200 flex-wrap">
        <span className="section-h">
          Continuous factor:{" "}
          {onNameChange ? (
            <InlineText
              value={factor.name}
              placeholder="factor name"
              onCommit={onNameChange}
              className="text-slate-900 normal-case font-semibold"
            />
          ) : (
            <span className="text-slate-900 normal-case font-semibold">
              {factor.name}
            </span>
          )}
        </span>
        <span className="text-xs text-slate-400">
          {factor.factor_values.length} measurement
          {factor.factor_values.length === 1 ? "" : "s"}
          {nonNumeric.length > 0
            ? ` · ${nonNumeric.length} non-numeric`
            : ""}
        </span>
      </div>
      <div className="px-3 py-3 space-y-3">
        <NumericSummary values={numeric.map((p) => p.value)} />
        {numeric.length > 0 ? (
          <StripPlot
            points={numeric.map((p) => ({
              value: p.value,
              label: p.raw,
              samples: p.samples,
            }))}
          />
        ) : (
          <div className="text-xs text-slate-500 italic">
            No numeric measurements to plot — every value parses as
            non-numeric. Check the source characteristic.
          </div>
        )}
        {nonNumeric.length > 0 ? (
          <NonNumericList items={nonNumeric.map((p) => ({ raw: p.raw, samples: p.samples }))} />
        ) : null}
      </div>
    </div>
  );
}

/** n / min / max / mean / median across the numeric values. Empty
 *  input renders an "—" placeholder line so the layout doesn't jump
 *  when the whole cohort is non-numeric. */
function NumericSummary({ values }: { values: number[] }) {
  if (values.length === 0) {
    return (
      <div className="text-xs text-slate-500 italic">
        No numeric values — summary unavailable.
      </div>
    );
  }
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const median =
    sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return (
    <div className="flex items-baseline gap-4 text-xs text-slate-700 flex-wrap">
      <Stat label="n" value={values.length} />
      <Stat label="min" value={fmt(min)} />
      <Stat label="max" value={fmt(max)} />
      <Stat label="mean" value={fmt(mean)} />
      <Stat label="median" value={fmt(median)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-[10px] uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className="font-mono font-medium text-slate-800">{value}</span>
    </span>
  );
}

/** Format a numeric stat for display. Whole-numberish values render
 *  without trailing zeros; small / fractional values keep one
 *  decimal so we don't lose information for things like dose. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  // Cap at 3 sig figs to keep the strip clean.
  return n.toPrecision(3).replace(/\.?0+$/, "");
}

/** Histogram: bars showing how many samples fall in each value bin.
 *  Reads more clearly than a strip plot for continuous measurements
 *  — a curator wants to see the *shape* of the distribution (skew,
 *  modes, gaps) without having to count overlapping dots.
 *
 *  Bin strategy: low-cardinality data (≤15 distinct values, common
 *  for integer-coded measurements like time-points or doses) renders
 *  one bar per distinct value with the value as the x-tick — the
 *  cleanest answer when the data is naturally discrete. Otherwise
 *  ~2·sqrt(n) equal-width bins, floored at 15 and capped at 40.
 *
 *  The floor is the point. Plain sqrt(n) gave 7 bins for a 40-sample
 *  factor, and `age` on a real dataset (n=40, 17–743, four distinct
 *  values) rendered as four fat bars with three empty gaps — a shape
 *  that reads as "the data clusters into four groups" when what it
 *  actually says is "the bins are too wide to tell you anything".
 *
 *  More bins make a sparse factor spikier rather than smoother, which
 *  is why the RUG underneath matters more than the bars do: it shows
 *  where the measurements actually are, with no binning artifact at
 *  all. Paul, 2026-08-25: a rug plot of values is fine for most uses.
 *
 *  🛑 The rug is drawn ONLY in binned mode. There the x-axis is linear
 *  in value (min … mid … max), so a tick at a value's position means
 *  something. Discrete mode lays bars out by INDEX with one label per
 *  distinct value — a categorical axis — so a value-positioned rug
 *  under it would point at the wrong bars.
 */
/**
 * How many equal-width bins for `n` measurements.
 *
 * ~2·sqrt(n), floored at 15 and capped at 40. Plain sqrt(n) — the rule
 * this replaces — gave **7** bins for a 40-sample factor, and `age`
 * (n=40, 17–743, four distinct values) came out as four fat bars with
 * three empty gaps. That reads as "the data clusters into four groups"
 * when it actually says "the bins are too wide to tell you anything".
 *
 * The floor matters more than the multiplier: it is what stops a small
 * n from producing a handful of enormous buckets. The cap stops a large
 * one from producing bars too thin to see.
 *
 * Exported for test.
 */
export function binCountFor(n: number): number {
  return Math.min(40, Math.max(15, Math.ceil(2 * Math.sqrt(n))));
}

function StripPlot({
  points,
}: {
  points: { value: number; label?: string; samples: string[] }[];
}) {
  const W = 600;
  const H = 156; // 140 + the rug band, so the bars keep their height
  const padX = 32;
  const padTop = 12;
  const padBottom = 44; // axis + rug + tick labels + x-axis caption
  /** Height of the rug band under the axis line. Tall enough to read
   *  as a band of its own rather than fringe on the axis — at 6px the
   *  ticks were easy to mistake for axis decoration. */
  const rugH = 12;
  const innerW = W - 2 * padX;
  const innerH = H - padTop - padBottom;

  const xs = points.map((p) => p.value);
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const span = max - min || 1;

  // Distinct values — drives the discrete-vs-binned branch below.
  const distinct = Array.from(new Set(xs)).sort((a, b) => a - b);
  const useDiscreteBins = distinct.length <= 15;

  type Bin = {
    lo: number;
    hi: number;
    mid: number;
    count: number;
    label: string;
    /** Human rendering for the discrete-bin tooltip — picks the
     *  first non-numeric ``free_text_label`` among points in the
     *  bin (e.g. "86 years"). Empty when every point's label is
     *  just the bare number. */
    humanLabel: string;
  };
  const bins: Bin[] = [];
  if (useDiscreteBins) {
    for (const v of distinct) {
      const inBin = points.filter((p) => p.value === v);
      const humanLabel =
        inBin
          .map((p) => (p.label || "").trim())
          .find((s) => s && s !== fmt(v)) || "";
      bins.push({
        lo: v,
        hi: v,
        mid: v,
        count: inBin.length,
        label: fmt(v),
        humanLabel,
      });
    }
  } else {
    const n = binCountFor(xs.length);
    const w = span / n;
    for (let i = 0; i < n; i++) {
      const lo = min + i * w;
      const hi = i === n - 1 ? max : lo + w;
      bins.push({ lo, hi, mid: (lo + hi) / 2, count: 0, label: "", humanLabel: "" });
    }
    for (const v of xs) {
      // Right edge of last bin is inclusive so the max value lands
      // in the last bucket rather than overflowing past the end.
      let idx = Math.floor(((v - min) / span) * n);
      if (idx >= n) idx = n - 1;
      if (idx < 0) idx = 0;
      bins[idx].count++;
    }
  }

  const maxCount = Math.max(1, ...bins.map((b) => b.count));

  // Bar layout: equal-width columns across the inner area.
  const barW = innerW / bins.length;
  const barInset = useDiscreteBins
    ? Math.min(8, barW * 0.2)
    : 1;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-[680px]"
        role="img"
        aria-label="Histogram of continuous-factor measurements"
      >
        {/* Y-axis count line. */}
        <line
          x1={padX}
          x2={padX}
          y1={padTop}
          y2={H - padBottom}
          stroke="rgb(203 213 225)"
          strokeWidth={1}
        />
        {/* Y-axis max-count tick label. */}
        <text
          x={padX - 4}
          y={padTop + 8}
          fontSize={9}
          textAnchor="end"
          fill="rgb(100 116 139)"
        >
          {maxCount}
        </text>
        <text
          x={padX - 4}
          y={H - padBottom - 1}
          fontSize={9}
          textAnchor="end"
          fill="rgb(100 116 139)"
        >
          0
        </text>
        {/* X-axis line. */}
        <line
          x1={padX}
          x2={W - padX}
          y1={H - padBottom}
          y2={H - padBottom}
          stroke="rgb(148 163 184)"
          strokeWidth={1}
        />
        {/* Bars. */}
        {bins.map((b, i) => {
          const x = padX + i * barW + barInset;
          const w = Math.max(1, barW - 2 * barInset);
          const h = (b.count / maxCount) * innerH;
          const y = H - padBottom - h;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill="rgb(59 130 246 / 0.55)"
                stroke="rgb(29 78 216)"
                strokeWidth={0.6}
              >
                <title>
                  {useDiscreteBins
                    ? `${b.humanLabel || b.label}: ${b.count} sample${b.count === 1 ? "" : "s"}`
                    : `${fmt(b.lo)}–${fmt(b.hi)}: ${b.count} sample${b.count === 1 ? "" : "s"}`}
                </title>
              </rect>
              {/* Per-bar count label only when there's room — keeps
                  the chart from looking spammed at high cardinality. */}
              {bins.length <= 12 && b.count > 0 ? (
                <text
                  x={x + w / 2}
                  y={y - 2}
                  fontSize={9}
                  textAnchor="middle"
                  fill="rgb(71 85 105)"
                >
                  {b.count}
                </text>
              ) : null}
            </g>
          );
        })}
        {/* Rug — one tick per measurement at its true position.
            Binned mode only (see the note on StripPlot): the axis is
            linear in value there, so a tick means what it looks like.

            Semi-transparent on purpose. Repeated values stack into a
            darker mark, so the four-values-×-10 case that prompted
            this reads as four solid ticks rather than four identical
            hairlines — the rug carries the multiplicity the bars were
            failing to convey. */}
        {!useDiscreteBins
          ? xs.map((v, i) => {
              const x = padX + ((v - min) / span) * innerW;
              return (
                <line
                  key={`rug-${i}`}
                  x1={x}
                  x2={x}
                  y1={H - padBottom + 1}
                  y2={H - padBottom + 1 + rugH}
                  stroke="rgb(29 78 216 / 0.6)"
                  strokeWidth={1.5}
                />
              );
            })
          : null}
        {/* X-axis tick labels: discrete bins get one label per bar
            (capped); binned mode gets just min / mid / max. */}
        {useDiscreteBins ? (
          bins.map((b, i) => {
            // For up to ~12 bars label every one; thin out for more.
            const stride = bins.length <= 12 ? 1 : Math.ceil(bins.length / 8);
            if (i % stride !== 0 && i !== bins.length - 1) return null;
            const x = padX + i * barW + barW / 2;
            return (
              <text
                key={`xt-${i}`}
                x={x}
                y={H - padBottom + rugH + 12}
                fontSize={9}
                textAnchor="middle"
                fill="rgb(100 116 139)"
              >
                {b.label}
              </text>
            );
          })
        ) : (
          <>
            <text
              x={padX}
              y={H - padBottom + rugH + 12}
              fontSize={9}
              textAnchor="start"
              fill="rgb(100 116 139)"
            >
              {fmt(min)}
            </text>
            <text
              x={padX + innerW / 2}
              y={H - padBottom + rugH + 12}
              fontSize={9}
              textAnchor="middle"
              fill="rgb(100 116 139)"
            >
              {fmt((min + max) / 2)}
            </text>
            <text
              x={W - padX}
              y={H - padBottom + rugH + 12}
              fontSize={9}
              textAnchor="end"
              fill="rgb(100 116 139)"
            >
              {fmt(max)}
            </text>
          </>
        )}
        {/* Axis captions — orient the curator. */}
        <text
          x={padX + innerW / 2}
          y={H - 4}
          fontSize={9}
          textAnchor="middle"
          fill="rgb(100 116 139)"
        >
          measurement value
        </text>
        <text
          x={padX - 18}
          y={padTop + innerH / 2}
          fontSize={9}
          textAnchor="middle"
          fill="rgb(100 116 139)"
          transform={`rotate(-90 ${padX - 18} ${padTop + innerH / 2})`}
        >
          # samples
        </text>
      </svg>
    </div>
  );
}

function NonNumericList({
  items,
}: {
  items: { raw: string; samples: string[] }[];
}) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-amber-800 hover:text-amber-950">
        ⚠ {items.length} non-numeric measurement{items.length === 1 ? "" : "s"}{" "}
        — show
      </summary>
      <ul className="mt-1 ml-4 list-disc text-slate-700 space-y-0.5">
        {items.map((it, i) => (
          <li key={i}>
            <span className="font-mono">{it.raw}</span>
            <span className="text-slate-500 ml-2">
              ({it.samples.join(", ") || "(no sample)"})
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
