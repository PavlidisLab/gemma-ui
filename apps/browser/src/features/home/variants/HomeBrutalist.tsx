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
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { GENERAL_INFO, SURFACES } from "../copy";
import { Tooltip } from "@/components/ui/Tooltip";
import { useMe, useLogout } from "@/api/auth";
import { LoginModal } from "@/features/shared/LoginModal";
import { SearchBox } from "@/features/shared/SearchBox";
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
  // General-info section starts expanded on first load (per Paul);
  // power users can fold it away once they know what Gemma is.
  const [infoOpen, setInfoOpen] = useState(true);
  return (
    <div
      className="h-full overflow-y-auto bg-stone-100 text-stone-950"
      style={{ fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif' }}
    >
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-px">
        {/* Wordmark + tagline — single block, no inversion */}
        <Masthead />

        {/* Hero search — primary entry point to the corpus. */}
        <div className="px-1 pt-1 pb-2">
          <SearchBox
            variant="hero"
            placeholder="Search datasets — by name, accession, or gene…"
          />
        </div>

        {/* Hero stats — 5 metrics + about column */}
        <StatsRow s={s} />

        {/* Recent-dataset marquee */}
        <Marquee items={s.recentDatasets} />

        {/* General info — three columns. Collapsible so curators /
            API users can fold it away and focus on the breakdowns
            and charts below. */}
        <GeneralInfo open={infoOpen} onToggle={() => setInfoOpen((v) => !v)} />

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

        {/* Home-page footer strip removed 2026-05-26 — the shared
            <Footer> now carries the Pavlidis-lab attribution +
            Docs / REST / GitHub quick-links. The snapshot-date
            "stats as of …" hint moved to the (i) tooltips on the
            individual tiles, which is where it was most useful. */}
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
    .sort((a, b) => b.count - a.count)
    .slice(0, 10); // match sibling panels' row count

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
  // Cap at 10 so the panel matches its siblings in row count
  // (Factor values, Genes perturbed) and the bottoms line up.
  // Bro ships 10 buckets after splitting CHEBI drugs into
  // approved-drug / hormone / vitamin / toxin / vehicle / other-
  // chemical (plus pathogen / biologic / control-reference /
  // other). "Other chemicals" dominates today because the CHEBI
  // subtree expansion misses most treatment-tagged terms — flagged
  // for bro in a follow-up.
  const rows = s.treatmentSubcategories.slice(0, 10);
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
          title="Distinct ontology terms in the treatment annotation category, bucketed by CHEBI subtree / NCBITaxon (pathogens) / PR (biologics). Counts sum to byAnnotationCategory.treatment."
        >
          by chemical class
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
  // Cap at 10 to match the sibling panels in the row — all three
  // render the same row count so the bottoms line up. Paul: "make
  // it all fit and line up well".
  const rows = s.topPerturbedGenes.slice(0, 10);
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
  // One-at-a-time cross-fade ticker. Paul (2026-05-26): the
  // vertical credits-crawl had titles "disappearing into nowhere"
  // at the panel edges, distracting at peripheral vision. The
  // cross-fade replaces motion with a calm in/out at full opacity
  // — each item holds for ~4.5s then cross-fades to the next.
  // Hover pauses cycling; prefers-reduced-motion locks on item 0.
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const ready = items.length > 0;

  useEffect(() => {
    if (!ready || paused) return;
    if (typeof window !== "undefined" && window.matchMedia) {
      const m = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (m.matches) return;
    }
    const t = window.setInterval(
      () => setIdx((i) => (i + 1) % items.length),
      4500,
    );
    return () => window.clearInterval(t);
  }, [ready, paused, items.length]);

  // Clamp idx if items shrink between renders.
  const safeIdx = ready ? idx % items.length : 0;

  return (
    <div
      className="border border-stone-950 bg-stone-100"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
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
        <div className="relative h-9 px-5">
          {items.map((d, i) => (
            <Link
              key={d.id}
              to="/dataset/$id"
              params={{ id: d.shortName }}
              aria-hidden={i === safeIdx ? undefined : true}
              tabIndex={i === safeIdx ? 0 : -1}
              className={
                "absolute inset-x-5 inset-y-0 flex items-center text-stone-900 hover:text-blue-700 hover:no-underline whitespace-nowrap overflow-hidden transition-opacity duration-700 " +
                (i === safeIdx ? "opacity-100" : "opacity-0 pointer-events-none")
              }
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
      ) : (
        <div className="px-5 py-4 text-stone-500 text-sm">
          loading recent datasets…
        </div>
      )}
    </div>
  );
}

/**
 * Page-level masthead — replaces the standard AppBar on the home
 * route + the old wordmark block (Paul: those two duplicated the
 * brand mark on the home view). Layout:
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ GEMMA               [visual]            [auth][skin]      │
 *   │ Curated · re-analyzed                                     │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Visual area is a placeholder slot — a small decorative grid
 * standing in until design ships the real element.
 */
function Masthead() {
  const me = useMe();
  const user = me.data;
  const logout = useLogout();
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <div className="border-b border-stone-950 bg-stone-100">
      <div className="px-6 py-3 flex items-center gap-6 flex-wrap">
        {/* Brand mark — left */}
        <div className="flex items-baseline gap-3">
          <span className="text-5xl leading-none font-bold tracking-tight">
            GEMMA
          </span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-stone-600">
            Curated · re-analyzed
          </span>
        </div>

        {/* Visual element placeholder — middle. Stays unobtrusive
            until design swaps in something deliberate. */}
        <div className="flex-1 flex justify-center min-w-0">
          <VisualPlaceholder />
        </div>

        {/* Auth + skin — right */}
        <div className="flex items-center gap-3">
          {me.isPending && !me.data ? null : user ? (
            <span className="text-xs text-stone-600 inline-flex items-baseline gap-2">
              <span className="opacity-70">Signed in as</span>
              <span className="font-medium text-stone-900">
                {user.userName || user.email || "(signed in)"}
              </span>
              <button
                type="button"
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
                className="opacity-70 hover:opacity-100 bg-transparent border-none cursor-pointer disabled:cursor-progress p-0"
              >
                {logout.isPending ? "Signing out…" : "Sign out"}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              className="text-xs px-2.5 py-1 rounded bg-stone-900 text-stone-50 hover:bg-stone-800"
            >
              Sign in
            </button>
          )}
        </div>
      </div>
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}

/** Decorative grid placeholder for the masthead's middle slot.
 *  Six-by-three dots in the accent palette (orange / blue /
 *  emerald — the same three the GENERAL_INFO columns use). A
 *  faint hint of "annotation grid" without being a real chart.
 *  Swap in the real visual element when design ships it. */
function VisualPlaceholder() {
  const cols = 12;
  const rows = 3;
  // Stable deterministic pattern so the dots don't reshuffle on
  // re-render. Cycle through three colours by index.
  const COLOURS = ["#f97316", "#2563eb", "#10b981"]; // orange-500 / blue-700 / emerald-600
  const cells: { x: number; y: number; c: string; opacity: number }[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // Pseudo-random hash: skip ~40% of cells to break the grid
      // into a sparse, lacelike pattern.
      const h = (x * 31 + y * 17) % 100;
      if (h < 40) continue;
      cells.push({
        x,
        y,
        c: COLOURS[(x + y) % COLOURS.length]!,
        opacity: 0.45 + ((h - 40) / 60) * 0.55,
      });
    }
  }
  const cellW = 10;
  const cellH = 10;
  const dotR = 2.2;
  const w = cols * cellW;
  const h = rows * cellH;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w * 1.8}
      height={h * 1.8}
      aria-hidden="true"
      className="shrink-0 select-none"
      style={{ maxWidth: "100%" }}
    >
      {cells.map((cell) => (
        <circle
          key={`${cell.x}-${cell.y}`}
          cx={cell.x * cellW + cellW / 2}
          cy={cell.y * cellH + cellH / 2}
          r={dotR}
          fill={cell.c}
          opacity={cell.opacity}
        />
      ))}
    </svg>
  );
}

