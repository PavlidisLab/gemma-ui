/**
 * "Corpus plots" — the distribution figures, on demand.
 *
 * Layout: the two short tables (taxon, technology) sit fixed at the
 * top, side by side. The three tall bar charts take turns below in a
 * deck that only ever advances when someone asks it to.
 *
 * They used to auto-rotate through two side-by-side carousels on the
 * home page, which meant a visitor had to wait for the one they wanted
 * and then race a 7-second timer to read it. Nothing here moves on its
 * own, so each chart can list everything the snapshot ships rather than
 * a top-10 slice.
 *
 * Every row that has a real filter behind it is a link into the
 * browser. Rows that don't — the treatment sub-buckets, which are an
 * agent-side grouping with no corresponding Gemma filter — stay plain
 * text rather than pointing somewhere approximate.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getGenesBySymbols } from "@/api/endpoints";
import type React from "react";
import { Modal } from "@/features/shared/Modal";
import { BarRow, Panel, PlotHeader, ValueRow, type RowLink } from "./panels";
import { fmtCount, type GemmaSummary, type TaxonRow, type TechnologyRow } from "./useGemmaSummary";

/**
 * ExperimentalFactor categories that are user-facing, keyed by the
 * canonical Gemma category label (lowercased) as it arrives from
 * ``factorValuesByCategory``. Values are the display label.
 *
 * A whitelist rather than a denylist: the corpus carries curator
 * bookkeeping categories (``block``, ``collection of material``,
 * ``individual``, ``protocol``, ``study design``, ``biological
 * process``) that aren't experimental axes, and letting unknown labels
 * through by default would surface the next one added upstream without
 * anyone deciding to.
 *
 * Multiple keys can map to one display group when a natural merge
 * applies (``molecular entity`` rolls into Treatment — both are "what
 * was applied to the sample").
 */
const FACTOR_CATEGORY_DISPLAY: Record<string, string> = {
  genotype: "Genotype",
  treatment: "Treatment",
  "molecular entity": "Treatment",
  disease: "Disease",
  "disease model": "Disease model",
  "disease staging": "Disease staging",
  "organism part": "Tissue",
  "cell type": "Cell type",
  "cell line": "Cell line",
  strain: "Strain",
  "developmental stage": "Developmental stage",
  age: "Age",
  "biological sex": "Sex",
  timepoint: "Timepoint",
  phenotype: "Phenotype",
  diet: "Diet",
  dose: "Dose",
  "clinical history": "Clinical history",
  "environmental history": "Environmental history",
  "environmental stress": "Environmental stress",
  "growth condition": "Growth condition",
  population: "Population",
  generation: "Generation",
  specimen: "Specimen",
};

