import { OntologyTermChip } from "@/components/OntologyTermChip";
import { continuousFvNumeric } from "@/lib/continuousFv";
import type { ExperimentalFactorEntry } from "@/lib/types";

/**
 * Design-tab card for a continuous factor — ported from the curation
 * app's read-side view (``apps/curation/src/features/design/
 * ContinuousFactorView.tsx``). A scrollable list of one row per
 * distinct value (what the categorical ``FactorCard`` renders) is the
 * wrong shape for a measurement: there are no discrete "levels" to
 * browse, and 70+ rows of bare numbers tell a reader nothing about the
 * *distribution*. This shows instead:
 *
 *   - n / min / max / mean / median across the numeric values.
 *   - A histogram — one bar per distinct value when there are few
 *     (≤15), else binned — with a rug underneath showing every
 *     measurement's true position.
 *   - Out-of-band values (non-numeric measurements that survived
 *     import) so a reader can still spot data-hygiene issues.
 *
 * Unlike curation's version this is read-only (no rename affordance)
 * and weights every value by how many samples actually carry it —
 * ``sampleCountByFvId`` — rather than assuming one sample per
 * FactorValue, since Gemma's design endpoint shares one FV across
 * every sample with the same reading rather than minting a FV per
 * sample.
 */
export function ContinuousFactorCard({
  factor,
  nuisance = false,
  sampleCountByFvId,
}: {
  factor: ExperimentalFactorEntry;
  nuisance?: boolean;
  sampleCountByFvId: Map<number, number>;
}) {
  const categoryLabel = factor.category?.category ?? null;
  const categoryUri = factor.category?.categoryUri ?? null;

  const points = factor.values.map((v) => ({
    value: continuousFvNumeric(v),
    raw: (v.summary || v.value || `FV ${v.id}`).trim(),
    count: sampleCountByFvId.get(v.id) ?? 1,
  }));
  const numeric = points.filter(
    (p): p is typeof p & { value: number } => p.value != null,
  );
  const nonNumeric = points.filter((p) => p.value == null);
  const nSamples = points.reduce((s, p) => s + p.count, 0);

  return (
    <div
      className={
        "rounded-lg border " +
        (nuisance ? "border-slate-200 bg-slate-50/60" : "border-sky-300 bg-sky-50/60")
      }
    >
      <header
        className={
          "px-3 py-1.5 border-b flex items-baseline gap-2 flex-wrap " +
          (nuisance ? "border-slate-200" : "border-sky-300")
        }
      >
        <span className="text-sm font-semibold text-slate-800">
          {factor.name || categoryLabel || `Factor ${factor.id}`}
        </span>
        {categoryLabel ? (
          <OntologyTermChip uri={categoryUri}>{categoryLabel}</OntologyTermChip>
        ) : null}
        <span className="text-[11px] text-slate-500">
          continuous · {nSamples} sample{nSamples === 1 ? "" : "s"}
          {nonNumeric.length > 0 ? ` · ${nonNumeric.length} non-numeric` : ""}
        </span>
        {factor.description ? (
          <span
            className="text-[11px] text-slate-500 italic line-clamp-1"
            title={factor.description}
          >
            — {factor.description}
          </span>
        ) : null}
      </header>
      <div className="px-3 py-3 space-y-3">
        {numeric.length === 0 ? (
          <div className="text-xs text-slate-500 italic">
            No numeric measurements to plot — every value parses as
            non-numeric. Check the source characteristic.
          </div>
        ) : (
          <>
            <NumericSummary points={numeric} />
            <Histogram points={numeric} />
          </>
        )}
        {nonNumeric.length > 0 ? (
          <NonNumericList items={nonNumeric} />
        ) : null}
      </div>
    </div>
  );
}

type WeightedPoint = { value: number; count: number };

/** n / min / max / mean / median across the (count-weighted) values.
 *  Mean and median account for ``count`` — a value shared by 40
 *  samples must outweigh one shared by 1, not count as a single
 *  observation. */
