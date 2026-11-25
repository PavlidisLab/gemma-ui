import type { HeatmapRowGene } from "@gemma/heatmap";
import type { DiffExpressionResponse } from "@/lib/types";

type Level = DiffExpressionResponse["geneExpressionLevels"][number];

/** One DE heatmap row: a gene's result, plus every gene sharing it. */
export type DeProbeRow = Level & { genes: HeatmapRowGene[] };

/**
 * Order the DE endpoint's genes by corrected p-value and put genes that
 * share a probe on one row — one vector, one set of statistics, every
 * gene named.
 *
 * The probe is `vectors[0]`, the one the heatmap draws. Genes merge only
 * when their p-value and fold change match too. A gene with no vector
 * keeps its own row.
 *
 * Pure.
 */
export function buildDeProbeRows(levels: Level[]): DeProbeRow[] {
  const sorted = [...levels].sort(
    (a, b) =>
      (a.correctedPvalue ?? Infinity) - (b.correctedPvalue ?? Infinity),
  );
  const rows: DeProbeRow[] = [];
  const byKey = new Map<string, DeProbeRow>();
  sorted.forEach((lvl, i) => {
    const gene: HeatmapRowGene = {
      // The id only has to be distinct within the row when absent.
      id: lvl.geneId ?? -(i + 1),
      officialSymbol:
        lvl.geneOfficialSymbol || String(lvl.geneNcbiId ?? "?"),
      name: lvl.geneOfficialName ?? null,
      ncbiId: lvl.geneNcbiId ?? null,
    };
    const probe = lvl.vectors?.[0]?.designElementName;
    const key = probe
      ? JSON.stringify([probe, lvl.pvalue, lvl.log2FoldChange])
      : null;
    const shared = key ? byKey.get(key) : undefined;
    if (shared) {
      shared.genes.push(gene);
      return;
    }
    const row = { ...lvl, genes: [gene] };
    rows.push(row);
    if (key) byKey.set(key, row);
  });
  // Wire order within a probe is arbitrary.
  for (const row of rows) {
    row.genes.sort((a, b) =>
      (a.officialSymbol ?? "").localeCompare(b.officialSymbol ?? ""),
    );
  }
  return rows;
}
