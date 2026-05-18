/**
 * Atlas / cartographic variant — taxon coverage as geography.
 *
 * Design intent:
 *   - The page is laid out like the front matter of a printed atlas:
 *     compass-rose icon as wordmark, "plate" callout for the
 *     primary visual, latitude-style hairlines, scale-bar metaphor
 *     for the corpus counts.
 *   - The "map" is an SVG abstract — concentric/contour-ish curves
 *     in muted teal-on-cream, not a literal continent silhouette.
 *     Reads as terrain without being a globe clipart.
 *   - Tight all-caps tracking for headers (cartographic convention),
 *     serif for body text. No emoji.
 *   - Surfaces are listed as "expedition routes" — same data, just
 *     framed by the metaphor.
 */

import { Link } from "@tanstack/react-router";
import { COPY, SURFACES } from "../copy";
import { useGemmaSummary, fmtCount } from "../useGemmaSummary";

const SERIF = 'Georgia, "Times New Roman", serif';

export function HomeAtlas() {
  const s = useGemmaSummary();
  return (
    <div
      className="h-full overflow-y-auto bg-[#f4ecd8] text-slate-900"
      style={{ fontFamily: SERIF }}
    >
      <div className="max-w-6xl mx-auto px-8 py-10 space-y-8">
        {/* Masthead — compass + wordmark */}
        <header className="flex items-baseline justify-between border-b-2 border-double border-slate-800 pb-3">
          <div className="flex items-baseline gap-3">
            <CompassRose />
            <div>
              <div className="text-3xl tracking-tight text-slate-900">
                <span className="font-bold">GEMMA</span> <span className="text-slate-500 italic">— atlas of curated expression</span>
              </div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-slate-600 mt-0.5">
                Plate I · Front matter
              </div>
            </div>
          </div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-slate-600">
            Pavlidis Lab · UBC
          </div>
        </header>

        {/* Tagline + corpus blurb */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-8">
          <div className="md:col-span-7">
            <h1 className="text-3xl leading-snug tracking-tight text-slate-900">
              {COPY.tagline}
            </h1>
            <p className="text-sm leading-relaxed text-slate-700 mt-4 max-w-2xl">
              {COPY.about}
            </p>
          </div>
          {/* Plate — abstract terrain */}
          <figure className="md:col-span-5">
            <TerrainPlate />
            <figcaption className="text-[10px] uppercase tracking-[0.2em] text-slate-600 mt-2 text-center italic">
              Plate I — coverage density (illustrative, not to scale)
            </figcaption>
          </figure>
        </section>

        {/* Scale bar — counts laid out as a map legend */}
        <section className="border-y-2 border-double border-slate-800 py-4">
          <div className="text-[10px] uppercase tracking-[0.3em] text-slate-600 mb-3 text-center">
            Scale of corpus
          </div>
          <div className="grid grid-cols-3 gap-2 max-w-3xl mx-auto">
            <ScaleEntry label="Datasets" value={fmtCount(s.datasets, "full", s.isLoading)} unit="curated experiments" />
            <ScaleEntry label="Platforms" value={fmtCount(s.platforms, "full", s.isLoading)} unit="microarray + RNA-seq" />
            <ScaleEntry label="Samples" value={fmtCount(s.samples, "full", s.isLoading)} unit="bioassays" />
          </div>
        </section>

        {/* Expedition routes — surfaces */}
        <section>
          <div className="text-[10px] uppercase tracking-[0.3em] text-slate-600 mb-3">
            Routes from this plate
          </div>
          <ol className="space-y-1">
            {SURFACES.map((surf, i) => (
              <RouteEntry key={surf.label} surface={surf} n={i + 1} />
            ))}
          </ol>
        </section>

        {/* Footer — colophon */}
        <footer className="border-t-2 border-double border-slate-800 pt-3 text-xs text-slate-600 leading-relaxed">
          <p>
            <span className="italic">Sources:</span> GEO, ArrayExpress, direct lab submissions.
            <span className="mx-2">·</span>
            <span className="italic">Cite:</span> {COPY.citation}
          </p>
          <p className="mt-1">
            <a href={COPY.links.docs} target="_blank" rel="noreferrer" className="underline text-slate-700 hover:text-slate-900">Docs</a>
            <span className="mx-2 text-slate-400">·</span>
            <a href={COPY.links.rest} target="_blank" rel="noreferrer" className="underline text-slate-700 hover:text-slate-900">REST</a>
            <span className="mx-2 text-slate-400">·</span>
            <a href={COPY.links.github} target="_blank" rel="noreferrer" className="underline text-slate-700 hover:text-slate-900">GitHub</a>
          </p>
        </footer>
      </div>
    </div>
  );
}

function CompassRose() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" className="block" aria-hidden>
      <circle cx="18" cy="18" r="16" fill="none" stroke="#1e293b" strokeWidth="1" />
      <circle cx="18" cy="18" r="10" fill="none" stroke="#1e293b" strokeWidth="0.5" />
      {/* Cardinal points */}
      <polygon points="18,4 21,18 18,32 15,18" fill="#1e293b" />
      <polygon points="4,18 18,15 32,18 18,21" fill="#1e293b" opacity="0.55" />
      {/* N marker */}
      <text x="18" y="3" fontSize="5" textAnchor="middle" fill="#1e293b" fontFamily="Georgia, serif" fontStyle="italic">
        N
      </text>
    </svg>
  );
}

