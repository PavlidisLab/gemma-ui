/**
 * Heatmap variant — the page IS the visualization.
 *
 * Design intent:
 *   - The hero is a literal heatmap grid (taxon × annotation
 *     category) rendered in SVG with a single-hue ramp. Stands in
 *     as a "this is what Gemma's outputs look like" tile.
 *   - Navigation surfaces are oversized cells in a matching grid,
 *     each tinted by its (placeholder) density.
 *   - Tight Inter / system-ui at small sizes; tabular figures on
 *     every count.
 *   - Single accent ramp (slate → indigo) used as the data scale;
 *     no second colour scheme.
 *   - The look is "you're already inside a bioinformatics output"
 *     — defensible because Gemma actually produces matrices like
 *     this all day.
 */

import { Link } from "@tanstack/react-router";
import { COPY, SURFACES } from "../copy";
import { useGemmaSummary, fmtCount } from "../useGemmaSummary";

export function HomeHeatmap() {
  const s = useGemmaSummary();
  return (
    <div
      className="h-full overflow-y-auto bg-slate-50 text-slate-900"
      style={{ fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif' }}
    >
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Compact header */}
        <header className="flex items-baseline justify-between border-b border-slate-300 pb-2">
          <div className="flex items-baseline gap-2">
            <ColorChipLogo />
            <span className="text-lg font-semibold tracking-tight">Gemma</span>
            <span className="text-xs text-slate-500 ml-1">corpus heatmap</span>
          </div>
          <span className="text-[10px] uppercase tracking-wide text-slate-500 tabular-nums">
            n = {fmtCount(s.datasets, "full", s.isLoading)}
          </span>
        </header>

        {/* Tagline */}
        <p className="text-base leading-snug text-slate-900 max-w-3xl">
          {COPY.tagline}
        </p>

        {/* Hero heatmap + colour scale */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-9 bg-white border border-slate-300 p-4">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">
              Coverage matrix — taxon × annotation category (illustrative)
            </div>
            <HeatmapMatrix />
          </div>
          <aside className="lg:col-span-3 bg-white border border-slate-300 p-4 space-y-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">
              Color scale
            </div>
            <ColorScale />
            <p className="text-xs text-slate-600 leading-relaxed">
              Higher saturation = more datasets in that taxon /
              annotation combination. Placeholder data; the real
              coverage matrix lives behind the search facets.
            </p>
          </aside>
        </section>

        {/* Stats row — small cells */}
        <section className="grid grid-cols-3 gap-2">
          <StatCell label="Datasets" value={fmtCount(s.datasets, "full", s.isLoading)} fillIntensity={0.95} />
          <StatCell label="Platforms" value={fmtCount(s.platforms, "full", s.isLoading)} fillIntensity={0.55} />
          <StatCell label="Samples" value={fmtCount(s.samples, "full", s.isLoading)} fillIntensity={0.8} />
        </section>

        {/* Surfaces — large heatmap-like cells */}
        <section>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">
            Explore
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-slate-300">
            {SURFACES.map((surf, i) => (
              <SurfaceCell key={surf.label} surface={surf} fillIntensity={0.2 + ((i * 17) % 60) / 100} />
            ))}
          </div>
        </section>

        {/* About strip */}
        <section className="bg-white border border-slate-300 px-4 py-3 text-sm text-slate-700 leading-relaxed">
          {COPY.about}
        </section>

        {/* Footer */}
        <footer className="text-xs text-slate-500 flex items-baseline gap-3 flex-wrap">
          <span>Pavlidis Lab · UBC</span>
          <span className="text-slate-300">·</span>
          <a href={COPY.links.docs} className="text-indigo-700 hover:text-indigo-900" target="_blank" rel="noreferrer">Docs</a>
          <a href={COPY.links.rest} className="text-indigo-700 hover:text-indigo-900" target="_blank" rel="noreferrer">REST</a>
          <a href={COPY.links.github} className="text-indigo-700 hover:text-indigo-900" target="_blank" rel="noreferrer">GitHub</a>
        </footer>
      </div>
    </div>
  );
}

/** Tiny coloured wordmark — a 3×3 chip in indigo that hints at the
 *  heatmap motif. Replaces the bullet-dot used by the other variants. */
function ColorChipLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 9 9" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => {
        const x = (i % 3) * 3;
        const y = Math.floor(i / 3) * 3;
        const op = [0.3, 0.65, 0.45, 0.55, 1.0, 0.7, 0.4, 0.6, 0.25][i];
        return <rect key={i} x={x} y={y} width="3" height="3" fill="#4f46e5" opacity={op} />;
      })}
    </svg>
  );
}

