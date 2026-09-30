/**
 * Visualize-expression tab on the dataset detail page.
 *
 * Thin wrapper around `@gemma/expression-analysis`'s `GeneExpressionPanel`
 * (extracted from this file, 2026-09-30, so apps/curation can offer the
 * same feature — see that package for the picker/heatmap implementation).
 * This file owns everything the package can't: the concrete Gemma REST
 * calls (`GeneExpressionApi`), the heatmap wire→payload adapter, and the
 * in-app route links for the row tooltip.
 */
import { useMemo } from "react";
import type { HeatmapPayload } from "@gemma/heatmap";
import { buildGeneRowLabel } from "@gemma/heatmap";
import {
  GeneExpressionPanel,
  type GeneExpressionApi,
  type GeneExpressionHeatmapDecoration,
} from "@gemma/expression-analysis";
import {
  searchGenes,
  searchGoTerms,
  annotationSearchMessage,
  getGoTermGenes,
  getGene,
  getOntologyTerm,
  getHeatmapData,
  getDatasetQuantitationTypes,
  getDatasetPlatforms,
  type HeatmapWireResponse,
} from "@/api/endpoints";
import type { Dataset } from "@/lib/types";
import { taxonPathParam } from "@/lib/gemmaConfig";
import { ProbeRowTooltip } from "./ProbeRowTooltip";

function toCell(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Wire → HeatmapPayload, decorated with GO-term origin colours + the
 *  "queried" set (marks a probe non-specific when it also measures a
 *  gene outside the search). Ported unchanged from this file's previous
 *  monolithic version. */
export function adaptHeatmapWire(
  wire: HeatmapWireResponse,
  decoration: GeneExpressionHeatmapDecoration = { origins: {}, queried: new Set() },
): HeatmapPayload {
  const { origins, queried } = decoration;
  return {
    datasetId: wire.datasetId,
    matrix: {
      values: wire.matrix.values.map((row) => row.map(toCell)),
      rows: wire.matrix.rowsCount,
      cols: wire.matrix.colsCount,
      quantitationType: {
        name: wire.matrix.quantitationType.name,
        isPreferred: wire.matrix.quantitationType.isPreferred,
        isRatio: wire.matrix.quantitationType.isRatio,
        scale: wire.matrix.quantitationType.scale,
      },
    },
    rows: wire.rows.map((r) => {
      const rowGenes = r.genes ?? [];
      const geneIds = rowGenes.map((g) => g.id);
      const originHit = geneIds.map((id) => origins[id]).find((o) => o && o.goUri);
      return {
        designElementId: r.designElementId,
        designElementName: r.designElementName,
        geneIds,
        geneSymbols: rowGenes.map((g) => g.officialSymbol ?? ""),
        geneNames: rowGenes.map((g) => g.name ?? ""),
        ...buildGeneRowLabel(rowGenes, queried),
        originColor: originHit ? colorForGoUri(originHit.goUri) : null,
        originTitle: originHit ? originHit.goLabel : null,
      };
    }),
    columns: wire.columns.map((c) => {
      const ids: Record<number, number> = {};
      for (const [k, v] of Object.entries(c.factorValueIds ?? {})) {
        ids[Number(k)] = v;
      }
      return {
        bioAssayId: c.bioAssayId,
        bioMaterialId: c.bioMaterialId,
        name: c.name,
        outlier: c.outlier,
        factorValueIds: ids,
      };
    }),
    factors: (wire.factors ?? []).map((wrap) => ({
      id: wrap.factor.id,
      name: wrap.factor.name,
      description: wrap.factor.description ?? undefined,
      category: {
        label: wrap.factor.category ?? wrap.factor.name,
        uri: wrap.factor.categoryUri ?? null,
      },
      type: wrap.factor.type === "continuous" ? ("continuous" as const) : ("categorical" as const),
      factor_values: (wrap.factor.values ?? []).map((fv) => ({
        id: fv.id,
        free_text_label: fv.summary ?? "",
        is_baseline: !!fv.isBaseline,
        statements: [],
      })),
    })),
  };
}

// Same FNV-1a palette hash the package uses internally for term chips —
// duplicated (not exported by the package) purely so a gene's row disc
// matches the colour of the term chip that produced it. Small enough
// that keeping two copies in sync is not a real risk.
const ORIGIN_PALETTE = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#f43f5e", "#14b8a6",
  "#6366f1", "#84cc16", "#ec4899", "#06b6d4", "#d946ef", "#f97316",
];
function colorForGoUri(uri: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < uri.length; i++) {
    h ^= uri.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ORIGIN_PALETTE[(h >>> 0) % ORIGIN_PALETTE.length];
}

export function VisualizeTab({
  dataset,
  isAdmin = false,
}: {
  dataset: Dataset;
  isAdmin?: boolean;
}) {
  const taxon = taxonPathParam(dataset.taxon);

  const api = useMemo<GeneExpressionApi>(
    () => ({
      searchGenes: (query, opts) => searchGenes(query, opts),
      searchGoTerms: (query, opts) => searchGoTerms(query, opts),
      getGoTermGenes: (uri, opts) => getGoTermGenes(uri, opts),
      getHeatmapData: async (entityId, params, decoration, signal) => {
        const wire = await getHeatmapData(entityId, params, signal);
        return wire ? adaptHeatmapWire(wire, decoration) : null;
      },
      getQuantitationTypes: (entityId, signal) => getDatasetQuantitationTypes(entityId, signal),
      getPlatforms: (entityId, signal) => getDatasetPlatforms(entityId, signal),
      resolveGene: (shareId, signal) => getGene(shareId, signal),
      resolveGoTermLabel: (curie) => getOntologyTerm(curie),
      formatSearchError: (err, query) => annotationSearchMessage(err, query),
    }),
    [],
  );

  return (
    <GeneExpressionPanel
      api={api}
      entityId={dataset.id}
      taxon={taxon}
      isAdmin={isAdmin}
      renderProbeTooltip={(input) => (
        <ProbeRowTooltip
          designElementName={input.designElementName}
          designElementId={input.designElementId}
          genes={input.genes}
          platformShortName={input.platformShortName}
          queried={input.queried}
        />
      )}
    />
  );
}
