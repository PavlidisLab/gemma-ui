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

import type React from "react";
import { Link } from "@tanstack/react-router";
import { COPY, SURFACES } from "../copy";
import { Tooltip } from "@/components/ui/Tooltip";
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

        {/* Three-pane breakdown row: taxon + technology + reserve.
            Matches the bar-chart row's 1/3 + 2/3 split so the page
            has a consistent "left 2/3 narrative + right 1/3 future
            widget" rhythm. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-stone-950">
          <TaxonBreakdown rows={s.byTaxon} />
          <TechnologyBreakdown rows={s.byTechnology} totalCells={s.totalCells} />
          <div className="bg-stone-100" aria-hidden="true" />
        </div>

        {/* Concept stats — distinct ontology terms per slot */}
        <ConceptRow s={s} />

        {/* Three-pane data row: factor values · perturbed genes ·
            treatment subcategories. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-stone-950">
          <CategoryBars s={s} />
          <PerturbedGenesBars s={s} />
          <TreatmentSubcategoryBars s={s} />
        </div>

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
  // 6 primary tiles. Samples + Genes nest a secondary breakdown
  // under the headline number (footnote prop) instead of claiming
  // additional tiles for samplesByTech / geneManipulated.
  const homeLoading = s.datasets === null && !s.isError;
  const ontologyLoading = s.ontologyTerms === null && !s.isError;

  const samplesFootnote = (() => {
    const t = s.samplesByTech;
    const parts: string[] = [];
    if (t.singleCell !== null && t.singleCell > 0)
      parts.push(`single-cell ${fmtCount(t.singleCell, "compact")}`);
    if (t.rnaSeq !== null && t.rnaSeq > 0)
      parts.push(`RNA-seq ${fmtCount(t.rnaSeq, "compact")}`);
    if (t.microarray !== null && t.microarray > 0)
      parts.push(`microarray ${fmtCount(t.microarray, "compact")}`);
    return parts.length > 0 ? parts.join(" · ") : null;
  })();

  // Datasets footnote — Paul (2026-05-25): drop the per-source
  // breakdown ("99.9% from GEO anyway, the breakdown isn't
  // informative"). Render just a single "from N distinct
  // accessions" line. That count is NOT what
  // datasetsByAccessionSource sums to (which is the per-source
  // dataset count, same total as datasetCount — see the 1:N split
  // hint). It needs a separate distinctAccessionCount field on
  // /stats/home — filed as a follow-up ask. Until then the
  // footnote stays null and the tile shows just the headline.
  const datasetsFootnote = (() => {
    const n = s.distinctAccessionCount;
    if (n === null || n <= 0) return null;
    return `from ${n.toLocaleString()} distinct accessions`;
  })();

  const perturbedFootnote = (() => {
    const e = s.geneManipulatedExperiments;
    if (e !== null && e > 0) {
      return `across ${fmtCount(e, "compact")} experiments`;
    }
    return null;
  })();

  return (
    <div className="grid grid-cols-2 md:grid-cols-12 gap-px bg-stone-950">
      <StatBlock
        label="Datasets"
        value={fmtCount(s.datasets, "full", homeLoading)}
        cols="md:col-span-2"
        footnote={datasetsFootnote}
        hint="Public expression experiments in Gemma. The footnote shows the number of distinct external accessions behind the corpus — slightly smaller than the dataset count because Gemma sometimes splits one GEO submission into two experiments when the submission actually contains two distinct studies. Almost all are from GEO (the per-source breakdown isn't shown because it's ≈99.9% GEO)."
      />
      <StatBlock
        label="Platforms"
        value={fmtCount(s.platforms, "full", homeLoading)}
        cols="md:col-span-2"
        hint="Distinct microarray + sequencing platforms (array designs) referenced by at least one dataset."
      />
      <StatBlock
        label="Samples"
        value={fmtCount(s.samples, "full", homeLoading)}
        cols="md:col-span-2"
        footnote={samplesFootnote}
        hint="Total biomaterials across all public experiments. Footnote splits samples by the technology that produced them (single-cell vs. bulk RNA-seq vs. microarray)."
      />
      <StatBlock
        label="Genes perturbed"
        value={fmtCount(s.geneManipulated, "full", homeLoading)}
        cols="md:col-span-2"
        footnote={perturbedFootnote}
        hint="Distinct genes annotated as perturbation targets across the corpus — knockouts, knockdowns, overexpression. The total-genes-in-the-database number isn't meaningful (Gemma carries every gene from every supported taxon's reference); the perturbation count is what reflects experimental coverage."
      />
      <StatBlock
        label="DEA contrasts"
        value={fmtCount(
          s.diffExContrasts ?? s.diffExResultSets,
          "full",
          (s.diffExContrasts ?? s.diffExResultSets) === null && !s.isError,
        )}
        cols="md:col-span-2"
        footnote={
          s.diffExContrasts !== null && s.diffExResultSets !== null
            ? `${fmtCount(s.diffExResultSets, "compact")} result sets`
            : null
        }
        hint="Differential-expression contrasts Gemma has computed across all public datasets. Each contrast is one pairwise comparison (e.g. 'diseased vs. control'); a single result set typically carries several contrasts (one per factor-value pair). Footnote shows the result-set count for orientation."
      />
      <StatBlock
        label="Ontology terms"
        value={fmtCount(s.ontologyTerms, "full", ontologyLoading)}
        cols="md:col-span-2"
        hint="Distinct ontology-backed terms used to annotate the corpus. Free-text variants (un-resolved strings) are excluded."
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
      <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-stone-300">
        <Concept
          label="Treatments"
          value={fmtCount(c.drugs, "full", loadingOf(c.drugs))}
          hint="Distinct ontology terms tagged as treatment — drugs, pathogens, biologics, and other exposures. See the Treatment subcategories chart below for the breakdown."
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

// TreatmentBreakdown (the rich tooltip body) removed 2026-05-25
// when the Treatment-subcategories chart moved to its own panel
// in the bar-chart row — keeping it on the tile would duplicate
// the same data twice on the page. Restore from commit 22d70cc
// if a collapsed-tooltip view is ever wanted.

function Concept({
  label,
  value,
  hint,
  hintAria,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  hintAria?: string;
}) {
  return (
    <div className="bg-stone-100 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-stone-600 mb-0.5 flex items-center">
        <span>{label}</span>
        {hint ? <InfoBadge hint={hint} ariaLabel={hintAria} /> : null}
      </div>
      <div className="text-xl font-semibold tabular-nums tracking-tight text-stone-950">
        {value}
      </div>
    </div>
  );
}

function CategoryBars({ s }: { s: GemmaSummary }) {
  // Factor-values-per-category bar chart. Source:
  // /stats/home.factorValuesByCategory. Filter / merge against
  // FACTOR_CATEGORY_DISPLAY so the chart shows the ~8-10 user-
  // facing experimental axes only.
  //
  // Each row also picks up an EE-coverage tag from
  // categoryDistribution (bar carries FV depth; tag carries EE
  // breadth). The two distributions are independently sourced; we
  // join on category URI primarily, label as fallback.
  const eeByUri = new Map<string, number>();
  const eeByLabel = new Map<string, number>();
  for (const c of s.categoryDistribution) {
    if (c.categoryUri) eeByUri.set(c.categoryUri, c.numberOfExpressionExperiments);
    if (c.category)
      eeByLabel.set(
        c.category.trim().toLowerCase(),
        c.numberOfExpressionExperiments,
      );
  }

  const merged = new Map<
    string,
    { uris: Set<string>; sourceLabels: Set<string>; count: number }
  >();
  for (const row of s.factorValuesByCategory) {
    const key = row.category.trim().toLowerCase();
    const display = FACTOR_CATEGORY_DISPLAY[key];
    if (!display) continue;
    const cur =
      merged.get(display) ??
      { uris: new Set<string>(), sourceLabels: new Set<string>(), count: 0 };
    if (row.uri) cur.uris.add(row.uri);
    cur.sourceLabels.add(key);
    cur.count += row.count;
    merged.set(display, cur);
  }

  // Resolve EE coverage per displayed group. When multiple source
  // categories merged into one group (e.g. molecular entity →
  // Treatment), take the max EE count — summing would double-count
  // experiments tagged with both.
  const rows = Array.from(merged.entries())
    .map(([label, v]) => {
      let ee = 0;
      for (const uri of v.uris) {
        const x = eeByUri.get(uri);
        if (x !== undefined && x > ee) ee = x;
      }
      if (ee === 0) {
        for (const lbl of v.sourceLabels) {
          const x = eeByLabel.get(lbl);
          if (x !== undefined && x > ee) ee = x;
        }
      }
      return { label, count: v.count, ee: ee > 0 ? ee : null };
    })
    .sort((a, b) => b.count - a.count);

  const ready = rows.length > 0;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="bg-stone-100">
      <div className="px-4 py-1.5 border-b border-stone-300 text-[10px] uppercase tracking-[0.2em] text-stone-600 flex items-baseline justify-between gap-2">
        <span className="text-stone-900 font-semibold">
          Factor values per category
        </span>
        <span
          className="text-stone-500 normal-case tracking-normal text-[11px] truncate"
          title="Bar: distinct factor values existing under each ExperimentalFactor category. Tag: experiments using any annotation in that category — depth vs breadth."
        >
          bar = FV depth · tag = EE breadth
        </span>
      </div>
      {ready ? (
        <ul>
          {rows.map((r) => (
            <CategoryBar
              key={r.label}
              label={r.label}
              count={r.count}
              ee={r.ee}
              max={max}
            />
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

function TreatmentSubcategoryBars({ s }: { s: GemmaSummary }) {
  // Right-third bar chart: the four treatment sub-buckets shipped
  // by bro (drug / pathogen / biologic / other). Same compact bar
  // shape as the sibling charts. Sums to byAnnotationCategory.
  // treatment — total tile up top stays the headline number.
  const rows = s.treatmentSubcategories;
  const ready = rows.length > 0;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="bg-stone-100">
      <div className="px-4 py-1.5 border-b border-stone-300 text-[10px] uppercase tracking-[0.2em] text-stone-600 flex items-baseline justify-between gap-2">
        <span className="text-stone-900 font-semibold">
          Treatment subcategories
        </span>
        <span
          className="text-stone-500 normal-case tracking-normal text-[11px] truncate"
          title="Distinct ontology terms in the treatment annotation category, partitioned by URI prefix (CHEBI → drugs; NCBITaxon → pathogens; PR → biologics; everything else → other)."
        >
          drug · pathogen · biologic · other
        </span>
      </div>
      {ready ? (
        <ul>
          {rows.map((r) => {
            const pct = Math.max(0.5, (r.count / max) * 100);
            return (
              <li
                key={r.key}
                className="px-4 py-0.5 grid grid-cols-[6.5rem_minmax(0,1fr)_max-content] items-center gap-2 text-xs"
              >
                <span className="text-stone-800 truncate" title={r.label}>
                  {r.label}
                </span>
                <div className="h-1.5 bg-stone-200 relative overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-blue-700"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-right tabular-nums text-stone-900 font-medium whitespace-nowrap">
                  {r.count.toLocaleString()}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-4 py-3 text-stone-500 text-xs">
          pending /stats/home refresh
        </div>
      )}
    </div>
  );
}

function PerturbedGenesBars({ s }: { s: GemmaSummary }) {
  // Middle-third bar chart: top perturbed genes by number of
  // experiments. Source: /stats/home.topPerturbedGenes (filed in
  // HOME_PAGE_PERTURBED_GENES_2026_05_25.md — not yet shipped).
  // Until the field lands the panel renders a placeholder so the
  // 3-col layout has visual mass and the page communicates the
  // intent. Empty-state header line keeps the slot honest.
  const rows = s.topPerturbedGenes.slice(0, 12);
  const ready = rows.length > 0;
  const max = Math.max(1, ...rows.map((r) => r.numberOfExpressionExperiments));
  return (
    <div className="bg-stone-100">
      <div className="px-4 py-1.5 border-b border-stone-300 text-[10px] uppercase tracking-[0.2em] text-stone-600 flex items-baseline justify-between gap-2">
        <span className="text-stone-900 font-semibold">Genes perturbed</span>
        <span
          className="text-stone-500 normal-case tracking-normal text-[11px] truncate"
          title="Top perturbed genes by number of experiments they're annotated in as a perturbation target (knockouts, knockdowns, overexpression)."
        >
          most-studied
        </span>
      </div>
      {ready ? (
        <ul>
          {rows.map((r) => {
            const pct = Math.max(
              0.5,
              (r.numberOfExpressionExperiments / max) * 100,
            );
            return (
              <li
                key={`${r.geneSymbol}-${r.taxon ?? ""}`}
                className="px-4 py-0.5 grid grid-cols-[6.5rem_minmax(0,1fr)_max-content] items-center gap-2 text-xs"
              >
                <span
                  className="text-stone-800 truncate font-medium italic"
                  title={r.taxon ? `${r.geneSymbol} (${r.taxon})` : r.geneSymbol}
                >
                  {r.geneSymbol}
                </span>
                <div className="h-1.5 bg-stone-200 relative overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-blue-700"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-right tabular-nums text-stone-900 font-medium whitespace-nowrap">
                  {r.numberOfExpressionExperiments.toLocaleString()}
                  <span className="ml-1 text-stone-500 font-normal">EEs</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-4 py-3 text-stone-500 text-xs">
          pending /stats/home field
        </div>
      )}
    </div>
  );
}

function CategoryBar({
  label,
  count,
  ee,
  max,
}: {
  label: string;
  count: number;
  ee: number | null;
  max: number;
}) {
  const pct = Math.max(0.5, (count / max) * 100);
  return (
    <li className="px-4 py-0.5 grid grid-cols-[6.5rem_minmax(0,1fr)_max-content] items-center gap-2 text-xs">
      <span className="text-stone-800 truncate" title={label}>
        {label}
      </span>
      <div className="h-1.5 bg-stone-200 relative overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-blue-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-right tabular-nums text-stone-900 whitespace-nowrap">
        <span className="font-medium">{count.toLocaleString()}</span>
        {ee !== null ? (
          <span className="ml-1.5 text-stone-500 font-normal">
            · {fmtCount(ee, "compact")} EEs
          </span>
        ) : null}
      </span>
    </li>
  );
}


function TaxonBreakdown({ rows }: { rows: TaxonRow[] }) {
  return (
    <div className="bg-stone-100">
      <div className="px-5 py-3 border-b border-stone-300 text-[10px] uppercase tracking-[0.2em] text-stone-600">
        Datasets by taxon
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
        Samples by technology
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
  hintAria,
  footnote,
}: {
  label: string;
  value: string;
  cols: string;
  hint?: React.ReactNode;
  /** Plain-text aria-label when ``hint`` is a node. */
  hintAria?: string;
  /** Tiny muted line under the headline number. Used to nest a
   *  secondary breakdown (e.g. samplesByTech under Samples,
   *  perturbed-genes under Genes) without claiming a new tile. */
  footnote?: React.ReactNode;
}) {
  // Reserve min-height for the label + footnote slots so values
  // sit on the same horizontal baseline across the row regardless
  // of whether a particular label wraps to two lines (e.g. "GENES
  // PERTURBED") or whether a tile has a footnote at all. mt-auto
  // on the footnote slot pins it to the bottom of the flex column
  // so empty-footnote tiles match the height of populated ones.
  return (
    <div className={`${cols} bg-stone-100 px-5 py-4 flex flex-col`}>
      <div className="text-[10px] uppercase tracking-[0.2em] text-stone-600 mb-1 flex items-center min-h-[2.4em]">
        <span>{label}</span>
        {hint ? <InfoBadge hint={hint} ariaLabel={hintAria} /> : null}
      </div>
      <div className="text-3xl font-semibold tabular-nums tracking-tight text-stone-950">
        {value}
      </div>
      <div className="mt-auto pt-1 text-[10px] text-stone-500 leading-snug min-h-[2.6em]">
        {footnote ?? null}
      </div>
    </div>
  );
}