export function MorePlotsModal({
  open,
  onClose,
  s,
}: {
  open: boolean;
  onClose: () => void;
  s: GemmaSummary;
}) {
  // The two small tables are short enough to sit side by side and be
  // read at a glance, so they stay put at the top. Only the three tall
  // bar charts — which each want the full width and a couple of dozen
  // rows — take turns below.
  const plots: Array<{ title: string; node: React.ReactNode }> = [
    { title: "Factor values per category", node: <CategoryBars s={s} /> },
    { title: "Top genes perturbed", node: <PerturbedGenesBars s={s} /> },
    {
      title: "Treatment subcategories",
      node: <TreatmentSubcategoryBars s={s} />,
    },
  ];
  return (
    <Modal open={open} onClose={onClose} title="Corpus plots" maxWidth="max-w-4xl">
      <div
        className="text-stone-950 space-y-4"
        style={{ fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif' }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-px">
          <Panel minHeight={false}>
            <TaxonBreakdown rows={s.byTaxon} />
          </Panel>
          <Panel minHeight={false}>
            <TechnologyBreakdown
              rows={s.byTechnology}
              totalCells={s.totalCells}
            />
          </Panel>
        </div>
        <PlotDeck plots={plots} />
      </div>
    </Modal>
  );
}

/** One plot at a time, advanced only on request — arrows, dots, or the
 *  arrow keys. No timer: this popup is opened deliberately, and a plot
 *  that moves on its own is a plot you can't finish reading. */
function PlotDeck({
  plots,
}: {
  plots: Array<{ title: string; node: React.ReactNode }>;
}) {
  const n = plots.length;
  const [idx, setIdx] = useState(0);
  const go = (i: number) => setIdx(((i % n) + n) % n);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Leave arrow keys alone while a field has focus — they're
      // caret movement there, not deck navigation.
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (t?.isContentEditable) return;
      if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + n) % n);
      if (e.key === "ArrowRight") setIdx((i) => (i + 1) % n);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n]);

  return (
    <div>
      <Panel minHeight={false}>{plots[idx].node}</Panel>
      <div className="flex items-center justify-between border border-t-0 border-stone-950 bg-stone-100 px-3 py-2">
        <button
          type="button"
          onClick={() => go(idx - 1)}
          aria-label={`Previous plot — ${plots[(idx - 1 + n) % n].title}`}
          className="px-2 py-0.5 text-stone-500 hover:text-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-600"
        >
          ←
        </button>
        <div className="flex items-center gap-2">
          {plots.map((p, i) => (
            <button
              key={p.title}
              type="button"
              onClick={() => go(i)}
              aria-label={`Show ${p.title}`}
              aria-current={i === idx}
              title={p.title}
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
          aria-label={`Next plot — ${plots[(idx + 1) % n].title}`}
          className="px-2 py-0.5 text-stone-500 hover:text-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-600"
        >
          →
        </button>
      </div>
    </div>
  );
}

function TaxonBreakdown({ rows }: { rows: TaxonRow[] }) {
  return (
    <div className="bg-stone-100">
      <PlotHeader title="Datasets by taxon" unit="datasets" />
      <table className="w-full text-sm">
        <tbody>
          {rows.map((t) => (
            <ValueRow
              key={t.name}
              label={t.name}
              value={fmtCount(t.total, "full", t.total === null)}
              title={`Browse ${t.name} datasets`}
              link={{ to: "/browser/t/$initialTaxon", params: { initialTaxon: t.name } }}
            />
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
      <PlotHeader
        title="Samples by technology"
        unit="samples"
        unitHint="Biomaterial counts split by technology, single-counted server-side. The links browse the datasets using each technology — a dataset count, not this sample count."
      />
      <table className="w-full text-sm">
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="px-5 py-2 text-stone-400">…</td>
              <td className="px-5 py-2 text-right text-stone-400">…</td>
            </tr>
          ) : (
            rows.map((r) => (
              <ValueRow
                key={r.label}
                label={r.label}
                value={fmtCount(r.count)}
                title={`Browse ${r.label} datasets`}
                link={{ to: "/browser/$preset", params: { preset: r.preset } }}
                suffix={
                  r.label === "Single-cell" && cellsLabel ? `· ${cellsLabel}` : undefined
                }
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function CategoryBars({ s }: { s: GemmaSummary }) {
  // Factor-values-per-category bar chart. Source:
  // /stats/home.factorValuesByCategory, merged / relabelled against
  // FACTOR_CATEGORY_DISPLAY.
  const merged = new Map<
    string,
    { uri: string | null; count: number }
  >();
  for (const row of s.factorValuesByCategory) {
    const key = row.category.trim().toLowerCase();
    const display = FACTOR_CATEGORY_DISPLAY[key];
    if (!display) continue;
    const cur = merged.get(display) ?? { uri: null, count: 0 };
    // Keep the URI of the biggest contributor to a merged group — it's
    // the one whose category filter reproduces most of the bar.
    if (row.uri && (cur.uri === null || row.count > cur.count)) cur.uri = row.uri;
    cur.count += row.count;
    merged.set(display, cur);
  }

  const rows = Array.from(merged.entries())
    .map(([label, v]) => ({ label, uri: v.uri, count: v.count }))
    .sort((a, b) => b.count - a.count);

  const ready = rows.length > 0;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="bg-stone-100">
      <PlotHeader
        title="Factor values per category"
        unit="occurrences"
        unitHint="Factor-value occurrences per ExperimentalFactor category — each experiment defines its own FactorValue records (so Sex shows thousands of occurrences, not two), and the bar reflects how heavily a category is used across the corpus."
      />
      {ready ? (
        <ul className="py-1">
          {rows.map((r) => (
            <BarRow
              key={r.label}
              label={r.label}
              count={r.count}
              max={max}
              title={
                r.uri
                  ? `Browse datasets annotated in the ${r.label} category`
                  : r.label
              }
              link={
                r.uri
                  ? {
                      to: "/browser",
                      search: { categoryUri: r.uri, categoryLabel: r.label },
                    }
                  : undefined
              }
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

function PerturbedGenesBars({ s }: { s: GemmaSummary }) {
  // Top perturbed genes by number of experiments. Source:
  // /stats/home.topPerturbedGenes — the snapshot ships 25 and all 25
  // render here.
  //
  // Each row links into the browser with the gene's annotation term
  // already selected, which is more useful than the gene's own page:
  // the chart's subject is "experiments that perturbed this gene", and
  // that's a dataset list. Gemma annotates a perturbed gene with
  // ``http://purl.org/commons/record/ncbi_gene/<ncbiId>`` under the
  // genotype category, so the link needs an NCBI id — and the snapshot
  // only carries symbols. One /genes/{symbols} call resolves the whole
  // chart; the rows stay plain text until it lands rather than
  // pointing somewhere provisional.
  const rows = s.topPerturbedGenes;
  const symbols = useMemo(
    () => Array.from(new Set(rows.map((r) => r.geneSymbol))),
    [rows],
  );
  const genesQ = useQuery({
    queryKey: ["perturbed-gene-ids", symbols.join(",")],
    queryFn: ({ signal }) => getGenesBySymbols(symbols, signal),
    enabled: symbols.length > 0,
    staleTime: 60 * 60_000,
  });

  // A symbol is not unique across taxa — /genes/Myc returns the human,
  // mouse and rat genes — so key the lookup on both.
  const ncbiBySymbolTaxon = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of genesQ.data ?? []) {
      const sym = g.officialSymbol?.toLowerCase();
      const taxon = g.taxon?.commonName?.toLowerCase();
      if (!sym || !taxon || g.ncbiId == null) continue;
      m.set(`${sym}|${taxon}`, g.ncbiId);
    }
    return m;
  }, [genesQ.data]);

  // Same shape the annotation tree uses for these terms, so the chip
  // the browser draws reads the way it would if the visitor had ticked
  // the box themselves: "Myc [mouse] myelocytomatosis oncogene".
  const nameBySymbolTaxon = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of genesQ.data ?? []) {
      const sym = g.officialSymbol;
      const taxon = g.taxon?.commonName;
      if (!sym || !taxon) continue;
      m.set(
        `${sym.toLowerCase()}|${taxon.toLowerCase()}`,
        g.officialName ? `${sym} [${taxon}] ${g.officialName}` : `${sym} [${taxon}]`,
      );
    }
    return m;
  }, [genesQ.data]);

  const ready = rows.length > 0;
  const max = Math.max(1, ...rows.map((r) => r.numberOfExpressionExperiments));
  return (
    <div className="bg-stone-100">
      <PlotHeader
        title="Top genes perturbed"
        unit="experiments"
        unitHint="Top perturbed genes by number of experiments they're annotated in as a perturbation target (knockouts, knockdowns, overexpression). Clicking a gene browses the experiments carrying its genotype annotation."
      />
      {ready ? (
        <ul className="py-1">
          {rows.map((r) => {
            const key = `${r.geneSymbol.toLowerCase()}|${(r.taxon ?? "").toLowerCase()}`;
            const ncbiId = ncbiBySymbolTaxon.get(key);
            const link: RowLink | undefined =
              ncbiId === undefined
                ? undefined
                : {
                    to: "/browser",
                    search: {
                      categoryUri: GENOTYPE_CATEGORY_URI,
                      categoryLabel: "genotype",
                      annotationUri: `${NCBI_GENE_URI_BASE}${ncbiId}`,
                      annotationLabel:
                        nameBySymbolTaxon.get(key) ?? r.geneSymbol,
                    },
                  };
            return (
              <BarRow
                key={`${r.geneSymbol}-${r.taxon ?? ""}`}
                label={r.geneSymbol}
                count={r.numberOfExpressionExperiments}
                max={max}
                italic
                title={
                  link
                    ? `Browse experiments perturbing ${r.geneSymbol}${r.taxon ? ` (${r.taxon})` : ""}`
                    : r.taxon
                      ? `${r.geneSymbol} (${r.taxon})`
                      : r.geneSymbol
                }
                link={link}
              />
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

/** Gemma annotates a perturbed gene under the genotype category. */
const GENOTYPE_CATEGORY_URI = "http://www.ebi.ac.uk/efo/EFO_0000513";
/** Term-URI prefix Gemma uses for NCBI genes. */
const NCBI_GENE_URI_BASE = "http://purl.org/commons/record/ncbi_gene/";

function TreatmentSubcategoryBars({ s }: { s: GemmaSummary }) {
  // Treatment sub-buckets shipped by the agents side (approved-drug /
  // hormone / vitamin / toxin / vehicle / other-chemical / pathogen /
  // biologic / control-reference / other). Sums to
  // byAnnotationCategory.treatment.
  //
  // Drop the ``control`` group (Control / reference, Vehicles /
  // solvents) — those dominate the count but carry no biological
  // signal; surfacing them just buries the real pharmacology /
  // biological buckets and pushes "control" to the top of the chart.
  //
  // Rows aren't links: a bucket is an agent-side grouping of many
  // ontology terms, and no single Gemma filter reproduces one. The
  // example terms underneath are what a visitor can actually act on.
  const rows = s.treatmentSubcategories.filter((r) => r.group !== "control");
  const ready = rows.length > 0;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="bg-stone-100">
      <PlotHeader
        title="Treatment subcategories"
        unit="experiments"
        unitHint="Experiments using any annotation in each treatment sub-bucket. Buckets span CHEBI chemicals (approved drugs, hormones, toxins, vitamins, other chemicals), NCBITaxon pathogens, PR / NCBI-gene biologics, and an unclassified ``other`` catch-all. Control / reference and vehicle / solvent buckets are filtered out — they dominate the count but carry no biological signal."
      />
      {ready ? (
        <ul className="py-1">
          {rows.map((r) => (
            <BarRow
              key={r.key}
              label={r.label}
              count={r.count}
              max={max}
              title={
                r.termCount !== null
                  ? `${r.label} — ${r.termCount.toLocaleString()} distinct terms`
                  : r.label
              }
              footnote={
                r.topTerms.length > 0
                  ? r.topTerms
                      .slice(0, 4)
                      .map((t) => t.label)
                      .join(" · ")
                  : undefined
              }
            />
          ))}
        </ul>
      ) : (
        <div className="px-4 py-3 text-stone-500 text-xs">
          pending /stats/home refresh
        </div>
      )}
    </div>
  );
}
