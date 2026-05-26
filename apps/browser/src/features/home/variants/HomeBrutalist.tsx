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

/**
 * Whitelist of ExperimentalFactor categories that are user-facing
 * on the public home page. Keys are the canonical Gemma category
 * label (lowercased) as it arrives from
 * ``factorValuesByCategory``. Values are the display label used in
 * the bar chart.
 *
 * Buckets not in this map are dropped (assay / BioSource / block /
 * labelling — curator-bookkeeping, not real experimental axes).
 * Multiple keys can map to the same display group when a natural
 * merge applies (e.g. ``molecular entity`` rolls into Treatment —
 * both are "what was applied to the sample").
 */
const FACTOR_CATEGORY_DISPLAY: Record<string, string> = {
  genotype: "Genotype",
  treatment: "Treatment",
  "molecular entity": "Treatment",
  disease: "Disease",
  "organism part": "Tissue",
  "cell type": "Cell type",
  strain: "Strain",
  "cell line": "Cell line",
  "developmental stage": "Developmental stage",
  age: "Age",
  "biological sex": "Sex",
};

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
          <div className="px-6 py-6 flex items-baseline gap-3">
            <span className="text-4xl leading-none font-bold tracking-tight">
              GEMMA
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-stone-600">
              Curated · re-analyzed
            </span>
          </div>
        </div>

        {/* Hero stats — 5 metrics + about column */}
        <StatsRow s={s} />

        {/* Recent-dataset marquee */}
        <Marquee items={s.recentDatasets} />

        {/* Two breakdowns side-by-side: taxon + technology */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-stone-950">
          <TaxonBreakdown rows={s.byTaxon} />
          <TechnologyBreakdown rows={s.byTechnology} totalCells={s.totalCells} />
        </div>

        {/* Concept stats — distinct ontology terms per slot */}
        <ConceptRow s={s} />

        {/* Factor values per category — compact bar chart */}
        <CategoryBars s={s} />

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
  // 6 primary tiles. Datasets / platforms / samples / genes ride on
  // the /stats/home snapshot (single homeLoading flag); DEA + the
  // ontology-term count have their own queries.
  const homeLoading = s.datasets === null && !s.isError;
  const resultSetsLoading = s.diffExResultSets === null && !s.isError;
  const ontologyLoading = s.ontologyTerms === null && !s.isError;
  return (
    <div className="grid grid-cols-2 md:grid-cols-12 gap-px bg-stone-950">
      <StatBlock label="Datasets" value={fmtCount(s.datasets, "full", homeLoading)} cols="md:col-span-2" />
      <StatBlock label="Platforms" value={fmtCount(s.platforms, "full", homeLoading)} cols="md:col-span-2" />
      <StatBlock label="Samples" value={fmtCount(s.samples, "full", homeLoading)} cols="md:col-span-2" />
      <StatBlock label="Genes" value={fmtCount(s.genes, "full", homeLoading)} cols="md:col-span-2" />
      <StatBlock label="DEA result sets" value={fmtCount(s.diffExResultSets, "full", resultSetsLoading)} cols="md:col-span-2" />
      <StatBlock
        label="Ontology terms"
        value={fmtCount(s.ontologyTerms, "full", ontologyLoading)}
        cols="md:col-span-2"
        hint="distinct ontology-backed terms used for annotation across the corpus (excludes free-text variants)"
      />
    </div>
  );
}

function ConceptRow({ s }: { s: GemmaSummary }) {
  // All six counts are URI-bound (excludeFreeText=true).
  // Source: /stats/home byAnnotationCategory in one snapshot —
  // strain + cell_line landed in bro's v3 daily-refresh.
  const c = s.byCategory;
  const loadingOf = (v: number | null) => v === null && !s.isError;
  return (
    <div className="border border-stone-950 bg-stone-100">
      <div className="px-5 py-3 border-b border-stone-300 text-[10px] uppercase tracking-[0.2em] text-stone-600">
        Annotation coverage · distinct ontology terms in use
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-px bg-stone-300">
        <Concept
          label="Treatments"
          value={fmtCount(c.drugs, "full", loadingOf(c.drugs))}
          hint="distinct ontology terms tagged as treatment (drugs, infections, exposures, etc.)"
        />
        <Concept
          label="Diseases"
          value={fmtCount(c.diseases, "full", loadingOf(c.diseases))}
          hint="distinct disease ontology terms used to annotate experiments"
        />
        <Concept
          label="Tissues"
          value={fmtCount(c.tissues, "full", loadingOf(c.tissues))}
          hint="distinct organism-part terms (typically UBERON)"
        />
        <Concept
          label="Cell types"
          value={fmtCount(c.cellTypes, "full", loadingOf(c.cellTypes))}
          hint="distinct cell-type terms (typically Cell Ontology / CL)"
        />
        <Concept
          label="Strains"
          value={fmtCount(c.strains, "full", loadingOf(c.strains))}
          hint="distinct strain ontology terms (common in mouse studies)"
        />
        <Concept
          label="Cell lines"
          value={fmtCount(c.cellLines, "full", loadingOf(c.cellLines))}
          hint="distinct cell-line ontology terms (CLO)"
        />
      </div>
    </div>
  );
}

