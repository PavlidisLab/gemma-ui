/**
 * Gene-expression browse — the curation-side `GeneExpressionApi` for
 * `@gemma/expression-analysis`'s `GeneExpressionPanel`.
 *
 * Same Gemma REST endpoints apps/browser reads (`/genes/search`,
 * `/annotations/search`, `/goTerms/{uri}/genes`,
 * `/datasets/{id}/heatmap-data`, `/datasets/{id}/quantitationTypes`,
 * `/datasets/{id}/platforms`, `/genes/{id}`, `/annotations/term`).
 *
 * 🛑 `client.ts` snakeifies every response — this is the one place that
 * decodes the snake_case wire and hands the package back the camelCase
 * shape it expects (same rule `heatmapData.ts` already follows for the
 * heatmap endpoint; this file follows it for the rest). Never patch a
 * missing field with `x.official_symbol ?? x.officialSymbol` — decode
 * once, here.
 *
 * List endpoints keep their pagination siblings (`total_elements`, …)
 * alongside `data` after snakeify, so `client.ts`'s envelope-unwrap
 * does NOT fire for them — read `.data` explicitly, as the wire types
 * below assume.
 */
import { api } from "./client";
import type { HeatmapPayload, HeatmapRowGene } from "@gemma/heatmap";
import { buildGeneRowLabel } from "@gemma/heatmap";
import type {
  Gene,
  GoTermMatch,
  GoTermGenesPage,
  QuantitationTypeLite,
  PlatformLite,
  GeneExpressionApi,
  GeneExpressionHeatmapDecoration,
} from "@gemma/expression-analysis";
import type { WireGene, WireHeatmap } from "./heatmapData";

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

function adaptWireGene(g: WireGene): Gene {
  return {
    id: g.id ?? 0,
    officialSymbol: g.official_symbol ?? null,
    officialName: null,
    ncbiId: g.ncbi_id ?? null,
    ensemblId: null,
    aliases: null,
    taxon: null,
    ncbiUri: null,
    description: null,
  };
}

interface WirePaginated<T> {
  data?: T[];
  total_elements?: number;
}

/** Tolerates both shapes `client.ts`'s envelope-unwrap can produce for
 *  a list endpoint: `{data: [...], total_elements, ...}` when pagination
 *  siblings suppress the unwrap, or a bare `T[]` when they don't (see
 *  this file's header). Whether a given endpoint carries those siblings
 *  isn't verified against a live backend in this pass — this is the
 *  guard against silently reading `undefined.data` as "no results". */
function asList<T>(x: T[] | { data?: T[] } | null | undefined): T[] {
  if (Array.isArray(x)) return x;
  return x?.data ?? [];
}

interface WireAnnotationSearchResult {
  value: string;
  value_uri: string | null;
  category: string | null;
  category_uri: string | null;
}

export async function searchGenes(
  query: string,
  opts: { taxon?: string; limit?: number; signal?: AbortSignal },
): Promise<Gene[]> {
  const q = query.trim();
  if (!q) return [];
  const r = await api.get<WireGene[] | WirePaginated<WireGene>>(
    `/rest/v2/genes/search${qs({ query: q, limit: opts.limit ?? 20, taxon: opts.taxon })}`,
  );
  return asList(r).map(adaptWireGene);
}

export async function searchGoTerms(
  query: string,
  opts: { limit?: number; signal?: AbortSignal },
): Promise<GoTermMatch[]> {
  const q = query.trim();
  if (!q) return [];
  const r = await api.get<WireAnnotationSearchResult[] | WirePaginated<WireAnnotationSearchResult>>(
    `/rest/v2/annotations/search${qs({ query: q, prefixes: "GO_", limit: opts.limit ?? 20 })}`,
  );
  return asList(r).map((a) => ({
    value: a.value,
    valueUri: a.value_uri,
    category: a.category,
    categoryUri: a.category_uri,
  }));
}

export async function getGoTermGenes(
  termUri: string,
  opts: { taxon?: string; limit?: number; signal?: AbortSignal },
): Promise<GoTermGenesPage | null> {
  const r = await api.get<WireGene[] | WirePaginated<WireGene>>(
    `/rest/v2/goTerms/${encodeURIComponent(termUri)}/genes${qs({ taxon: opts.taxon, limit: opts.limit ?? 100 })}`,
  );
  const list = asList(r);
  return { data: list.map(adaptWireGene), totalElements: Array.isArray(r) ? list.length : r?.total_elements };
}

export async function getQuantitationTypes(
  entityId: number,
  _signal?: AbortSignal,
): Promise<QuantitationTypeLite[]> {
  interface WireQt {
    id: number;
    name?: string | null;
    scale?: string | null;
    type?: string | null;
    is_preferred?: boolean;
    is_masked_preferred?: boolean;
  }
  const r = await api.get<WireQt[] | WirePaginated<WireQt>>(`/rest/v2/datasets/${entityId}/quantitationTypes`);
  return asList(r).map((qt) => ({
    id: qt.id,
    name: qt.name,
    scale: qt.scale,
    type: qt.type,
    isPreferred: qt.is_preferred,
    isMaskedPreferred: qt.is_masked_preferred,
  }));
}

export async function getPlatforms(
  entityId: number,
  _signal?: AbortSignal,
): Promise<PlatformLite[]> {
  interface WirePlatform {
    short_name?: string | null;
  }
  const r = await api.get<WirePlatform[] | WirePaginated<WirePlatform>>(`/rest/v2/datasets/${entityId}/platforms`);
  return asList(r).map((p) => ({ shortName: p.short_name }));
}

