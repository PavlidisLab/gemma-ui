/**
 * Data-dashboard variant — stats are the hero.
 *
 * Design intent:
 *   - Numbers up front; text de-emphasized.
 *   - Dense small-multiples header (one stat tile per metric).
 *   - Single fixed accent (indigo) for active links and the
 *     "this week" trend chip; everything else neutral.
 *   - Tight type at small sizes. Tabular numerals throughout so
 *     digits line up between tiles.
 *   - Feels like Datadog / Plausible / a quiet observability home.
 *
 * Trend chips on the right of each tile are placeholders today
 * (no "this week" data yet — see useGemmaSummary TODO). The slot
 * exists so wiring them in later doesn't require layout work.
 */

import { Link } from "@tanstack/react-router";
import { COPY, SURFACES } from "../copy";
import { useGemmaSummary, fmtCount } from "../useGemmaSummary";

export function HomeDashboard() {
  const s = useGemmaSummary();
  return (
    <div
      className="h-full overflow-y-auto bg-slate-50 text-slate-900"
      style={{ fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif' }}
    >
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Header — wordmark + tagline */}
        <header className="flex items-end justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="inline-block w-2 h-2 rounded-sm bg-indigo-600" />
              <span className="text-lg font-semibold tracking-tight">Gemma</span>
              <span className="text-xs text-slate-500">v1 · summary</span>
            </div>
            <p className="text-sm text-slate-600 mt-1 max-w-xl">
              {COPY.tagline}
            </p>
          </div>
          <div className="text-xs text-slate-500 tabular-nums">
            updated {new Date().toLocaleDateString()}
          </div>
        </header>

        {/* Hero stats — three tiles + a sparkline placeholder */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <StatTile label="Datasets" value={fmtCount(s.datasets)} hint="curated experiments" />
          <StatTile label="Platforms" value={fmtCount(s.platforms)} hint="microarray + RNA-seq" />
          <StatTile label="Samples" value={fmtCount(s.samples)} hint="harmonized bioassays" />
        </section>

        {/* Taxon breakdown table — mirrors the screenshot summary block */}
        <section className="bg-white border border-slate-200 rounded">
          <div className="px-4 py-2 border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 font-medium">
            By organism
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Taxon</th>
                <th className="text-right px-4 py-2 font-medium">Total</th>
                <th className="text-right px-4 py-2 font-medium">Updated · 7d</th>
                <th className="text-right px-4 py-2 font-medium">New · 7d</th>
              </tr>
            </thead>
            <tbody>
              {s.byTaxon.map((t) => (
                <tr key={t.name} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-700">{t.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtCount(t.total)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-500">{fmtCount(t.updated ?? null)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-500">{fmtCount(t.new ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Surfaces — compact link grid */}
        <section>
          <div className="text-xs uppercase tracking-wide text-slate-500 font-medium mb-2">
            Explore
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {SURFACES.map((surf) => (
              <SurfaceLink key={surf.label} surface={surf} />
            ))}
          </div>
        </section>

        {/* About strip */}
        <section className="bg-white border border-slate-200 rounded px-4 py-3 text-sm text-slate-700 leading-relaxed">
          {COPY.about}
        </section>

        {/* Footer */}
        <footer className="text-xs text-slate-500 flex items-baseline gap-3">
          <span>Pavlidis Lab · UBC</span>
          <span className="text-slate-300">·</span>
          <a href={COPY.links.docs} className="text-indigo-600 hover:text-indigo-800" target="_blank" rel="noreferrer">Docs</a>
          <a href={COPY.links.rest} className="text-indigo-600 hover:text-indigo-800" target="_blank" rel="noreferrer">REST</a>
          <a href={COPY.links.github} className="text-indigo-600 hover:text-indigo-800" target="_blank" rel="noreferrer">GitHub</a>
        </footer>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-3xl font-semibold tabular-nums text-slate-900 mt-1">
        {value}
      </div>
      <div className="text-xs text-slate-500 mt-1">{hint}</div>
    </div>
  );
}

function SurfaceLink({ surface }: { surface: (typeof SURFACES)[number] }) {
  if (!surface.to) {
    return (
      <div className="bg-white border border-slate-200 rounded p-3 opacity-50 cursor-not-allowed">
        <div className="text-sm font-medium text-slate-500">{surface.label}</div>
        <div className="text-xs text-slate-400 leading-snug mt-0.5">
          {surface.blurb}
        </div>
      </div>
    );
  }
  return (
    <Link
      to={surface.to}
      className="block bg-white border border-slate-200 rounded p-3 hover:border-indigo-400 hover:shadow-sm hover:no-underline"
    >
      <div className="text-sm font-medium text-slate-900">{surface.label} →</div>
      <div className="text-xs text-slate-500 leading-snug mt-0.5">
        {surface.blurb}
      </div>
    </Link>
  );
}
