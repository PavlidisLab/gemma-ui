/**
 * Diagnostic-data fetches for the Diagnostics tab. All four
 * endpoints live as of 2026-05-23 (gemma-rest
 * `DatasetsWebService.java:4348-4483`):
 *
 *   - GET /datasets/{id}/svd
 *   - GET /datasets/{id}/sample-correlation
 *   - GET /datasets/{id}/mean-variance
 *   - GET /datasets/{id}/svd/loadings?pc=N&top=M&direction=both|positive|negative
 *
 * All four return `{data: T}` envelopes; 404 is "not yet computed"
 * (handled by `getOrNull` → `null` so the panel cards render an
 * empty state without a toast).
 *
 * PC↔factor correlations are computed client-side from `/svd` +
 * the in-memory design draft — no separate endpoint.
 */

import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "./client";

// ─── Shared swallow-404 helper ────────────────────────────────────

/** Swallow 404 / 204 as "no data computed yet"; bubble everything
 *  else. `api.client.unwrapGemmaEnvelope` now unwraps `{data: ...}`
 *  envelopes whether or not `apiVersion` is set, so no per-endpoint
 *  manual unwrap needed. */
async function getOrNull<T>(path: string): Promise<T | null> {
  try {
    return await api.get<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 204)) {
      return null;
    }
    throw e;
  }
}

// ─── /svd ─────────────────────────────────────────────────────────

/** SVD response shape (after snakeify). Gemma 2.0's
 *  `SimpleSVDValueObject` ships `bioAssayIds`+`vmatrix` as parallel
 *  arrays — `vmatrix[i]` is the right-singular-vector row for the
 *  i'th bioAssay, where `vmatrix[i][pc]` is the assay's score on
 *  PC (pc+1). Use `bioAssayScoresFromSvd` below to flatten into
 *  the per-id score map most consumers want. */
export interface SvdResult {
  /** Fraction-of-variance per PC, 0-indexed. */
  variances?: number[] | null;
  /** Parallel to `vmatrix` rows. */
  bio_assay_ids?: number[] | null;
  bio_material_ids?: number[] | null;
  /** Right-singular-vector matrix. Rows = bioAssays (parallel to
   *  bio_assay_ids), cols = PCs. */
  vmatrix?: number[][] | null;
  eigen_values?: number[] | null;
}

/** Flatten the SVD's parallel `bioAssayIds`+`vmatrix` arrays into
 *  a per-id score record (`{[bioAssayId]: scores[]}`) — the shape
 *  PC×factor's association math wants. */
export function bioAssayScoresFromSvd(
  svd: SvdResult | null | undefined,
): Record<string, number[]> | null {
  if (!svd?.bio_assay_ids || !svd?.vmatrix) return null;
  const out: Record<string, number[]> = {};
  const n = Math.min(svd.bio_assay_ids.length, svd.vmatrix.length);
  for (let i = 0; i < n; i++) {
    out[String(svd.bio_assay_ids[i])] = svd.vmatrix[i];
  }
  return out;
}

export function useDatasetSvd(experimentId: number) {
  return useQuery({
    queryKey: ["diagnostics", "svd", experimentId],
    queryFn: async () => {
      // api.get already unwraps Gemma's `{apiVersion, data}`
      // envelope and snakeifies the result, so what we receive
      // is the snake_case SvdResult directly.
      return await getOrNull<SvdResult>(
        `/rest/v2/datasets/${experimentId}/svd`,
      );
    },
    enabled: experimentId > 0,
  });
}

// ─── /sample-correlation ───────────────────────────────────────────

