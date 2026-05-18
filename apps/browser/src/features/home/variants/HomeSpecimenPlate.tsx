/**
 * Specimen-plate variant — "photographic" without resorting to photos.
 *
 * Design intent:
 *   - Single hero "image" is an SVG-rendered abstract specimen
 *     plate: a grid of softly-coloured wells (think 96-well plate,
 *     not a slide image). Each well's intensity is seeded from the
 *     well index — looks like real data, isn't.
 *   - Layered grain (SVG turbulence) overlay gives a slight
 *     film-still texture without committing to literal photography.
 *   - Cream + ink palette borrowed from museum-catalogue printing;
 *     serif display type for the title only, sans body.
 *   - The page reads as the front page of a printed monograph —
 *     decorative restraint, but with one genuine visual moment.
 *   - When real outputs land (a per-experiment heatmap thumb, a
 *     mean expression scatter, etc.), swap the SpecimenPlate for
 *     that and the rest of the page still composes.
 */

import { Link } from "@tanstack/react-router";
import { COPY, SURFACES } from "../copy";
import { useGemmaSummary, fmtCount } from "../useGemmaSummary";

export function HomeSpecimenPlate() {
  const s = useGemmaSummary();
  return (
    <div
      className="h-full overflow-y-auto bg-[#f4ede0] text-stone-900 relative"
      style={{ fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif' }}
    >
      <GrainOverlay />
      <div className="max-w-6xl mx-auto px-8 py-12 space-y-10 relative">
        {/* Header strip */}
        <header className="flex items-baseline justify-between border-b border-stone-700 pb-3">
          <div className="flex items-baseline gap-3">
            <span
              className="text-3xl font-bold tracking-tight"
              style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
            >
              Gemma
            </span>
            <span className="text-[10px] uppercase tracking-[0.25em] text-stone-600">
              An expression-data monograph
            </span>
          </div>
          <span className="text-[10px] uppercase tracking-[0.25em] text-stone-600">
            Plate I
          </span>
        </header>

        {/* Hero — specimen plate + title block */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-10 items-center">
          <div className="md:col-span-7">
            <SpecimenPlate />
            <div className="text-[11px] italic text-stone-600 mt-3 leading-relaxed max-w-md">
              Plate I. Synthetic specimen field — 96 wells, intensity
              proportional to a deterministic seed function. Stands in
              for a real Gemma heatmap until we wire one.
            </div>
          </div>
          <div className="md:col-span-5">
            <h1
              className="text-4xl leading-[1.05] tracking-tight"
              style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
            >
              {COPY.tagline}
            </h1>
            <p className="text-sm text-stone-700 leading-relaxed mt-4">
              {COPY.about}
            </p>
            <div className="mt-5 inline-flex items-baseline gap-3">
              <Link
                to="/browser"
                className="text-sm font-medium text-stone-900 border-b-2 border-stone-900 pb-0.5 hover:text-stone-600 hover:border-stone-600 hover:no-underline"
              >
                Browse datasets →
              </Link>
              <Link
                to="/platforms"
                className="text-sm text-stone-700 hover:text-stone-900 hover:no-underline"
              >
                Platforms
              </Link>
            </div>
          </div>
        </section>

        {/* Numbers row — letterpress slugs */}
        <section className="grid grid-cols-3 gap-3">
          <SlugCount label="Datasets" value={fmtCount(s.datasets)} />
          <SlugCount label="Platforms" value={fmtCount(s.platforms)} />
          <SlugCount label="Samples" value={fmtCount(s.samples)} />
        </section>

        {/* Surface index — small caps caption + entries */}
        <section>
          <div className="text-[10px] uppercase tracking-[0.25em] text-stone-600 mb-2">
            Index of sections
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-3">
            {SURFACES.map((surf, i) => (
              <SurfaceEntry key={surf.label} surface={surf} index={i + 1} />
            ))}
          </div>
        </section>

        {/* Colophon */}
        <footer className="border-t border-stone-700 pt-3 text-[11px] text-stone-600 leading-relaxed">
          <p>
            Pavlidis Lab · University of British Columbia · Vancouver. Cite as:{" "}
            <span className="italic">{COPY.citation}</span>{" "}
            <a href={COPY.links.github} className="text-stone-700 underline hover:text-stone-900" target="_blank" rel="noreferrer">
              github
            </a>
            {" · "}
            <a href={COPY.links.docs} className="text-stone-700 underline hover:text-stone-900" target="_blank" rel="noreferrer">
              docs
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}

/** Faint SVG grain. position:absolute over the whole page;
 *  opacity tuned to "you'd only notice if you looked." Built from
 *  feTurbulence so we don't ship a PNG asset. */
function GrainOverlay() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 w-full h-full opacity-[0.05] mix-blend-multiply"
    >
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
        <feColorMatrix
          values="0 0 0 0 0.2
                  0 0 0 0 0.2
                  0 0 0 0 0.2
                  0 0 0 0.9 0"
        />
      </filter>
      <rect width="100%" height="100%" filter="url(#grain)" />
    </svg>
  );
}

/** Synthetic 12×8 specimen plate. Intensity follows a deterministic
 *  seed function (sine-of-index) so it looks plausibly biological
 *  without being random per-render. Single ink, varying opacity. */
function SpecimenPlate() {
  const cols = 12;
  const rows = 8;
  const cellSize = 36;
  const padding = 10;
  const W = cols * cellSize + padding * 2;
  const H = rows * cellSize + padding * 2;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Deterministic intensity — Perlin-ish without the library.
      const v =
        0.5 +
        0.5 *
          Math.sin((c + 1) * 0.7 + r * 1.3) *
          Math.cos(r * 0.5 - c * 0.2);
      const op = 0.15 + 0.75 * Math.max(0, Math.min(1, v));
      cells.push(
        <circle
          key={`${r}-${c}`}
          cx={padding + c * cellSize + cellSize / 2}
          cy={padding + r * cellSize + cellSize / 2}
          r={cellSize / 2 - 4}
          fill="#1c1917"
          opacity={op}
        />,
      );
    }
  }
  return (
    <div className="border border-stone-700 bg-stone-50 p-2 shadow-[2px_2px_0_0_#1c1917]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        className="block"
        aria-label="Synthetic specimen plate"
      >
        {/* Plate label corners */}
        <text x={padding} y={padding - 2} fontSize="8" fill="#57534e" fontFamily="Inter, sans-serif">
          A1
        </text>
        <text
          x={W - padding - 12}
          y={H - 2}
          fontSize="8"
          fill="#57534e"
          fontFamily="Inter, sans-serif"
        >
          H12
        </text>
        {cells}
      </svg>
    </div>
  );
}