function Concept({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-stone-100 px-4 py-3" title={hint}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-stone-600 mb-0.5">
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums tracking-tight text-stone-950">
        {value}
      </div>
    </div>
  );
}

function CategoryBars({ s }: { s: GemmaSummary }) {
  // Factor-values-per-category bar chart. Source:
  // /stats/home.factorValuesByCategory (bro's v2 wishlist landing).
  // Filter / merge against FACTOR_CATEGORY_DISPLAY so the chart
  // shows the ~8-10 user-facing experimental axes instead of
  // mixed-in curator-bookkeeping slots (assay / BioSource / block /
  // labelling) and the molecular-entity bucket that overlaps with
  // treatment.
  const merged = new Map<string, { uris: Set<string>; count: number }>();
  for (const row of s.factorValuesByCategory) {
    const key = row.category.trim().toLowerCase();
    const display = FACTOR_CATEGORY_DISPLAY[key];
    if (!display) continue; // drop bookkeeping + unknown categories
    const cur = merged.get(display) ?? { uris: new Set(), count: 0 };
    if (row.uri) cur.uris.add(row.uri);
    cur.count += row.count;
    merged.set(display, cur);
  }
  const rows = Array.from(merged.entries())
    .map(([label, v]) => ({
      label,
      count: v.count,
      uris: Array.from(v.uris),
    }))
    .sort((a, b) => b.count - a.count);

  const ready = rows.length > 0;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="border border-stone-950 bg-stone-100">
      <div className="px-4 py-1.5 border-b border-stone-300 text-[10px] uppercase tracking-[0.2em] text-stone-600 flex items-baseline justify-between">
        <span className="text-stone-900 font-semibold">
          Factor values per category
        </span>
        <span
          className="text-stone-500 normal-case tracking-normal text-[11px]"
          title="Distinct factor values existing under each ExperimentalFactor category across the public corpus."
        >
          experimental axes
        </span>
      </div>
      {ready ? (
        <ul>
          {rows.map((r) => (
            <CategoryBar key={r.label} label={r.label} count={r.count} max={max} />
          ))}
        </ul>
      ) : (
        <div className="px-4 py-3 text-stone-500 text-xs">
          {s.isLoading ? "loading…" : "no factor-value categories"}
        </div>
      )}
    </div>
  );
}

function CategoryBar({
  label,
  count,
  max,
}: {
  label: string;
  count: number;
  max: number;
}) {
  const pct = Math.max(0.5, (count / max) * 100);
  return (
    <li className="px-4 py-0.5 grid grid-cols-[8rem_1fr_3.5rem] items-center gap-2 text-xs">
      <span className="text-stone-800 truncate" title={label}>
        {label}
      </span>
      <div className="h-1.5 bg-stone-200 relative overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-blue-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-right tabular-nums text-stone-900 font-medium">
        {count.toLocaleString()}
      </span>
    </li>
  );
}


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

function TechnologyBreakdown({
  rows,
  totalCells,
}: {
  rows: TechnologyRow[];
  totalCells: number | null;
}) {
  const isLoading = rows.length === 0;
  // Format totalCells in millions for the Single-cell row footnote.
  // The number is a sum across all SC BioAssays; rendering raw would
  // dwarf the EE count visually. Show "· 12.3M cells" only when we
  // have a real number.
  const cellsLabel =
    totalCells !== null && totalCells > 0
      ? `${(totalCells / 1_000_000).toFixed(totalCells >= 10_000_000 ? 0 : 1)}M cells`
      : null;
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
                <td className="px-5 py-2 text-stone-800">
                  {r.label}
                  {r.label === "Single-cell" && cellsLabel ? (
                    <span className="ml-2 text-[11px] text-stone-500">
                      · {cellsLabel}
                    </span>
                  ) : null}
                </td>
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