/** Small ``i`` glyph next to a tile label — hoverable affordance
 *  for the explanation. Wrapped in the shared Tooltip component
 *  (60ms open delay, portal-mounted, stone-900 bubble) instead of
 *  the browser-default ``title=`` which has a ~700ms open delay
 *  Paul (and everyone) finds frustrating. Sized to match the 10px
 *  label text so it doesn't compete visually.
 *  No ``cursor-help`` — that yields the macOS circle-with-question-
 *  mark cursor which Paul (correctly) flagged as visual noise.
 *  The (i) glyph + bubble tooltip is affordance enough. */
function InfoBadge({
  hint,
  ariaLabel,
}: {
  /** Tooltip body. Accept ReactNode so callers can pass a rich
   *  layout (e.g. a small ranked list) for tiles that benefit from
   *  structured content. */
  hint: React.ReactNode;
  /** Plain-text fallback for screen readers + aria. Required when
   *  ``hint`` is a node; ignored otherwise. */
  ariaLabel?: string;
}) {
  const a11y =
    ariaLabel ?? (typeof hint === "string" ? hint : "more info");
  return (
    <Tooltip label={hint}>
      <span
        role="img"
        aria-label={a11y}
        tabIndex={0}
        className="ml-1.5 inline-flex items-center justify-center w-3 h-3 rounded-full border border-stone-400 text-stone-500 text-[8px] leading-none select-none normal-case tracking-normal font-medium hover:border-stone-700 hover:text-stone-800 focus:outline-none focus:ring-1 focus:ring-stone-600"
      >
        i
      </span>
    </Tooltip>
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
