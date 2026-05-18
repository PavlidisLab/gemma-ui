/**
 * Tidepool variant — calming, watercolor washes, gentle curves.
 *
 * Design intent:
 *   - Cream / shell-pink base wash with soft horizontal SVG wave
 *     dividers (no sharp lines, no grid).
 *   - Type: a humanist serif for headings (Source Serif Pro
 *     → Georgia fallback), Inter for body. Conservative sizing
 *     and very generous leading.
 *   - One muted accent (slate-teal) plus warm cream for sections.
 *     Quiet enough that the eye rests; warm enough that it doesn't
 *     feel sterile.
 *   - Numbers in serif italic — atypical for a stats panel and the
 *     thing that makes the page feel like a quarterly newsletter
 *     rather than a SaaS dashboard.
 *   - No iconography, no hover-flips. The page moves slowly.
 */

import { Link } from "@tanstack/react-router";
import { COPY, SURFACES } from "../copy";
import { useGemmaSummary, fmtCount } from "../useGemmaSummary";

const SERIF = '"Source Serif Pro", Georgia, "Times New Roman", serif';

export function HomeTidepool() {
  const s = useGemmaSummary();
  return (
    <div
      className="h-full overflow-y-auto text-stone-800"
      style={{
        fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
        background:
          "linear-gradient(180deg, #fff7ed 0%, #fef3f2 38%, #f0fdfa 100%)",
      }}
    >
      <div className="max-w-3xl mx-auto px-6 py-16 space-y-14">
        {/* Wordmark */}
        <header className="space-y-2">
          <div className="flex items-baseline gap-2">
            <DotMark />
            <span className="text-sm tracking-tight text-stone-700">Gemma</span>
          </div>
          <h1
            className="text-4xl leading-snug tracking-tight text-stone-900"
            style={{ fontFamily: SERIF }}
          >
            {COPY.tagline}
          </h1>
        </header>

        {/* Wave divider */}
        <WaveDivider />

        {/* About */}
        <section>
          <p className="text-base leading-loose text-stone-700">
            {COPY.about}
          </p>
        </section>

        {/* Quiet numbers — serif italics */}
        <section className="grid grid-cols-3 gap-6 py-6 border-y border-stone-300/60">
          <Quiet label="Datasets" value={fmtCount(s.datasets, "full", s.isLoading)} />
          <Quiet label="Platforms" value={fmtCount(s.platforms, "full", s.isLoading)} />
          <Quiet label="Samples" value={fmtCount(s.samples, "full", s.isLoading)} />
        </section>

        {/* Who it's for */}
        <section>
          <p className="text-base leading-loose text-stone-700">
            {COPY.whoFor}
          </p>
        </section>

        <WaveDivider flipped />

        {/* Sections — text-only list, no decoration */}
        <section className="space-y-3">
          <div
            className="text-xs uppercase tracking-[0.18em] text-stone-500"
          >
            Sections
          </div>
          <ul className="space-y-2">
            {SURFACES.map((surf) => (
              <SurfaceLine key={surf.label} surface={surf} />
            ))}
          </ul>
        </section>

        {/* Colophon */}
        <footer className="text-xs text-stone-500 leading-loose">
          <p>
            Pavlidis Lab · University of British Columbia. ·{" "}
            <a href={COPY.links.docs} target="_blank" rel="noreferrer" className="text-teal-700 hover:text-teal-900">Docs</a>
            <span className="mx-1">·</span>
            <a href={COPY.links.rest} target="_blank" rel="noreferrer" className="text-teal-700 hover:text-teal-900">REST</a>
            <span className="mx-1">·</span>
            <a href={COPY.links.github} target="_blank" rel="noreferrer" className="text-teal-700 hover:text-teal-900">GitHub</a>
          </p>
        </footer>
      </div>
    </div>
  );
}

function DotMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <defs>
        <radialGradient id="td-dot" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0d9488" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#0d9488" stopOpacity="0.2" />
        </radialGradient>
      </defs>
      <circle cx="7" cy="7" r="6" fill="url(#td-dot)" />
    </svg>
  );
}

/** Faint horizontal wave divider — single SVG path, low opacity, no
 *  rule lines. Used between sections to suggest a tideline. */
function WaveDivider({ flipped = false }: { flipped?: boolean }) {
  return (
    <svg
      viewBox="0 0 800 40"
      aria-hidden
      className="block w-full"
      style={{ transform: flipped ? "scaleY(-1)" : undefined }}
    >
      <path
        d="M0 20 Q 100 5, 200 20 T 400 20 T 600 20 T 800 20"
        fill="none"
        stroke="#0d9488"
        strokeWidth="1.2"
        opacity="0.35"
      />
      <path
        d="M0 28 Q 100 14, 200 28 T 400 28 T 600 28 T 800 28"
        fill="none"
        stroke="#0d9488"
        strokeWidth="1"
        opacity="0.18"
      />
    </svg>
  );
}

function Quiet({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="text-3xl text-stone-800 tabular-nums italic"
        style={{ fontFamily: SERIF }}
      >
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500 mt-1">
        {label}
      </div>
    </div>
  );
}

function SurfaceLine({ surface }: { surface: (typeof SURFACES)[number] }) {
  const inner = (
    <div className="flex items-baseline gap-3 py-1.5">
      <span
        className="text-base text-stone-900"
        style={{ fontFamily: SERIF }}
      >
        {surface.label}
      </span>
      <span className="text-sm text-stone-600 leading-relaxed">— {surface.blurb}</span>
    </div>
  );
  if (!surface.to) {
    return <li className="opacity-50 cursor-not-allowed">{inner}</li>;
  }
  return (
    <li>
      <Link
        to={surface.to}
        className="block hover:no-underline group"
      >
        <div className="flex items-baseline gap-3 py-1.5 group-hover:bg-white/40 -mx-2 px-2 rounded">
          <span
            className="text-base text-teal-800 group-hover:text-teal-900"
            style={{ fontFamily: SERIF }}
          >
            {surface.label}
          </span>
          <span className="text-sm text-stone-600 leading-relaxed">— {surface.blurb}</span>
        </div>
      </Link>
    </li>
  );
}
