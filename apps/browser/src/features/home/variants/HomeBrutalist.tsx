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
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { GENERAL_INFO } from "../copy";
import { Tooltip } from "@/components/ui/Tooltip";
import { useMe, useLogout } from "@/api/auth";
import { getDatasetAnnotations } from "@/api/endpoints";
import { LoginModal } from "@/features/shared/LoginModal";
import { AboutModal } from "@/features/about/AboutModal";
import { SearchBox } from "@/features/shared/SearchBox";
import { gemmaLogoText, ubcLogo } from "@gemma/assets";
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
  // General-info section starts expanded on first load (per design review);
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

        {/* General info — three columns. Collapsible so curators /
            API users can fold it away and focus on the breakdowns
            and charts below. */}
        <GeneralInfo open={infoOpen} onToggle={() => setInfoOpen((v) => !v)} />

        {/* Two cycling boxes in one row. Left rotates through the
            corpus breakdowns (taxon · technology · annotation coverage
            · recently updated); right rotates through the distribution
            plots (factor values · perturbed genes · treatment
            subcategories). Both auto-rotate (pause on hover, honour
            prefers-reduced-motion); dots + arrows jump manually. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px">
          <CyclingBox
            titles={[
              "Datasets by taxon",
              "Samples by technology",
              "Annotation coverage",
              "Recently updated",
            ]}
            panes={[
              <TaxonBreakdown key="taxon" rows={s.byTaxon} />,
              <TechnologyBreakdown
                key="tech"
                rows={s.byTechnology}
                totalCells={s.totalCells}
              />,
              <AnnotationCoverageBreakdown key="annotation" s={s} />,
              <RecentlyUpdatedCard key="recent" items={s.recentDatasets} />,
            ]}
          />
          <CyclingBox
            titles={[
              "Factor values per category",
              "Top genes perturbed",
              "Treatment subcategories",
            ]}
            panes={[
              <CategoryBars key="category" s={s} />,
              <PerturbedGenesBars key="perturbed" s={s} />,
              <TreatmentSubcategoryBars key="treatment" s={s} />,
            ]}
          />
        </div>

        {/* Surface buttons removed 2026-05-26 — the reviewer: redundant with
            the stat tiles up top. Datasets / Platforms / Genes
            perturbed tiles are now hot links to /browser /
            /platforms / /genes. About lives on the Masthead. */}

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
  // 5 primary tiles. Samples nests a per-technology breakdown
  // under the headline number (footnote prop) instead of claiming
  // an extra tile for samplesByTech. Perturbed-gene coverage lives
  // in the annotation-coverage breakdown below — surfacing it again here would
  // double-count and the gene-search link this tile used to carry
  // resolved to the general gene search, which was confusing.
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

  // Datasets footnote — the reviewer (2026-05-25): drop the per-source
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

  return (
    <div className="grid grid-cols-2 md:grid-cols-10 gap-px bg-stone-950">
      <StatBlock
        label="Datasets"
        value={fmtCount(s.datasets, "full", homeLoading)}
        cols="md:col-span-2"
        footnote={datasetsFootnote}
        to="/browser"
        hint="Public expression experiments in Gemma. The footnote shows the number of distinct external accessions behind the corpus — slightly smaller than the dataset count because Gemma sometimes splits one GEO submission into two experiments when the submission actually contains two distinct studies. Almost all are from GEO (the per-source breakdown isn't shown because it's ≈99.9% GEO)."
      />
      <StatBlock
        label="Platforms"
        value={fmtCount(s.platforms, "full", homeLoading)}
        cols="md:col-span-2"
        to="/platforms"
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

function CyclingBox({
  titles,
  panes,
}: {
  // Parallel arrays — titles[i] labels panes[i] (used for the dot
  // aria-labels). Kept as props so one component drives every home-page
  // carousel (breakdowns on the left, distribution plots on the right).
  titles: readonly string[];
  panes: React.ReactNode[];
}) {
  // One box that cycles through its panes instead of laying them out
  // side-by-side. Auto-advances every 7 s; hover pauses,
  // prefers-reduced-motion locks on pane 0. Dots + arrows jump
  // manually. Panes with their own inner cycle (e.g. RecentlyUpdated's
  // 5 s dataset rotation) only run while they're the mounted pane.
  const n = panes.length;
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const go = (i: number) => setIdx(((i % n) + n) % n);

  useEffect(() => {
    if (paused) return;
    if (typeof window !== "undefined" && window.matchMedia) {
      const m = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (m.matches) return;
    }
    const t = window.setInterval(() => setIdx((i) => (i + 1) % n), 7000);
    return () => window.clearInterval(t);
  }, [paused, n]);

  return (
    <div
      className="flex flex-col h-full border border-stone-950 bg-stone-100"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* flex-1 + min-height keeps the box from jumping as it cycles
          between panes of different lengths, and lets side-by-side
          boxes stretch to a shared row height. Shorter panes sit at
          the top. */}
      <div className="flex-1 min-h-[15rem]">{panes[idx]}</div>
      <div className="flex items-center justify-between border-t border-stone-300 px-4 py-2">
        <button
          type="button"
          onClick={() => go(idx - 1)}
          aria-label="Previous"
          className="px-2 py-0.5 text-stone-500 hover:text-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-600"
        >
          ←
        </button>
        <div className="flex items-center gap-2">
          {panes.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              aria-label={`Show ${titles[i]}`}
              aria-current={i === idx}
              className={`w-2 h-2 border border-stone-500 transition-colors focus:outline-none focus:ring-1 focus:ring-stone-600 ${
                i === idx
                  ? "bg-stone-900 border-stone-900"
                  : "bg-transparent hover:border-stone-800"
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => go(idx + 1)}
          aria-label="Next"
          className="px-2 py-0.5 text-stone-500 hover:text-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-600"
        >
          →
        </button>
      </div>
    </div>
  );
}

function AnnotationCoverageBreakdown({ s }: { s: GemmaSummary }) {
  // Eight URI-bound counts (excludeFreeText=true), rendered as a
  // label/value list matching the taxon + technology breakdowns.
  // Five come from /stats/home byAnnotationCategory (disease /
  // organism_part / cell_type / strain / cell_line); the other three
  // pull from siblings on the same snapshot — drugCount (CHEBI subset
  // of treatment), geneManipulatedCount (perturbed gene URIs), and the
  // pathogen sub-bucket termCount inside treatmentSubcategories.
  const c = s.byCategory;
  const loadingOf = (v: number | null) => v === null && !s.isError;
  const pathogens =
    s.treatmentSubcategories.find((t) => t.key === "pathogen")?.termCount ??
    null;
  type Row = { label: string; value: number | null; hint: string };
  // Two ordered columns (the design review's grouping): anatomical / model-system
  // terms on the left, disease / exposure / perturbation terms on the
  // right.
  const columns: Row[][] = [
    [
      {
        label: "Tissues",
        value: c.tissues,
        hint: "distinct organism-part terms (typically UBERON)",
      },
      {
        label: "Cell types",
        value: c.cellTypes,
        hint: "distinct cell-type terms (typically Cell Ontology / CL)",
      },
      {
        label: "Cell lines",
        value: c.cellLines,
        hint: "distinct cell-line ontology terms (CLO)",
      },
      {
        label: "Strains",
        value: c.strains,
        hint: "distinct strain ontology terms (common in mouse studies)",
      },
    ],
    [
      {
        label: "Diseases",
        value: c.diseases,
        hint: "distinct disease ontology terms used to annotate experiments",
      },
      {
        label: "Pathogens",
        value: pathogens,
        hint: "Distinct NCBITaxon pathogen annotations (viruses, bacteria, parasites) used in infection / immune-response studies — a sub-bucket of the broader Treatment category.",
      },
      {
        label: "Approved drugs",
        value: s.drugs,
        hint: "Distinct CHEBI-anchored drug / chemical annotations. Narrower than the full Treatment category (which also includes pathogens, biologics, and other exposures).",
      },
      {
        label: "Perturbed genes",
        value: s.geneManipulated,
        hint: "Distinct gene URIs annotated as perturbation targets across the corpus — knockouts, knockdowns, overexpression.",
      },
    ],
  ];
  return (
    <div className="bg-stone-100">
      <div className="px-5 py-3 border-b border-stone-300 text-[10px] uppercase tracking-[0.2em] text-stone-600">
        Annotation coverage · distinct ontology terms in use
      </div>
      <div className="grid grid-cols-2 gap-px bg-stone-300">
        {columns.map((col, ci) => (
          <table key={ci} className="w-full text-sm bg-stone-100">
            <tbody>
              {col.map((r) => (
                <tr
                  key={r.label}
                  className="border-t border-stone-200 first:border-t-0"
                >
                  <td className="px-4 py-2 text-stone-800">
                    <span className="inline-flex items-center">
                      {r.label}
                      <InfoBadge hint={r.hint} />
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-stone-950">
                    {fmtCount(r.value, "full", loadingOf(r.value))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
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
          title="Factor-value occurrences per ExperimentalFactor category — each experiment defines its own FactorValue records (so Sex shows thousands of occurrences, not two), and the bar reflects how heavily a category is used across the corpus."
        >
          occurrences
        </span>
      </div>
      {ready ? (
        <ul>
          {rows.map((r) => (
            <CategoryBar
              key={r.label}
              label={r.label}
              count={r.count}
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
  // Right-third bar chart: the treatment sub-buckets shipped by
  // the agents side (approved-drug / hormone / vitamin / toxin / vehicle /
  // other-chemical / pathogen / biologic / control-reference /
  // other). Sums to byAnnotationCategory.treatment.
  //
  // Drop the ``control`` group (Control / reference, Vehicles /
  // solvents) — those dominate the count but carry no biological
  // signal; surfacing them on the home page just buries the real
  // pharmacology / biological buckets and pushes "control" to the
  // top of the chart, which is misleading. Group field comes from
  // the agents-side treatmentSubcategories.group ("control" / "pharmacology"
  // / "biological" / "unclassified"). Then cap at 10 so the panel
  // matches its siblings in row count and bottoms line up.
  const rows = s.treatmentSubcategories
    .filter((r) => r.group !== "control")
    .slice(0, 10);
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
          title="Experiments using any annotation in each treatment sub-bucket. Buckets span CHEBI chemicals (approved drugs, hormones, toxins, vitamins, other chemicals), NCBITaxon pathogens, PR / NCBI-gene biologics, and an unclassified ``other`` catch-all. Control / reference and vehicle / solvent buckets are filtered out — they dominate the count but carry no biological signal."
        >
          experiments
        </span>
      </div>
      {ready ? (
        <ul>
          {rows.map((r) => {
            const pct = Math.max(0.5, (r.count / max) * 100);
            // Rich title= tooltip carries the new data (top terms +
            // approved_drug therapeutic-class breakdown) without
            // changing row height — keeps alignment with the sibling
            // CategoryBars / PerturbedGenesBars panels.
            const tooltipLines: string[] = [r.label];
            if (r.topTerms.length > 0) {
              tooltipLines.push(
                "",
                `Top terms (${r.topTerms.length}):`,
                ...r.topTerms
                  .slice(0, 10)
                  .map(
                    (t) =>
                      `  • ${t.label} — ${t.count.toLocaleString()} experiments`,
                  ),
              );
            }
            if (r.subBuckets.length > 0) {
              tooltipLines.push(
                "",
                `Therapeutic-class breakdown (${r.subBuckets.length}):`,
                ...r.subBuckets.map(
                  (b) =>
                    `  • ${b.label} — ${b.count.toLocaleString()} experiments`,
                ),
              );
            }
            return (
              <li
                key={r.key}
                className="px-4 py-0.5 grid grid-cols-[6.5rem_minmax(0,1fr)_max-content] items-center gap-2 text-xs"
                title={tooltipLines.join("\n")}
              >
                <span className="text-stone-800 truncate">{r.label}</span>
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
  // render the same row count so the bottoms line up. The reviewer: "make
  // it all fit and line up well".
  const rows = s.topPerturbedGenes.slice(0, 10);
  const ready = rows.length > 0;
  const max = Math.max(1, ...rows.map((r) => r.numberOfExpressionExperiments));
  return (
    <div className="bg-stone-100">
      <div className="px-4 py-1.5 border-b border-stone-300 text-[10px] uppercase tracking-[0.2em] text-stone-600 flex items-baseline justify-between gap-2">
        <span className="text-stone-900 font-semibold">
          Top genes perturbed
        </span>
        <span
          className="text-stone-500 normal-case tracking-normal text-[11px] truncate"
          title="Top perturbed genes by number of experiments they're annotated in as a perturbation target (knockouts, knockdowns, overexpression)."
        >
          experiments
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
  max,
}: {
  label: string;
  count: number;
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
      <span className="text-right tabular-nums text-stone-900 font-medium whitespace-nowrap">
        {count.toLocaleString()}
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

/** User-facing annotation categories to surface as chips in the
 *  Recently-updated card. Anything not in this set is dropped —
 *  Gemma's annotation surface includes a lot of bookkeeping
 *  category labels that aren't interesting to a public visitor. */
const RECENT_CARD_ANNOTATION_CATEGORIES = new Set([
  "disease",
  "organism part",
  "cell type",
  "treatment",
  "genotype",
  "strain",
  "cell line",
  "developmental stage",
  "biological sex",
]);

function RecentlyUpdatedCard({ items }: { items: RecentDataset[] }) {
  // One-at-a-time card showing the most recently updated experiment.
  // Cycles through the top-50 every 5 s. Hover pauses;
  // prefers-reduced-motion locks on item 0. Annotation chips fetched
  // lazily for the current experiment via /datasets/{id}/annotations
  // — React Query caches per id so re-visiting one is free.
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
      5000,
    );
    return () => window.clearInterval(t);
  }, [ready, paused, items.length]);

  const current = ready ? items[idx % items.length] : null;

  const annsQ = useQuery({
    queryKey: ["dataset-annotations", current?.id ?? 0],
    queryFn: ({ signal }) =>
      current ? getDatasetAnnotations(current.id, signal) : Promise.resolve(null),
    enabled: !!current,
    staleTime: 10 * 60_000,
  });

  const chips = useMemo(() => {
    const rows = annsQ.data?.data ?? [];
    const seen = new Set<string>();
    const out: Array<{ category: string; term: string }> = [];
    for (const a of rows) {
      const cat = (a.className ?? "").trim().toLowerCase();
      if (!RECENT_CARD_ANNOTATION_CATEGORIES.has(cat)) continue;
      const term = (a.termName ?? "").trim();
      if (!term) continue;
      const key = `${cat}|${term.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ category: cat, term });
      if (out.length >= 5) break;
    }
    return out;
  }, [annsQ.data]);

  return (
    <div
      className="bg-stone-100"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex items-baseline justify-between gap-3 px-5 py-3 text-[10px] uppercase tracking-[0.2em] text-stone-600 border-b border-stone-300">
        <span className="text-stone-900 font-semibold">Recently updated</span>
        <Link
          to="/browser"
          search={{ sort: "-lastUpdated" }}
          className="text-stone-600 hover:text-blue-700 hover:no-underline normal-case tracking-normal text-[11px]"
        >
          see all →
        </Link>
      </div>
      {current ? (
        <Link
          key={current.id}
          to="/dataset/$id"
          params={{ id: current.shortName }}
          title={`${current.shortName} — ${current.name}`}
          className="block px-5 py-3 text-stone-900 hover:bg-stone-50 hover:no-underline transition-opacity duration-500"
        >
          <div className="text-xs font-semibold leading-snug line-clamp-2 min-h-[2.4em]">
            {cleanExperimentTitle(current.name)}
          </div>
          <div className="mt-1.5 flex flex-wrap content-start gap-1 h-[3.2em] overflow-hidden">
            {chips.map((c) => (
              <span
                key={`${c.category}-${c.term}`}
                className="inline-flex items-center text-[10px] leading-none px-1.5 py-0.5 border border-stone-400 text-stone-800"
                title={c.category}
              >
                {c.term}
              </span>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-stone-500 inline-flex items-baseline gap-2">
            <span className="font-mono">{current.shortName}</span>
            {current.taxonName ? (
              <>
                <span className="text-stone-400">·</span>
                <span>{current.taxonName}</span>
              </>
            ) : null}
          </div>
        </Link>
      ) : (
        <div className="px-5 py-4 text-stone-500 text-xs italic">
          loading…
        </div>
      )}
    </div>
  );
}

/**
 * Page-level masthead — replaces the standard AppBar on the home
 * route + the old wordmark block (design review: those two duplicated the
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
// Rendered height of the Gemma wordmark, and the share of that image
// that is transparent padding below the letters. gemma-logo-text.png
// is 1350×371 with the "Gemma" baseline measured at y≈293, so ~21% of
// the height sits empty beneath the glyphs.
//
// The brand row aligns on `last baseline`: flexbox aligns the tagline's
// LAST line's baseline to the <img>'s baseline, which for a replaced
// element is its bottom edge (y = height). That puts the tagline
// baseline at the padded image bottom, ~21% below the wordmark
// baseline. Nudge the tagline UP by that same fraction of the rendered
// height so the two baselines coincide. Working baseline-to-baseline
// (not box edges) sidesteps the tagline's own line-box descent — the
// earlier margin-on-`items-end` version aligned the span's box bottom,
// leaving its text baseline floating above the wordmark.
//
// `last baseline` (not `baseline`) matters once the tagline wraps: at
// higher zoom the row narrows and the tagline breaks onto 2+ lines.
// First-baseline alignment would pin line 1 and let the rest spill
// DOWN past the wordmark; anchoring the last line instead keeps the
// bottom line locked to the wordmark baseline and stacks earlier lines
// upward. Expressed as a ratio of the logo height, so it holds at any
// size or zoom.
const MASTHEAD_LOGO_HEIGHT = 60;
const MASTHEAD_LOGO_BASELINE_PAD = (371 - 293) / 371; // ≈0.210
// Below-baseline descent of the masthead caption text (Inter, the
// `leading-none` tagline/controls). Lifting the text by the pad alone
// lands its box BOTTOM on the wordmark baseline; the visible baseline
// sits one descent above that, so we settle the text back down by the
// descent to put the baseline itself on the line. ≈0.2em at these sizes.
const MASTHEAD_TEXT_DESCENT = 2;

function Masthead() {
  const me = useMe();
  const user = me.data;
  const logout = useLogout();
  const [loginOpen, setLoginOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <div className="border-b border-stone-950 bg-stone-100">
      {/* `items-end` pins BOTH logos to the masthead rule. Between them,
          a single `items-baseline` text row holds the tagline and the
          right-side controls, so they share one baseline (the ask), and
          the whole text row is lifted by the wordmark's baseline pad so
          that shared line coincides with the printed "Gemma" baseline. */}
      <div className="flex items-end gap-3 flex-wrap">
        <img
          src={gemmaLogoText}
          alt="GEMMA"
          style={{ height: MASTHEAD_LOGO_HEIGHT }}
          className="block w-auto"
        />

        <div
          className="flex-1 min-w-0 flex items-baseline gap-6 leading-none"
          style={{
            // Land the shared text baseline on the printed wordmark
            // baseline: lift by the wordmark's under-glyph pad, then
            // settle back down by the text's own descent.
            marginBottom:
              MASTHEAD_LOGO_HEIGHT * MASTHEAD_LOGO_BASELINE_PAD -
              MASTHEAD_TEXT_DESCENT,
          }}
        >
          <span className="text-[10px] uppercase tracking-[0.18em] text-stone-600 leading-none">
            Database of curated and re-analyzed gene expression studies
          </span>

          <div className="flex-1 min-w-0" />

          {/* About + auth — same baseline as the tagline. */}
          <div className="flex items-baseline gap-4">
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              className="text-[12px] text-stone-600 hover:text-stone-900 hover:no-underline bg-transparent border-none cursor-pointer p-0"
            >
              About
            </button>
            {me.isPending && !me.data ? null : user ? (
              <span className="text-[12px] text-stone-600 inline-flex items-baseline gap-2">
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
                // `leading-none -mb-1` cancels the button's below-baseline
                // padding (mirrors `py-1`) so, in the shared baseline row,
                // its padded box doesn't drag the tagline's baseline up off
                // the wordmark. Visual padding is unchanged.
                className="text-[12px] leading-none -mb-1 px-2.5 py-1 rounded bg-stone-900 text-stone-50 hover:bg-stone-800"
              >
                Sign in
              </button>
            )}
          </div>
        </div>

        {/* UBC logo — pinned to the masthead rule like the wordmark. */}
        <a
          href="https://www.ubc.ca/"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            src={ubcLogo}
            alt="University of British Columbia"
            style={{ height: 40 }}
            className="block w-auto"
          />
        </a>
      </div>
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
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
    <div className="my-3 border-2 border-stone-950 bg-stone-100">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="general-info-body"
        className="w-full flex items-baseline gap-2 px-5 py-2.5 text-[10px] uppercase tracking-[0.2em] text-stone-600 border-b border-stone-300 hover:bg-stone-50"
      >
        <span className="text-stone-900 font-semibold">About Gemma</span>
        <span className="text-blue-700 normal-case tracking-normal text-[11px] font-medium">
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
                        rel="noopener noreferrer"
                        className="group inline-block"
                      >
                        {labelEl}
                        <span
                          aria-hidden
                          className="ml-0.5 text-[0.85em] opacity-60 font-normal text-stone-500"
                        >
                          ↗
                        </span>
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
// The reviewer: "ugly, poor use of space". The access column now uses a
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
  to,
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
  /** Optional in-app navigation target. When set the tile renders
   *  as a Link with a subtle hover affordance (blue underline +
   *  bg-stone-50 on the headline). Non-link tiles stay as
   *  static divs. */
  to?: string;
}) {
  // Reserve min-height for the label + footnote slots so values
  // sit on the same horizontal baseline across the row regardless
  // of whether a particular label wraps to two lines (e.g. "GENES
  // PERTURBED") or whether a tile has a footnote at all. mt-auto
  // on the footnote slot pins it to the bottom of the flex column
  // so empty-footnote tiles match the height of populated ones.
  const baseCls = `${cols} bg-stone-100 px-5 py-4 flex flex-col`;
  const linkCls = `${baseCls} cursor-pointer transition-colors hover:bg-stone-50 group focus:outline-none focus:ring-1 focus:ring-stone-900`;
  const body = (
    <>
      <div className="text-[10px] uppercase tracking-[0.2em] text-stone-600 mb-1 flex items-center min-h-[2.4em]">
        <span>{label}</span>
        {hint ? <InfoBadge hint={hint} ariaLabel={hintAria} /> : null}
      </div>
      <div className="text-3xl font-semibold tabular-nums tracking-tight text-stone-950 group-hover:text-blue-700">
        {value}
        {to ? (
          <span
            aria-hidden="true"
            className="ml-2 text-base text-stone-400 group-hover:text-blue-700"
          >
            →
          </span>
        ) : null}
      </div>
      <div className="mt-auto pt-1 text-[10px] text-stone-500 leading-snug min-h-[2.6em]">
        {footnote ?? null}
      </div>
    </>
  );
  if (to) {
    return (
      <Link to={to} className={linkCls + " no-underline hover:no-underline"}>
        {body}
      </Link>
    );
  }
  return <div className={baseCls}>{body}</div>;
}

/** Small ``i`` glyph next to a tile label — hoverable affordance
 *  for the explanation. Wrapped in the shared Tooltip component
 *  (60ms open delay, portal-mounted, stone-900 bubble) instead of
 *  the browser-default ``title=`` which has a ~700ms open delay
 *  The reviewer (and everyone) finds frustrating. Sized to match the 10px
 *  label text so it doesn't compete visually.
 *  No ``cursor-help`` — that yields the macOS circle-with-question-
 *  mark cursor which the reviewer (correctly) flagged as visual noise.
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

