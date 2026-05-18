/**
 * Cosmos variant — dark, spacey, glowing.
 *
 * Design intent:
 *   - Deep midnight background (near-black with a hint of indigo).
 *   - Two large radial nebula gradients (warm amber/coral one
 *     corner, cool teal/violet the other) pull from the Gemma
 *     sunburst palette without being literal sunbursts.
 *   - A faint deterministic star-field (SVG dots at varied opacity)
 *     gives depth without animated chrome.
 *   - Type: Inter, light/medium weights, generous tracking; numerals
 *     glow softly via text-shadow for the stats.
 *   - Surface tiles are translucent "panes" with hairline borders
 *     and an inner glow on hover.
 *   - Reads as modern observatory / instrument cluster. Calming
 *     despite the dark palette because the colour temperature is
 *     low and the typography is quiet.
 */

import { Link } from "@tanstack/react-router";
import { COPY, SURFACES } from "../copy";
import { useGemmaSummary, fmtCount } from "../useGemmaSummary";

export function HomeCosmos() {
  const s = useGemmaSummary();
  return (
    <div
      className="h-full overflow-y-auto text-slate-100 relative"
      style={{
        fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
        background:
          "radial-gradient(ellipse at 85% 15%, rgba(244, 114, 182, 0.18) 0%, transparent 50%), radial-gradient(ellipse at 15% 85%, rgba(20, 184, 166, 0.22) 0%, transparent 55%), radial-gradient(ellipse at 50% 50%, rgba(99, 102, 241, 0.08) 0%, transparent 60%), #0b0f1a",
      }}
    >
      <StarField />

      <div className="max-w-5xl mx-auto px-6 py-12 space-y-10 relative">
        {/* Header */}
        <header className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-3">
            <CelestialMark />
            <div>
              <div className="text-2xl font-medium tracking-tight text-slate-50">
                Gemma
              </div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-slate-400">
                an observatory of curated expression
              </div>
            </div>
          </div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-slate-500">
            Pavlidis Lab · UBC
          </div>
        </header>

        {/* Hero */}
        <section className="space-y-4 max-w-3xl">
          <h1
            className="text-4xl leading-[1.15] tracking-tight text-slate-50 font-light"
            style={{ textShadow: "0 0 30px rgba(99, 102, 241, 0.25)" }}
          >
            {COPY.tagline}
          </h1>
          <p className="text-base leading-relaxed text-slate-300">
            {COPY.about}
          </p>
        </section>

        {/* Stat constellations */}
        <section className="grid grid-cols-3 gap-3">
          <Constellation label="Datasets"  value={fmtCount(s.datasets, "full", s.isLoading)} hue="rgba(244,114,182,0.5)" />
          <Constellation label="Platforms" value={fmtCount(s.platforms, "full", s.isLoading)} hue="rgba(20,184,166,0.5)" />
          <Constellation label="Samples"   value={fmtCount(s.samples, "full", s.isLoading)} hue="rgba(251,191,36,0.5)" />
        </section>

        {/* Surfaces — translucent panes */}
        <section>
          <div className="text-[10px] uppercase tracking-[0.25em] text-slate-400 mb-3">
            Navigation
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {SURFACES.map((surf) => (
              <Pane key={surf.label} surface={surf} />
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-slate-700/40 pt-4 text-[11px] text-slate-400 leading-relaxed">
          <p>
            <a href={COPY.links.docs} target="_blank" rel="noreferrer" className="text-slate-300 hover:text-slate-100">Docs</a>
            <span className="mx-2 text-slate-600">·</span>
            <a href={COPY.links.rest} target="_blank" rel="noreferrer" className="text-slate-300 hover:text-slate-100">REST</a>
            <span className="mx-2 text-slate-600">·</span>
            <a href={COPY.links.github} target="_blank" rel="noreferrer" className="text-slate-300 hover:text-slate-100">GitHub</a>
            <span className="mx-2 text-slate-600">·</span>
            <span>Cite: {COPY.citation}</span>
          </p>
        </footer>
      </div>
    </div>
  );
}

/** Tiny celestial mark — a small glowing disc with a thin ring,
 *  evocative of a planet/sun without being literal. */
function CelestialMark() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden>
      <defs>
        <radialGradient id="cm-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fcd34d" stopOpacity="1" />
          <stop offset="60%" stopColor="#f59e0b" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill="url(#cm-glow)" />
      <circle cx="16" cy="16" r="6" fill="#fcd34d" />
      <ellipse cx="16" cy="16" rx="13" ry="3" fill="none" stroke="#8b5cf6" strokeWidth="1" opacity="0.6" transform="rotate(-20 16 16)" />
    </svg>
  );
}

/** Faint star-field — deterministic dots scattered across the page.
 *  No animation; just depth. Different sizes/opacities to mimic
 *  distance. */
function StarField() {
  // Seeded "random" via a sine sweep — gives a stable pattern.
  const stars = Array.from({ length: 120 }, (_, i) => {
    const x = ((i * 73) % 1000) / 10; // 0..100
    const y = ((i * 199) % 1000) / 10;
    const r = 0.4 + (Math.abs(Math.sin(i * 1.7)) * 0.9);
    const op = 0.15 + (Math.abs(Math.cos(i * 0.9)) * 0.55);
    return { x, y, r, op };
  });
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 w-full h-full"
      preserveAspectRatio="xMidYMid slice"
    >
      {stars.map((s, i) => (
        <circle
          key={i}
          cx={`${s.x}%`}
          cy={`${s.y}%`}
          r={s.r}
          fill="#e2e8f0"
          opacity={s.op}
        />
      ))}
    </svg>
  );
}

function Constellation({
  label,
  value,
  hue,
}: {
  label: string;
  value: string;
  hue: string;
}) {
  return (
    <div
      className="rounded-2xl border border-slate-700/60 bg-slate-900/40 backdrop-blur px-5 py-4"
      style={{ boxShadow: `inset 0 0 40px -10px ${hue}` }}
    >
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 mb-1">
        {label}
      </div>
      <div
        className="text-3xl font-light tabular-nums text-slate-50"
        style={{ textShadow: `0 0 12px ${hue}` }}
      >
        {value}
      </div>
    </div>
  );
}

function Pane({ surface }: { surface: (typeof SURFACES)[number] }) {
  const inner = (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 backdrop-blur px-5 py-4 h-full">
      <div className="text-lg font-medium tracking-tight text-slate-50">
        {surface.label} {surface.to ? <span className="opacity-50">→</span> : null}
      </div>
      <div className="text-sm text-slate-400 leading-snug mt-1">
        {surface.blurb}
      </div>
    </div>
  );
  if (!surface.to) {
    return <div className="opacity-40 cursor-not-allowed">{inner}</div>;
  }
  return (
    <Link
      to={surface.to}
      className="block hover:no-underline group"
    >
      <div
        className="rounded-2xl border border-slate-700/60 bg-slate-900/40 backdrop-blur px-5 py-4 h-full group-hover:border-slate-400/70 transition-colors"
        style={{ boxShadow: "inset 0 0 40px -20px rgba(99, 102, 241, 0)" }}
      >
        <div className="text-lg font-medium tracking-tight text-slate-50 group-hover:text-white">
          {surface.label} <span className="opacity-50">→</span>
        </div>
        <div className="text-sm text-slate-400 leading-snug mt-1 group-hover:text-slate-300">
          {surface.blurb}
        </div>
      </div>
    </Link>
  );
}
