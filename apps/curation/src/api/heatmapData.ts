/**
 * `/datasets/{id}/heatmap-data` — the expression matrix, with the
 * design already attached.
 *
 * This is the endpoint the browser's Visualize tab uses, and it answers
 * the PC-loadings question directly: `?pcaComponent=N&pcaCount=50`
 * returns the top-loaded probes on that component together with their
 * EXPRESSION, the sample columns, and the experimental factors for the
 * annotation strips. One request, no join.
 *
 * 🛑 It replaces a rank-1 projection. The popup used to draw
 * `loading × sample score`, which is the outer product of two vectors —
 * every column a scaled copy of one pattern, by construction. That
 * shows the shape of the PC, not the data of the genes driving it
 * (Paul, 2026-09-02: "I want to show the DATA for these genes").
 *
 * 🛑 Fields arrive snake_case: `client.ts` snakeifies every response.
 * The browser reads the same endpoint camelCase and has its own
 * adapter — the shapes differ only in casing, and normalising at this
 * boundary is the rule, so this file is the one place that knows.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import type { HeatmapPayload } from "@gemma/heatmap";
import { probeRowLabel } from "@gemma/heatmap";

interface WireGene {
  id?: number | null;
  official_symbol?: string | null;
  name?: string | null;
  ncbi_id?: number | null;
}

interface WireHeatmap {
  dataset_id?: number;
  matrix?: {
    values?: Array<Array<number | string | null>>;
    rows_count?: number;
    cols_count?: number;
    quantitation_type?: {
      name?: string;
      is_preferred?: boolean;
      is_ratio?: boolean;
      scale?: string;
    } | null;
  } | null;
  rows?: Array<{
    design_element_id?: number | string | null;
    design_element_name?: string | null;
    genes?: WireGene[] | null;
  }> | null;
  columns?: Array<{
    bio_assay_id?: number;
    bio_material_id?: number;
    name?: string;
    outlier?: boolean;
    factor_value_ids?: Record<string, number> | null;
  }> | null;
  factors?: Array<{
    factor?: {
      id?: number;
      name?: string;
      description?: string;
      type?: string;
      category?: string | null;
      category_uri?: string | null;
      /** 🛑 `values`, NOT `factor_values`. The wire carries both: the
       *  latter is a DEBUG STRING ("FactorValue Id=287479
       *  Characteristics=…"), the former the real list. Mapping the
       *  string left every strip grey, because a strip takes its
       *  colours from the factor's value list. */
      values?: Array<{
        id?: number;
        factor_value?: string | null;
        description?: string | null;
        is_baseline?: boolean;
      }> | null;
    } | null;
  }> | null;
}

/** Attach the component's own sample scores as a continuous strip.
 *
 *  🛑 A synthetic factor, id NEGATIVE so it cannot collide with a real
 *  `ExperimentalFactor` id — the widget keys grouping and strip
 *  identity off that id. It carries `continuousMeasurements`, which is
 *  what makes the widget draw it as a gradient rather than as
 *  categorical blocks, so it reads as a different KIND of thing from
 *  the design strips beside it while staying continuous.
 *
 *  Point of it: the heatmap answers "what do these genes do", and the
 *  strip answers "and here is the component that picked them", against
 *  the same columns in the same order (Paul, 2026-09-02). */
export function withPcScoreStrip(
  payload: HeatmapPayload | null,
  pc: number,
  scoresByBioAssayId: Record<number, number> | null,
): HeatmapPayload | null {
  if (!payload || !scoresByBioAssayId) return payload;
  const measurements: Record<number, number> = {};
  for (const c of payload.columns) {
    const s = scoresByBioAssayId[c.bioAssayId];
    if (typeof s === "number" && Number.isFinite(s)) {
      measurements[c.bioAssayId] = s;
    }
  }
  if (Object.keys(measurements).length === 0) return payload;
  return {
    ...payload,
    factors: [
      ...payload.factors,
      {
        id: -pc,
        name: `PC${pc} score`,
        description: `sample score on principal component ${pc}`,
        type: "continuous",
        category: { label: `PC${pc} score`, uri: null },
        factor_values: [],
        continuousMeasurements: measurements,
      },
    ],
  };
}

/** Top-loaded probes on a principal component, with their expression. */
export function usePcaHeatmapData(
  experimentId: number | string,
  pc: number | null,
  count = 50,
) {
  return useQuery({
    queryKey: ["heatmap-data", "pca", experimentId, pc, count],
    queryFn: async () => {
      const wire = await api.get<WireHeatmap>(
        `/rest/v2/datasets/${experimentId}/heatmap-data?pcaComponent=${pc}&pcaCount=${count}`,
      );
      return adaptHeatmapWire(wire);
    },
    enabled: Boolean(experimentId) && pc !== null,
    staleTime: 5 * 60_000,
  });
}

/** Wire → `HeatmapPayload`. Returns null when the matrix is absent, so
 *  the caller renders its empty state rather than an empty grid. */
export function adaptHeatmapWire(
  wire: WireHeatmap | null | undefined,
): HeatmapPayload | null {
  const m = wire?.matrix;
  if (!m?.values?.length) return null;

  const values = m.values.map((row) =>
    row.map((v) => {
      // Some builds serialize numbers as strings, and NaN as the STRING
      // "NaN" — see reference_gemma_serializes_nan_as_a_string. A null
      // is the NA colour; a wrong number is a lie.
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    }),
  );

  return {
    datasetId: wire?.dataset_id ?? 0,
    matrix: {
      values,
      rows: m.rows_count ?? values.length,
      cols: m.cols_count ?? (values[0]?.length ?? 0),
      quantitationType: {
        name: m.quantitation_type?.name ?? "",
        isPreferred: m.quantitation_type?.is_preferred ?? false,
        isRatio: m.quantitation_type?.is_ratio ?? false,
        scale: m.quantitation_type?.scale ?? "",
      },
    },
    rows: (wire?.rows ?? []).map((r, i) => {
      const genes = (r.genes ?? []).map((g) => ({
        id: g.id ?? 0,
        officialSymbol: g.official_symbol ?? null,
        name: g.name ?? null,
        ncbiId: g.ncbi_id ?? null,
      }));
      // Same resolver the browser's copy and the expression heatmap
      // use, so one probe cannot read three ways in three panels.
      const label = probeRowLabel({
        genes,
        designElementName: r.design_element_name ?? null,
        designElementId: Number(r.design_element_id) || null,
      });
      return {
        designElementId: Number(r.design_element_id) || i,
        designElementName: r.design_element_name ?? "",
        geneIds: genes.map((g) => g.id),
        geneSymbols: genes.map((g) => g.officialSymbol ?? ""),
        geneNames: genes.map((g) => g.name ?? ""),
        labelSymbol: label.symbol,
        labelName: label.name,
      };
    }),
    columns: (wire?.columns ?? []).map((c) => {
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
    factors: (wire?.factors ?? []).map((w) => ({
      id: w.factor?.id ?? 0,
      name: w.factor?.name ?? "",
      description: w.factor?.description ?? "",
      type: w.factor?.type === "continuous" ? "continuous" : "categorical",
      category: {
        label: w.factor?.category ?? w.factor?.name ?? "",
        uri: w.factor?.category_uri ?? null,
      },
      factor_values: (w.factor?.values ?? []).map((fv) => ({
        id: fv.id ?? 0,
        free_text_label: fv.factor_value ?? fv.description ?? "",
        is_baseline: !!fv.is_baseline,
        statements: [],
      })),
    })),
  };
}