function NumericSummary({ points }: { points: WeightedPoint[] }) {
  const n = points.reduce((s, p) => s + p.count, 0);
  const sortedByValue = [...points].sort((a, b) => a.value - b.value);
  const min = sortedByValue[0].value;
  const max = sortedByValue[sortedByValue.length - 1].value;
  const sum = points.reduce((s, p) => s + p.value * p.count, 0);
  const mean = sum / n;
  // Weighted median (nearest-rank): walk the sorted points, stop once
  // cumulative count reaches the midpoint rank.
  const mid = n / 2;
  let cum = 0;
  let median = sortedByValue[0].value;
  for (const p of sortedByValue) {
    cum += p.count;
    if (cum >= mid) {
      median = p.value;
      break;
    }
  }
  return (
    <div className="flex items-baseline gap-4 text-xs text-slate-700 flex-wrap">
      <Stat label="n" value={n} />
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
 *  without trailing zeros; fractional values keep 3 sig figs so the
 *  strip stays clean. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return n.toPrecision(3).replace(/\.?0+$/, "");
}

/** How many equal-width bins for `n` (count-weighted) measurements.
 *  ~2·sqrt(n), floored at 15 and capped at 40 — plain sqrt(n) produces
 *  bins too wide to show the shape of a small cohort. Exported for
 *  test. Ported from curation's ``ContinuousFactorView.binCountFor``. */
export function binCountFor(n: number): number {
  return Math.min(40, Math.max(15, Math.ceil(2 * Math.sqrt(n))));
}

function Histogram({ points }: { points: WeightedPoint[] }) {
  const W = 600;
  const H = 156;
  const padX = 32;
  const padTop = 12;
  const padBottom = 44;
  const rugH = 12;
  const innerW = W - 2 * padX;
  const innerH = H - padTop - padBottom;

  const n = points.reduce((s, p) => s + p.count, 0);
  const min = Math.min(...points.map((p) => p.value));
  const max = Math.max(...points.map((p) => p.value));
  const span = max - min || 1;

  // Distinct values (summing counts for points that coincide) drive
  // the discrete-vs-binned branch, same threshold as curation.
  const byValue = new Map<number, number>();
  for (const p of points) {
    byValue.set(p.value, (byValue.get(p.value) ?? 0) + p.count);
  }
  const distinct = [...byValue.keys()].sort((a, b) => a - b);
  const useDiscreteBins = distinct.length <= 15;

  type Bin = { lo: number; hi: number; mid: number; count: number; label: string };
  const bins: Bin[] = [];
  if (useDiscreteBins) {
    for (const v of distinct) {
      bins.push({ lo: v, hi: v, mid: v, count: byValue.get(v) ?? 0, label: fmt(v) });
    }
  } else {
    const nBins = binCountFor(n);
    const w = span / nBins;
    for (let i = 0; i < nBins; i++) {
      const lo = min + i * w;
      const hi = i === nBins - 1 ? max : lo + w;
      bins.push({ lo, hi, mid: (lo + hi) / 2, count: 0, label: "" });
    }
    for (const p of points) {
      let idx = Math.floor(((p.value - min) / span) * nBins);
      if (idx >= nBins) idx = nBins - 1;
      if (idx < 0) idx = 0;
      bins[idx].count += p.count;
    }
  }

  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  const barW = innerW / bins.length;
  const barInset = useDiscreteBins ? Math.min(8, barW * 0.2) : 1;

  // Rug ticks: one per sample (not per distinct value) so repeated
  // values stack into a visibly darker mark — binned mode only, where
  // the axis is linear in value and a tick position means something.
  const rugXs = useDiscreteBins
    ? []
    : points.flatMap((p) => Array(p.count).fill(p.value));

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-[680px]"
        role="img"
        aria-label="Histogram of continuous-factor measurements"
      >
        <line x1={padX} x2={padX} y1={padTop} y2={H - padBottom} stroke="rgb(203 213 225)" strokeWidth={1} />
        <text x={padX - 4} y={padTop + 8} fontSize={9} textAnchor="end" fill="rgb(100 116 139)">
          {maxCount}
        </text>
        <text x={padX - 4} y={H - padBottom - 1} fontSize={9} textAnchor="end" fill="rgb(100 116 139)">
          0
        </text>
        <line x1={padX} x2={W - padX} y1={H - padBottom} y2={H - padBottom} stroke="rgb(148 163 184)" strokeWidth={1} />
        {bins.map((b, i) => {
          const x = padX + i * barW + barInset;
          const w = Math.max(1, barW - 2 * barInset);
          const h = (b.count / maxCount) * innerH;
          const y = H - padBottom - h;
          return (
            <g key={i}>
              <rect x={x} y={y} width={w} height={h} fill="rgb(59 130 246 / 0.55)" stroke="rgb(29 78 216)" strokeWidth={0.6}>
                <title>
                  {useDiscreteBins
                    ? `${b.label}: ${b.count} sample${b.count === 1 ? "" : "s"}`
                    : `${fmt(b.lo)}–${fmt(b.hi)}: ${b.count} sample${b.count === 1 ? "" : "s"}`}
                </title>
              </rect>
              {bins.length <= 12 && b.count > 0 ? (
                <text x={x + w / 2} y={y - 2} fontSize={9} textAnchor="middle" fill="rgb(71 85 105)">
                  {b.count}
                </text>
              ) : null}
            </g>
          );
        })}
        {rugXs.map((v, i) => {
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
        })}
        {useDiscreteBins ? (
          bins.map((b, i) => {
            const stride = bins.length <= 12 ? 1 : Math.ceil(bins.length / 8);
            if (i % stride !== 0 && i !== bins.length - 1) return null;
            const x = padX + i * barW + barW / 2;
            return (
              <text key={`xt-${i}`} x={x} y={H - padBottom + rugH + 12} fontSize={9} textAnchor="middle" fill="rgb(100 116 139)">
                {b.label}
              </text>
            );
          })
        ) : (
          <>
            <text x={padX} y={H - padBottom + rugH + 12} fontSize={9} textAnchor="start" fill="rgb(100 116 139)">
              {fmt(min)}
            </text>
            <text x={padX + innerW / 2} y={H - padBottom + rugH + 12} fontSize={9} textAnchor="middle" fill="rgb(100 116 139)">
              {fmt((min + max) / 2)}
            </text>
            <text x={W - padX} y={H - padBottom + rugH + 12} fontSize={9} textAnchor="end" fill="rgb(100 116 139)">
              {fmt(max)}
            </text>
          </>
        )}
        <text x={padX + innerW / 2} y={H - 4} fontSize={9} textAnchor="middle" fill="rgb(100 116 139)">
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
  items: { raw: string; count: number }[];
}) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-amber-800 hover:text-amber-950">
        ⚠ {items.length} non-numeric measurement{items.length === 1 ? "" : "s"} — show
      </summary>
      <ul className="mt-1 ml-4 list-disc text-slate-700 space-y-0.5">
        {items.map((it, i) => (
          <li key={i}>
            <span className="font-mono">{it.raw}</span>
            <span className="text-slate-500 ml-2">
              ({it.count} sample{it.count === 1 ? "" : "s"})
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