function GeneralInfo({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border border-stone-950 bg-stone-100">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="general-info-body"
        className="w-full flex items-baseline justify-between gap-3 px-5 py-2.5 text-[10px] uppercase tracking-[0.2em] text-stone-600 border-b border-stone-300 hover:bg-stone-50"
      >
        <span className="text-stone-900 font-semibold">About Gemma</span>
        <span className="text-stone-500 normal-case tracking-normal text-[11px]">
          {open ? "▾ hide" : "▸ show"}
        </span>
      </button>
      {open ? (
        <div
          id="general-info-body"
          className="grid grid-cols-1 md:grid-cols-3 gap-px bg-stone-300"
        >
          {/* Column 1 — identity / mission. */}
          <InfoColumn
            title={GENERAL_INFO.idea.title}
            accent={GENERAL_INFO.idea.accent}
          >
            <p className="text-[15px] font-semibold text-stone-900 leading-snug mb-3">
              {GENERAL_INFO.idea.lead}
            </p>
            <div className="space-y-2 text-sm text-stone-600 leading-relaxed">
              {GENERAL_INFO.idea.body.map((para) => (
                <p key={para}>{para}</p>
              ))}
            </div>
          </InfoColumn>

          {/* Column 2 — data + analysis catalogue. Two-column
              definition list: bold lead on the left, muted body on
              the right. Bullets dropped — the typography +
              grid alignment carry enough structure on their own. */}
          <InfoColumn
            title={GENERAL_INFO.provide.title}
            accent={GENERAL_INFO.provide.accent}
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm leading-snug">
              {GENERAL_INFO.provide.items.map((item) => (
                <div key={item.lead} className="contents">
                  <dt className="font-semibold text-stone-900 whitespace-nowrap">
                    {item.lead}
                  </dt>
                  <dd className="text-stone-600">{item.body}</dd>
                </div>
              ))}
            </dl>
          </InfoColumn>

          {/* Column 3 — access surfaces. Same compact dl pattern
              as Column 2: tag column on the left, link in the
              middle, muted hint on the right. Tight rows, no
              heavy filled chips — outlined tag at the same scale
              as the body text. */}
          <InfoColumn
            title={GENERAL_INFO.how.title}
            accent={GENERAL_INFO.how.accent}
          >
            <ul className="grid grid-cols-[2.5rem_auto_1fr] gap-x-3 gap-y-1 text-sm leading-snug">
              {GENERAL_INFO.how.items.map((item) => {
                const labelEl = (
                  <span className="font-semibold text-stone-900 group-hover:text-emerald-700 group-hover:underline">
                    {item.label}
                  </span>
                );
                return (
                  <li key={item.label} className="contents">
                    <span
                      aria-hidden="true"
                      className="text-[10px] font-mono font-semibold tracking-wide text-stone-500 self-baseline"
                    >
                      {item.tag}
                    </span>
                    {item.external ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        className="group inline-block"
                      >
                        {labelEl}
                      </a>
                    ) : (
                      <Link to={item.href} className="group inline-block">
                        {labelEl}
                      </Link>
                    )}
                    <span className="text-stone-500 text-xs self-baseline truncate">
                      {item.hint}
                    </span>
                  </li>
                );
              })}
            </ul>
          </InfoColumn>
        </div>
      ) : null}
    </div>
  );
}

/** Per-column accent — small coloured bar on the left edge +
 *  matching tinted title dot. Anchors the column visually
 *  without competing with the body content. Three accents:
 *  orange (identity), blue (data), emerald (action). */
function InfoColumn({
  title,
  accent,
  children,
}: {
  title: string;
  accent: "orange" | "blue" | "emerald";
  children: React.ReactNode;
}) {
  const accentClass =
    accent === "orange"
      ? "bg-orange-500"
      : accent === "blue"
        ? "bg-blue-700"
        : "bg-emerald-600";
  return (
    <div className="bg-stone-100 relative pl-5 pr-5 py-4">
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 bottom-0 w-1 ${accentClass}`}
      />
      <div className="text-[10px] uppercase tracking-[0.2em] text-stone-600 mb-3 flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-block w-2 h-2 ${accentClass}`}
        />
        <span className="text-stone-900 font-semibold">{title}</span>
      </div>
      {children}
    </div>
  );
}

// AccessTag (the heavy filled black chip) removed 2026-05-25 —
// Paul: "ugly, poor use of space". The access column now uses a
// flat 3-column grid with the tag rendered as muted mono text in
// line with the other text. Restore from commit af06461 if a
// chip-style treatment is ever wanted again.

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