function TerrainPlate() {
  // Abstract contour map — nested rounded shapes in muted teal.
  // Deterministic; no randomness so it's stable across renders.
  return (
    <svg
      viewBox="0 0 240 180"
      className="block w-full h-auto border border-slate-700"
      aria-hidden
    >
      <rect width="240" height="180" fill="#ede4cc" />
      {/* Faint graticule */}
      {Array.from({ length: 7 }, (_, i) => (
        <line key={`v${i}`} x1={(i + 1) * 30} y1={0} x2={(i + 1) * 30} y2={180} stroke="#cbb88e" strokeWidth="0.4" />
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <line key={`h${i}`} x1={0} y1={(i + 1) * 30} x2={240} y2={(i + 1) * 30} stroke="#cbb88e" strokeWidth="0.4" />
      ))}
      {/* Contours — three nested density rings, off-centre */}
      <ellipse cx="150" cy="80" rx="90" ry="55" fill="none" stroke="#0d9488" strokeWidth="1" opacity="0.5" />
      <ellipse cx="150" cy="80" rx="60" ry="40" fill="none" stroke="#0d9488" strokeWidth="1.2" opacity="0.7" />
      <ellipse cx="150" cy="80" rx="35" ry="25" fill="#0d9488" opacity="0.18" />
      <ellipse cx="150" cy="80" rx="35" ry="25" fill="none" stroke="#0d9488" strokeWidth="1.4" />
      {/* Secondary density blob */}
      <ellipse cx="60" cy="130" rx="40" ry="22" fill="none" stroke="#0d9488" strokeWidth="1" opacity="0.5" />
      <ellipse cx="60" cy="130" rx="22" ry="14" fill="#0d9488" opacity="0.12" />
      <ellipse cx="60" cy="130" rx="22" ry="14" fill="none" stroke="#0d9488" strokeWidth="1.2" />
      {/* Labels */}
      <text x="150" y="84" fontSize="8" textAnchor="middle" fill="#0f766e" fontFamily="Georgia, serif" fontStyle="italic">
        Mus
      </text>
      <text x="60" y="134" fontSize="7" textAnchor="middle" fill="#0f766e" fontFamily="Georgia, serif" fontStyle="italic">
        Homo
      </text>
      {/* Scale bar */}
      <line x1="180" y1="170" x2="220" y2="170" stroke="#1e293b" strokeWidth="0.8" />
      <line x1="180" y1="167" x2="180" y2="173" stroke="#1e293b" strokeWidth="0.8" />
      <line x1="220" y1="167" x2="220" y2="173" stroke="#1e293b" strokeWidth="0.8" />
      <text x="200" y="178" fontSize="5.5" textAnchor="middle" fill="#1e293b" fontFamily="Georgia, serif">
        1k experiments
      </text>
    </svg>
  );
}

function ScaleEntry({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-700 mb-1">
        {label}
      </div>
      <div
        className="text-4xl text-slate-900 tabular-nums"
        style={{ fontFamily: SERIF }}
      >
        {value}
      </div>
      <div className="text-[10px] text-slate-600 italic mt-1">{unit}</div>
    </div>
  );
}

function RouteEntry({
  surface,
  n,
}: {
  surface: (typeof SURFACES)[number];
  n: number;
}) {
  const inner = (
    <div className="flex items-baseline gap-3 py-2 border-b border-dotted border-slate-400">
      <span className="text-[11px] uppercase tracking-[0.2em] text-slate-500 tabular-nums w-8">
        N° {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-lg text-slate-900">{surface.label}</div>
        <div className="text-[12px] text-slate-600 italic">{surface.blurb}</div>
      </div>
      {surface.to ? <span className="text-slate-500">→</span> : null}
    </div>
  );
  if (!surface.to) {
    return <li className="opacity-50 cursor-not-allowed select-none">{inner}</li>;
  }
  return (
    <li>
      <Link
        to={surface.to}
        className="block text-slate-900 hover:text-teal-700 hover:no-underline"
      >
        {inner}
      </Link>
    </li>
  );
}
