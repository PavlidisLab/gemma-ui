/**
 * Brutalist grid variant — sharp blocks, asymmetric layout.
 *
 * Design intent (v2 — toned down per Paul, 2026-05-17):
 *   - Big-but-not-yelling wordmark (was display-size; now still
 *     bold but human-scale, capped at ~3.5rem).
 *   - Dropped the inverted black tagline block; tagline now reads
 *     as plain heavy type inside the grid. Less punch, less drama.
 *   - Hard 1px borders, no rounded corners, no shadows kept.
 *   - 12-column grid retained for the corpus row; cell weights
 *     softened (font-semibold not font-black).
 *   - Single accent (blue-700) used only for hover affordances on
 *     surface tiles — no full colour-flip; instead a quiet bottom
 *     border accent and a slight bg tint.
 */

import { Link } from "@tanstack/react-router";
import { COPY, SURFACES } from "../copy";
import { useGemmaSummary, fmtCount } from "../useGemmaSummary";

export function HomeBrutalist() {
  const s = useGemmaSummary();
  return (
    <div
      className="h-full overflow-y-auto bg-stone-100 text-stone-950"
      style={{ fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif' }}
    >
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-px">
        {/* Wordmark + tagline — single block, no inversion */}
        <div className="border border-stone-950 bg-stone-100">
          <div className="px-6 py-6 flex items-baseline justify-between gap-6 flex-wrap">
            <div className="flex items-baseline gap-3">
              <span className="text-4xl leading-none font-bold tracking-tight">
                GEMMA
              </span>
              <span className="text-[10px] uppercase tracking-[0.18em] text-stone-600">
                Curated · re-analyzed · API-first
              </span>
            </div>
            <div className="text-base text-stone-800 max-w-md text-right leading-snug">
              {COPY.tagline}
            </div>
          </div>
        </div>

        {/* Grid: 3 stats + about */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-px bg-stone-950">
          <StatBlock label="Datasets" value={fmtCount(s.datasets, "full", s.isLoading)} cols="md:col-span-3" />
          <StatBlock label="Platforms" value={fmtCount(s.platforms, "full", s.isLoading)} cols="md:col-span-3" />
          <StatBlock label="Samples" value={fmtCount(s.samples, "full", s.isLoading)} cols="md:col-span-2" />
          <div className="md:col-span-4 bg-stone-100 px-5 py-4 text-sm leading-relaxed text-stone-800">
            {COPY.about}
          </div>
        </div>

        {/* Surface buttons — chunky but quiet */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-stone-950">
          {SURFACES.map((surf) => (
            <SurfaceBlock key={surf.label} surface={surf} />
          ))}
        </div>

        {/* Footer strip */}
        <div className="border border-stone-950 bg-stone-100">
          <div className="px-6 py-3 flex items-baseline justify-between gap-4 flex-wrap text-xs text-stone-600">
            <div className="uppercase tracking-[0.18em]">
              Pavlidis Lab · UBC
            </div>
            <div className="flex items-center gap-4">
              <a href={COPY.links.docs} className="text-stone-950 underline hover:text-blue-700" target="_blank" rel="noreferrer">Docs</a>
              <a href={COPY.links.rest} className="text-stone-950 underline hover:text-blue-700" target="_blank" rel="noreferrer">REST</a>
              <a href={COPY.links.github} className="text-stone-950 underline hover:text-blue-700" target="_blank" rel="noreferrer">GitHub</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBlock({
  label,
  value,
  cols,
}: {
  label: string;
  value: string;
  cols: string;
}) {
  return (
    <div className={`${cols} bg-stone-100 px-5 py-4`}>
      <div className="text-[10px] uppercase tracking-[0.2em] text-stone-600 mb-1">
        {label}
      </div>
      <div className="text-3xl font-semibold tabular-nums tracking-tight text-stone-950">
        {value}
      </div>
    </div>
  );
}

function SurfaceBlock({
  surface,
}: {
  surface: (typeof SURFACES)[number];
}) {
  if (!surface.to) {
    return (
      <div className="bg-stone-200/60 px-5 py-5 opacity-60 cursor-not-allowed border-b-2 border-transparent">
        <div className="text-lg font-semibold tracking-tight text-stone-500 mb-1">
          {surface.label}
        </div>
        <div className="text-xs text-stone-500 leading-snug">
          {surface.blurb}
        </div>
      </div>
    );
  }
  // Hover treatment: quiet — slight bg shift + a blue bottom border
  // accent. No full inversion. Surface stays readable on hover.
  return (
    <Link
      to={surface.to}
      className="bg-stone-100 px-5 py-5 border-b-2 border-transparent hover:bg-stone-50 hover:border-blue-700 hover:no-underline transition-colors"
    >
      <div className="text-lg font-semibold tracking-tight text-stone-950 mb-1">
        {surface.label} <span className="text-stone-400">→</span>
      </div>
      <div className="text-xs text-stone-600 leading-snug">
        {surface.blurb}
      </div>
    </Link>
  );
}