export async function resolveGene(shareId: number): Promise<Gene | null> {
  const r = await api.get<WireGene[] | WirePaginated<WireGene>>(`/rest/v2/genes/${shareId}`);
  const g = asList(r)[0];
  return g ? adaptWireGene(g) : null;
}

export async function resolveGoTermLabel(curie: string): Promise<{ label: string } | null> {
  interface WireTerm {
    uri?: string;
    label?: string;
  }
  try {
    const r = await api.get<WireTerm>(`/rest/v2/annotations/term${qs({ uri: curie })}`);
    return r?.label ? { label: r.label } : null;
  } catch {
    return null;
  }
}

/** Decorated wire → HeatmapPayload, mirroring apps/browser's own
 *  adapter but reading snake_case (see file header). Distinct from
 *  `heatmapData.ts`'s `adaptHeatmapWire`, which serves the PCA-loadings
 *  popup and carries no gene-search decoration (origin colours /
 *  "queried" set) — this one does, because it feeds the same picker
 *  the browser app has. */
function adaptDecoratedHeatmapWire(
  wire: WireHeatmap,
  decoration: GeneExpressionHeatmapDecoration,
): HeatmapPayload {
  const { origins, queried } = decoration;
  const m = wire.matrix;
  const values = (m?.values ?? []).map((row) =>
    row.map((v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === "string" && v.trim() === "") return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    }),
  );
  return {
    datasetId: wire.dataset_id ?? 0,
    matrix: {
      values,
      rows: m?.rows_count ?? values.length,
      cols: m?.cols_count ?? (values[0]?.length ?? 0),
      quantitationType: {
        name: m?.quantitation_type?.name ?? "",
        isPreferred: m?.quantitation_type?.is_preferred ?? false,
        isRatio: m?.quantitation_type?.is_ratio ?? false,
        scale: m?.quantitation_type?.scale ?? "",
      },
    },
    rows: (wire.rows ?? []).map((r, i) => {
      // The wire's per-row gene shape is minimal ({id, official_symbol,
      // name}) — NOT the full `Gene` search-result shape (which has
      // `officialName`, not `name`). `buildGeneRowLabel` wants the
      // minimal `HeatmapRowGene` shape, so map directly rather than via
      // `adaptWireGene`.
      const rowGenes: HeatmapRowGene[] = (r.genes ?? []).map((g) => ({
        id: g.id ?? 0,
        officialSymbol: g.official_symbol ?? null,
        name: g.name ?? null,
        ncbiId: g.ncbi_id ?? null,
      }));
      const geneIds = rowGenes.map((g) => g.id);
      const originHit = geneIds.map((id) => origins[id]).find((o) => o && o.goUri);
      return {
        designElementId: Number(r.design_element_id) || i,
        designElementName: r.design_element_name ?? "",
        geneIds,
        geneSymbols: rowGenes.map((g) => g.officialSymbol ?? ""),
        geneNames: rowGenes.map((g) => g.name ?? ""),
        ...buildGeneRowLabel(rowGenes, queried),
        originColor: originHit ? "#3b82f6" : null,
        originTitle: originHit ? originHit.goLabel : null,
      };
    }),
    columns: (wire.columns ?? []).map((c) => {
      const ids: Record<number, number> = {};
      for (const [k, v] of Object.entries(c.factor_value_ids ?? {})) {
        ids[Number(k)] = v;
      }
      return {
        bioAssayId: c.bio_assay_id ?? 0,
        bioMaterialId: c.bio_material_id ?? 0,
        name: c.name ?? "",
        outlier: c.outlier ?? false,
        factorValueIds: ids,
      };
    }),
    factors: (wire.factors ?? []).map((w) => ({
      id: w.factor?.id ?? 0,
      name: w.factor?.name ?? "",
      description: w.factor?.description ?? "",
      type: w.factor?.type === "continuous" ? "continuous" : "categorical",
      category: { label: w.factor?.category ?? w.factor?.name ?? "", uri: w.factor?.category_uri ?? null },
      factor_values: (w.factor?.values ?? []).map((fv) => ({
        id: fv.id ?? 0,
        free_text_label: fv.factor_value ?? fv.description ?? "",
        is_baseline: !!fv.is_baseline,
        statements: [],
      })),
    })),
  };
}

export async function getHeatmapData(
  entityId: number,
  params: { genes?: number[]; sampleSize?: number; quantitationType?: number; maskOutliers?: boolean },
  decoration: GeneExpressionHeatmapDecoration,
): Promise<HeatmapPayload | null> {
  const wire = await api.get<WireHeatmap>(
    `/rest/v2/datasets/${entityId}/heatmap-data${qs({
      genes: params.genes && params.genes.length > 0 ? params.genes.join(",") : undefined,
      sampleSize: params.sampleSize,
      quantitationType: params.quantitationType,
      maskOutliers: params.maskOutliers === false ? "false" : undefined,
    })}`,
  );
  if (!wire?.matrix?.values?.length) return null;
  return adaptDecoratedHeatmapWire(wire, decoration);
}

export const geneExpressionApi: GeneExpressionApi = {
  searchGenes,
  searchGoTerms,
  getGoTermGenes,
  getHeatmapData,
  getQuantitationTypes,
  getPlatforms,
  resolveGene,
  resolveGoTermLabel,
};
