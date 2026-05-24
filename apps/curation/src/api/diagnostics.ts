/**
 * Diagnostic-data fetches for the Diagnostics tab. Four endpoints:
 *
 *   - /svd                         → PCA variance + PC scores (exists)
 *   - /sample-correlation          → N×N sample corr matrix     (TBD bro)
 *   - /mean-variance               → per-probe MV scatter        (TBD bro)
 *   - /svd/loadings?pc=N&top=M     → top-loaded genes per PC     (TBD bro)
 *
 * Endpoints that don't exist yet are wired with a 404-tolerant
 * fallback that resolves to `null`; the panel cards render a "not
 * yet computed" empty state until they land. See
 * `~/Dev/eclipseworkspace/Gemma/handoffs/HANDOFF_DIAGNOSTICS_REST_ENDPOINTS.md`
 * for the shapes the UI is wired to consume.
 *
 * PC↔factor correlations are computed client-side from `/svd` +
 * the in-memory design draft — no endpoint needed.
 */

import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "./client";

// ─── Shared swallow-404 helper ────────────────────────────────────

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

/** Mirrors the Java VO shape (also typed in browser app's
 *  `lib/types.ts`). Duplicated here so the curation app doesn't
 *  cross-app import. */
export interface SvdResult {
  /** Fraction-of-variance per PC, 0-indexed. */
  variances?: number[] | null;
  /** bioAssayId (as string) → component scores. */
  bioAssayScores?: Record<string, number[]> | null;
  eigenValues?: number[] | null;
}

export function useDatasetSvd(experimentId: number) {
  return useQuery({
    queryKey: ["diagnostics", "svd", experimentId],
    queryFn: async () => {
      // Real Gemma returns `{data: SvdResult}`; local_api may
      // mirror that envelope or not, depending on which endpoints
      // bro has folded in. Try the enveloped shape first and fall
      // through to bare. Either way, normalize to `SvdResult | null`.
      const raw = await getOrNull<{ data?: SvdResult } | SvdResult>(
        `/rest/v2/datasets/${experimentId}/svd`,
      );
      if (!raw) return null;
      if ("variances" in raw || "bioAssayScores" in raw) {
        return raw as SvdResult;
      }
      return (raw as { data?: SvdResult }).data ?? null;
    },
    enabled: experimentId > 0,
  });
}

// ─── /sample-correlation (TBD bro) ─────────────────────────────────

export interface SampleCorrelationMatrix {
  bioAssayIds: number[];
  bioAssayShortNames: string[];
  /** Symmetric N×N row-major; values in [-1, 1]. */
  values: number[][];
  filterDescription?: string | null;
  method?: string;
}

export function useSampleCorrelation(experimentId: number) {
  return useQuery({
    queryKey: ["diagnostics", "sample-correlation", experimentId],
    queryFn: () =>
      getOrNull<{ data?: SampleCorrelationMatrix } | SampleCorrelationMatrix>(
        `/rest/v2/datasets/${experimentId}/sample-correlation`,
      ).then((raw) => {
        if (!raw) return null;
        if ("values" in raw) return raw as SampleCorrelationMatrix;
        return (raw as { data?: SampleCorrelationMatrix }).data ?? null;
      }),
    enabled: experimentId > 0,
  });
}

// ─── /mean-variance (TBD bro) ──────────────────────────────────────

export interface MeanVarianceData {
  designElementIds: number[];
  designElementNames?: (string | null)[];
  means: number[];
  variances: number[];
  fit?: {
    sortedMeans: number[];
    fittedVariances: number[];
  } | null;
  source?: string;
}

export function useMeanVariance(experimentId: number) {
  return useQuery({
    queryKey: ["diagnostics", "mean-variance", experimentId],
    queryFn: () =>
      getOrNull<{ data?: MeanVarianceData } | MeanVarianceData>(
        `/rest/v2/datasets/${experimentId}/mean-variance`,
      ).then((raw) => {
        if (!raw) return null;
        if ("means" in raw) return raw as MeanVarianceData;
        return (raw as { data?: MeanVarianceData }).data ?? null;
      }),
    enabled: experimentId > 0,
  });
}

// ─── /svd/loadings (TBD bro) — used by the PC-scree popup ──────────

/** Reuses the heatmap-payload shape so the popup can hand the
 *  result straight to <HeatmapWidget payload={…}> without
 *  reshaping. Bro: this is the same wire shape as
 *  /datasets/{id}/heatmap-data, just filtered to the top-N gene
 *  loadings on the requested PC. */
export interface PcLoadingsHeatmap {
  // Lightweight passthrough; the heatmap widget knows the full
  // schema. We don't re-type it here.
  [k: string]: unknown;
}

export function usePcLoadings(
  experimentId: number,
  pc: number | null,
  top = 50,
) {
  return useQuery({
    queryKey: ["diagnostics", "pc-loadings", experimentId, pc, top],
    queryFn: () =>
      getOrNull<{ data?: PcLoadingsHeatmap } | PcLoadingsHeatmap>(
        `/rest/v2/datasets/${experimentId}/svd/loadings?pc=${pc}&top=${top}`,
      ).then((raw) => {
        if (!raw) return null;
        if (
          "rows" in (raw as Record<string, unknown>) ||
          "bioAssayIds" in (raw as Record<string, unknown>)
        ) {
          return raw as PcLoadingsHeatmap;
        }
        return (raw as { data?: PcLoadingsHeatmap }).data ?? null;
      }),
    enabled: experimentId > 0 && pc !== null,
  });
}