function SlugCount({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#e8dfcc] border border-stone-700 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-stone-700">
        {label}
      </div>
      <div
        className="text-3xl font-bold tabular-nums text-stone-900 mt-1"
        style={{ fontFamily: 'Georgia, serif' }}
      >
        {value}
      </div>
    </div>
  );
}

function SurfaceEntry({
  surface,
  index,
}: {
  surface: (typeof SURFACES)[number];
  index: number;
}) {
  const inner = (
    <div className="flex items-baseline gap-3 py-2 border-b border-stone-400 border-dotted">
      <span
        className="text-xs text-stone-500 tabular-nums w-6"
        style={{ fontFamily: 'Georgia, serif' }}
      >
        {romanize(index)}.
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-base text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
          {surface.label}
        </div>
        <div className="text-[11px] text-stone-600 leading-snug">
          {surface.blurb}
        </div>
      </div>
    </div>
  );
  if (!surface.to) {
    return <div className="opacity-40 cursor-not-allowed select-none">{inner}</div>;
  }
  return (
    <Link to={surface.to} className="block text-stone-900 hover:text-stone-600 hover:no-underline">
      {inner}
    </Link>
  );
}

function romanize(n: number): string {
  const map: [number, string][] = [
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [v, s] of map) {
    while (n >= v) { out += s; n -= v; }
  }
  return out;
}