/** Abstract taxon × annotation-category coverage matrix. Deterministic
 *  intensity from a sine seed so the matrix looks data-shaped but
 *  doesn't depend on a real fetch. Replace with a real coverage
 *  query when one's available. */
function HeatmapMatrix() {
  const rows = ["Human", "Mouse", "Rat", "Zebrafish", "Yeast", "Other"];
  const cols = [
    "disease",
    "tissue",
    "cell type",
    "treatment",
    "genotype",
    "sex",
    "age",
    "perturbation",
    "developmental stage",
    "strain",
  ];
  const cell = 28;
  const labelL = 80;
  const labelB = 70;
  const W = labelL + cols.length * cell + 8;
  const H = labelB + rows.length * cell + 4;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block w-full h-auto"
      preserveAspectRatio="xMidYMid meet"
      aria-label="Coverage matrix"
    >
      {/* Column labels — rotated */}
      {cols.map((c, ci) => (
        <text
          key={c}
          x={labelL + ci * cell + cell / 2}
          y={labelB - 6}
          fontSize="9"
          fill="#475569"
          textAnchor="end"
          transform={`rotate(-45 ${labelL + ci * cell + cell / 2},${labelB - 6})`}
        >
          {c}
        </text>
      ))}
      {/* Row labels */}
      {rows.map((r, ri) => (
        <text
          key={r}
          x={labelL - 6}
          y={labelB + ri * cell + cell / 2 + 3}
          fontSize="9"
          fill="#475569"
          textAnchor="end"
          fontStyle="italic"
        >
          {r}
        </text>
      ))}
      {/* Cells */}
      {rows.map((r, ri) =>
        cols.map((c, ci) => {
          // Deterministic intensity from indices.
          const v =
            0.5 +
            0.5 *
              Math.sin(ri * 1.7 + ci * 0.9) *
              Math.cos(ci * 0.7 - ri * 0.4);
          const op = Math.max(0.05, Math.min(0.95, v));
          return (
            <rect
              key={`${r}-${c}`}
              x={labelL + ci * cell + 1}
              y={labelB + ri * cell + 1}
              width={cell - 2}
              height={cell - 2}
              fill="#4f46e5"
              opacity={op}
            />
          );
        }),
      )}
    </svg>
  );
}

function ColorScale() {
  return (
    <div>
      <div className="flex h-3 rounded overflow-hidden border border-slate-300">
        {Array.from({ length: 20 }, (_, i) => (
          <div
            key={i}
            className="flex-1"
            style={{ background: `rgba(79, 70, 229, ${0.05 + (i / 19) * 0.9})` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-500 mt-1 tabular-nums">
        <span>low</span>
        <span>high</span>
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  fillIntensity,
}: {
  label: string;
  value: string;
  fillIntensity: number;
}) {
  return (
    <div
      className="border border-slate-300 px-4 py-3"
      style={{ background: `rgba(79, 70, 229, ${0.06 + fillIntensity * 0.18})` }}
    >
      <div className="text-[10px] uppercase tracking-wide text-slate-600">{label}</div>
      <div className="text-2xl font-semibold tabular-nums text-slate-900 mt-0.5">
        {value}
      </div>
    </div>
  );
}

function SurfaceCell({
  surface,
  fillIntensity,
}: {
  surface: (typeof SURFACES)[number];
  fillIntensity: number;
}) {
  const tint = `rgba(79, 70, 229, ${0.07 + fillIntensity * 0.2})`;
  if (!surface.to) {
    return (
      <div
        className="px-4 py-5 bg-white opacity-50 cursor-not-allowed"
        style={{ background: tint }}
      >
        <div className="text-sm font-medium text-slate-500">{surface.label}</div>
        <div className="text-xs text-slate-500 leading-snug mt-0.5">
          {surface.blurb}
        </div>
      </div>
    );
  }
  return (
    <Link
      to={surface.to}
      className="block px-4 py-5 bg-white hover:bg-indigo-50 hover:no-underline transition-colors"
      style={{ background: tint }}
    >
      <div className="text-base font-medium text-slate-900">{surface.label} →</div>
      <div className="text-xs text-slate-600 leading-snug mt-0.5">
        {surface.blurb}
      </div>
    </Link>
  );
}