export interface SampleCorrelationMatrix {
  bio_assay_ids: number[];
  /** Parallel to `bio_assay_ids`. Entries may be `null` for assays
   *  whose name has not been set on the Gemma side. */
  bio_assay_short_names: (string | null)[];
  /** Symmetric N×N row-major; values in [-1, 1]. */
  values: number[][];
  /** bioAssay ids the curator manually flagged as outliers. */
  actual_outlier_bio_assay_ids?: number[] | null;
  /** bioAssay ids the outlier detector suggested. Disjoint from /
   *  overlap with actual depending on whether the curator
   *  accepted the detector's call. */
  predicted_outlier_bio_assay_ids?: number[] | null;
  /** Currently always null — placeholder for a probe-filter caption
   *  once `SampleCoexpressionAnalysisService` surfaces it. */
  filter_description?: string | null;
  /** Currently always "pearson" — Gemma's only supported method. */
  method?: string | null;
}

export function useSampleCorrelation(experimentId: number) {
  return useQuery({
    queryKey: ["diagnostics", "sample-correlation", experimentId],
    queryFn: () =>
      getOrNull<SampleCorrelationMatrix>(
        `/rest/v2/datasets/${experimentId}/sample-correlation`,
      ),
    enabled: experimentId > 0,
  });
}

// ─── /mean-variance ────────────────────────────────────────────────

export interface MeanVarianceData {
  /** Reserved — Gemma's `MeanVarianceRelation` does not currently
   *  carry design-element ids. UI indexes by position. */
  design_element_ids?: (number | null)[] | null;
  /** Reserved — see `design_element_ids`. */
  design_element_names?: (string | null)[] | null;
  /** Per-probe means (typically log-CPM or normalized intensity). */
  means: number[];
  /** Per-probe variances, parallel to `means`. */
  variances: number[];
  /** Reserved — `MeanVarianceRelation` does not currently expose a
   *  fit curve. */
  fit?: {
    sorted_means: number[];
    fitted_variances: number[];
  } | null;
  /** Reserved — placeholder for the producing method (e.g.
   *  `"limma_voom"`, `"edger_glmqlf"`, `"naive"`). Currently always
   *  `null`. */
  source?: string | null;
}

export function useMeanVariance(experimentId: number) {
  return useQuery({
    queryKey: ["diagnostics", "mean-variance", experimentId],
    queryFn: () =>
      getOrNull<MeanVarianceData>(
        `/rest/v2/datasets/${experimentId}/mean-variance`,
      ),
    enabled: experimentId > 0,
  });
}

// ─── /svd/loadings — used by the PC-scree popup ────────────────────

export type PcLoadingsDirection = "both" | "positive" | "negative";

export interface PcLoadingsRow {
  /** Reserved — Gemma may emit null when the probe row no longer
   *  resolves to a `CompositeSequence`. */
  design_element_id?: number | null;
  /** Probe / design-element name. */
  design_element_name?: string | null;
  /** Reserved — gene-symbol enrichment via CompositeSequence → Gene
   *  is deferred. Currently always null. */
  gene_symbol?: string | null;
  /** Loading on this PC. Sign is meaningful — `direction=both` sorts
   *  by `|loading|` desc; `positive` / `negative` filter and sort
   *  signed. */
  loading: number;
}

export interface PcLoadings {
  /** 1-indexed PC the payload is for. Mirrors the query. */
  pc: number;
  /** Top-N rows (capped server-side at 500). */
  rows: PcLoadingsRow[];
  /** bioAssayId (as string for JSON object key) → score on this PC.
   *  Pulled from the SVDResult's v-matrix column for the requested
   *  PC. */
  bio_assay_scores: Record<string, number>;
}

export function usePcLoadings(
  experimentId: number,
  pc: number | null,
  top = 50,
  direction: PcLoadingsDirection = "both",
) {
  return useQuery({
    queryKey: [
      "diagnostics",
      "pc-loadings",
      experimentId,
      pc,
      top,
      direction,
    ],
    queryFn: () =>
      getOrNull<PcLoadings>(
        `/rest/v2/datasets/${experimentId}/svd/loadings?pc=${pc}&top=${top}&direction=${direction}`,
      ),
    enabled: experimentId > 0 && pc !== null,
  });
}
