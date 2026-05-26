/**
 * Brutalist grid variant — sharp blocks, asymmetric layout.
 *
 * Design intent (v3 — richer stats + marquee, 2026-05-25):
 *   - Hero stats row: Datasets, Platforms, Samples, Result sets
 *     (DEA), Ontology terms — each in its own block.
 *   - Two split blocks below: taxon breakdown (top 6) and
 *     technology-type breakdown (single-cell / RNA-seq /
 *     microarray / other). Each block fills progressively as its
 *     query resolves — no whole-page block-on-slowest.
 *   - Scrolling marquee of recently-updated dataset short names
 *     under the stats, links into each dataset's detail page.
 *   - Hard 1px borders, no rounded corners, no shadows.
 *   - Single accent (blue-700) for hover affordances only.
 */

import { Link } from "@tanstack/react-router";
import { COPY, SURFACES } from "../copy";
import {
  useGemmaSummary,
  fmtCount,
  cleanExperimentTitle,
  type GemmaSummary,
  type TaxonRow,
  type TechnologyRow,
  type RecentDataset,
} from "../useGemmaSummary";

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

        {/* Hero stats — 5 metrics + about column */}
        <StatsRow s={s} />

        {/* Recent-dataset marquee */}
        <Marquee items={s.recentDatasets} />

        {/* Two breakdowns side-by-side: taxon + technology */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-stone-950">
          <TaxonBreakdown rows={s.byTaxon} />
          <TechnologyBreakdown rows={s.byTechnology} />
        </div>

        {/* Concept row removed 2026-05-25: the current
            /datasets/annotations/count endpoint counts free-text
            annotations alongside URI-bound ontology terms, so the
            global total (482K) and per-category counts (drugs /
            diseases / tissues / cell types) read wildly high to
            anyone who reads ontology as ontology. Restore when bro
            ships excludeFreeText=true on the count endpoint, or
            when /stats/home v2 carries ontologyTermCount +
            byAnnotationCategory.{disease, tissue, cellType, drug}.
            Filed in HOME_PAGE_STATS_FOLLOWUP_2026_05_25.md. The
            ConceptRow + Concept components are kept below for the
            restore. */}

        {/* Surface buttons */}
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
              {s.snapshotAt ? (
                <span
                  className="ml-3 normal-case tracking-normal text-stone-500"
                  title={`Numbers refresh daily — snapshot ${s.snapshotAt}`}
                >
                  · stats as of {new Date(s.snapshotAt).toLocaleDateString()}
                </span>
              ) : null}
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

function StatsRow({ s }: { s: GemmaSummary }) {
  // The 5 primary numbers from /stats/home + result-sets land
  // together as the corpus snapshot. Ontology-term tile is dropped
  // pending excludeFreeText on /datasets/annotations/count — the
  // current count includes free-text variants and reads wildly
  // high. See HOME_PAGE_STATS_FOLLOWUP_2026_05_25.md.
  const homeLoading = s.datasets === null && !s.isError;
  const resultSetsLoading = s.diffExResultSets === null && !s.isError;
  return (
    <div className="grid grid-cols-2 md:grid-cols-10 gap-px bg-stone-950">
      <StatBlock label="Datasets" value={fmtCount(s.datasets, "full", homeLoading)} cols="md:col-span-2" />
      <StatBlock label="Platforms" value={fmtCount(s.platforms, "full", homeLoading)} cols="md:col-span-2" />
      <StatBlock label="Samples" value={fmtCount(s.samples, "full", homeLoading)} cols="md:col-span-2" />
      <StatBlock label="Genes" value={fmtCount(s.genes, "full", homeLoading)} cols="md:col-span-2" />
      <StatBlock label="DEA result sets" value={fmtCount(s.diffExResultSets, "full", resultSetsLoading)} cols="md:col-span-2" />
    </div>
  );
}

// ConceptRow + Concept removed 2026-05-25 — see comment in the
// layout above. Restore from git when bro ships excludeFreeText on
// /datasets/annotations/count (or v2 of /stats/home folds in the
// per-category URI-only counts). The commit before this one
// (9294b49) is the last working version.

function TaxonBreakdown({ rows }: { rows: TaxonRow[] }) {
  return (
    <div className="bg-stone-100">
      <div className="px-5 py-3 border-b border-stone-300 text-[10px] uppercase tracking-[0.2em] text-stone-600">
        By organism
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((t) => (
            <tr key={t.name} className="border-t border-stone-200 first:border-t-0">
              <td className="px-5 py-2 text-stone-800">{t.name}</td>
              <td className="px-5 py-2 text-right tabular-nums font-semibold text-stone-950">
                {fmtCount(t.total, "full", t.total === null)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TechnologyBreakdown({ rows }: { rows: TechnologyRow[] }) {
  const isLoading = rows.length === 0;
  return (
    <div className="bg-stone-100">
      <div className="px-5 py-3 border-b border-stone-300 text-[10px] uppercase tracking-[0.2em] text-stone-600">
        By technology
      </div>
      <table className="w-full text-sm">
        <tbody>
          {isLoading ? (
            <tr>
              <td className="px-5 py-2 text-stone-400">…</td>
              <td className="px-5 py-2 text-right text-stone-400">…</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.label} className="border-t border-stone-200 first:border-t-0">
                <td className="px-5 py-2 text-stone-800">{r.label}</td>
                <td className="px-5 py-2 text-right tabular-nums font-semibold text-stone-950">
                  {fmtCount(r.count)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function Marquee({ items }: { items: RecentDataset[] }) {
  // One-line vertical "credits crawl" ticker per Paul (2026-05-25):
  // single visible row, titles slide upward at a slow steady pace,
  // hover pauses the loop, prefers-reduced-motion stops it entirely.
  // The horizontal variant ("barf") and the static grid were both
  // rejected — horizontal motion is queasy, the grid is dead weight.
  // Vertical-ticker direction matches reading flow + has the
  // contemplative-sign quality of a building marquee or end credits.
  const ready = items.length > 0;
  return (
    <div className="border border-stone-950 bg-stone-100">
      <div className="flex items-baseline justify-between gap-3 px-5 py-2 text-[10px] uppercase tracking-[0.2em] text-stone-600 border-b border-stone-300">
        <span className="text-stone-900 font-semibold">Recently updated</span>
        <Link
          to="/browser"
          className="text-stone-600 hover:text-blue-700 hover:no-underline"
        >
          see all →
        </Link>
      </div>
      {ready ? (
        <div className="ticker-wrap px-5">
          <div className="ticker-track">
            {[...items, ...items].map((d, i) => (
              <Link
                key={`${d.id}-${i}`}
                to="/dataset/$id"
                params={{ id: d.shortName }}
                className="ticker-item text-stone-900 hover:text-blue-700 hover:no-underline"
                title={`${d.shortName} — ${d.name}`}
              >
                <span className="text-sm truncate">
                  {cleanExperimentTitle(d.name)}
                </span>
                {d.taxonName ? (
                  <span className="text-stone-500 text-xs ml-3 shrink-0">
                    {d.taxonName}
                  </span>
                ) : null}
                <span className="font-mono text-[10px] text-stone-500 ml-3 shrink-0">
                  {d.shortName}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="px-5 py-4 text-stone-500 text-sm">
          loading recent datasets…
        </div>
      )}
    </div>
  );
}

function StatBlock({
  label,
  value,
  cols,
  hint,
}: {
  label: string;
  value: string;
  cols: string;
  hint?: string;
}) {
  return (
    <div className={`${cols} bg-stone-100 px-5 py-4`} title={hint}>
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

/* ─── Saved alternative: short-name-led marquee ──────────────────
 * Initial shape (2026-05-25) led with the GSE short name in mono,
 * with the taxon as a small muted tail. Paul rejected because the
 * accession is curator/API shorthand — meaningless to a public-site
 * visitor. Kept here so we can swap back behind a curator-mode
 * toggle later if a dedicated audience surfaces.
 *
 *   <span className="font-mono text-sm">{d.shortName}</span>
 *   {d.taxonName ? (
 *     <span className="text-stone-500 text-xs ml-1.5">
 *       {d.taxonName}
 *     </span>
 *   ) : null}
 */
