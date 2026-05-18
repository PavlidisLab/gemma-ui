/**
 * Soft minimal variant — quiet, lots of whitespace.
 *
 * Design intent:
 *   - Inter / system-ui at conservative sizes. No display type.
 *   - Generous padding, narrow content column.
 *   - Single muted accent (slate-700) and zero saturation otherwise.
 *   - Hairline dividers in slate-200; the rest of the page is
 *     almost-white on white.
 *   - Reads more like Stripe / Linear's quieter pages. Functional,
 *     not decorative.
 */

import { Link } from "@tanstack/react-router";
import { COPY, SURFACES } from "../copy";
import { useGemmaSummary, fmtCount } from "../useGemmaSummary";

export function HomeMinimal() {
  const s = useGemmaSummary();
  return (
    <div
      className="h-full overflow-y-auto bg-white text-slate-900"
      style={{ fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif' }}
    >
      <div className="max-w-2xl mx-auto px-6 py-20 space-y-16">
        {/* Wordmark + tagline */}
        <header className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-900" />
            <span className="text-sm font-medium tracking-tight text-slate-900">
              Gemma
            </span>
          </div>
          <h1 className="text-3xl leading-tight tracking-tight text-slate-900 font-medium">
            {COPY.tagline}
          </h1>
          <p className="text-base leading-relaxed text-slate-600">
            {COPY.about}
          </p>
        </header>

        {/* Quiet stats row */}
        <section className="grid grid-cols-3 gap-6 pt-6 border-t border-slate-200">
          <Stat label="Datasets" value={fmtCount(s.datasets, "compact")} />
          <Stat label="Platforms" value={fmtCount(s.platforms, "compact")} />
          <Stat label="Samples" value={fmtCount(s.samples, "compact")} />
        </section>

        {/* Surfaces — a tight list */}
        <section className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
            Sections
          </div>
          {SURFACES.map((surf) => (
            <SurfaceRow key={surf.label} surface={surf} />
          ))}
        </section>

        {/* Who it's for */}
        <section className="border-t border-slate-200 pt-6">
          <p className="text-sm leading-relaxed text-slate-600">
            {COPY.whoFor}
          </p>
        </section>

        {/* Footer */}
        <footer className="border-t border-slate-200 pt-4 text-xs text-slate-500 leading-relaxed space-y-1">
          <p>
            <a href={COPY.links.docs} className="text-slate-700 hover:text-slate-900" target="_blank" rel="noreferrer">Docs</a>
            <span className="mx-2 text-slate-300">·</span>
            <a href={COPY.links.rest} className="text-slate-700 hover:text-slate-900" target="_blank" rel="noreferrer">REST API</a>
            <span className="mx-2 text-slate-300">·</span>
            <a href={COPY.links.github} className="text-slate-700 hover:text-slate-900" target="_blank" rel="noreferrer">GitHub</a>
          </p>
          <p>Pavlidis Lab · UBC</p>
        </footer>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-medium tabular-nums text-slate-900">
        {value}
      </div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

function SurfaceRow({
  surface,
}: {
  surface: (typeof SURFACES)[number];
}) {
  const inner = (
    <div className="flex items-baseline justify-between gap-4 py-3 border-b border-slate-100">
      <div className="min-w-0">
        <div className="text-base font-medium text-slate-900">{surface.label}</div>
        <div className="text-sm text-slate-500 leading-snug">{surface.blurb}</div>
      </div>
      <div className="text-slate-400 shrink-0">→</div>
    </div>
  );
  if (!surface.to) {
    return <div className="opacity-40 cursor-not-allowed select-none">{inner}</div>;
  }
  return (
    <Link to={surface.to} className="block hover:bg-slate-50 -mx-2 px-2 rounded hover:no-underline">
      {inner}
    </Link>
  );
}
