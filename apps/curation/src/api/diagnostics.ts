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

// ─── /sample-correlation ───────────────────────────────────────────

export interface SampleCorrelationMatrix {
  bioAssayIds: number[];
  /** Parallel to `bioAssayIds`. Entries may be `null` for assays
   *  whose name has not been set on the Gemma side. */
  bioAssayShortNames: (string | null)[];
  /** Symmetric N×N row-major; values in [-1, 1]. */
  values: number[][];
  /** Currently always null — placeholder for a probe-filter caption
   *  once `SampleCoexpressionAnalysisService` surfaces it. */
  filterDescription?: string | null;
  /** Currently always "pearson" — Gemma's only supported method. */
  method?: string | null;
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

// ─── /mean-variance ────────────────────────────────────────────────

export interface MeanVarianceData {
  /** Reserved — Gemma's `MeanVarianceRelation` does not currently
   *  carry design-element ids. UI indexes by position. */
  designElementIds?: (number | null)[] | null;
  /** Reserved — see `designElementIds`. */
  designElementNames?: (string | null)[] | null;
  /** Per-probe means (typically log-CPM or normalized intensity). */
  means: number[];
  /** Per-probe variances, parallel to `means`. */
  variances: number[];
  /** Reserved — `MeanVarianceRelation` does not currently expose a
   *  fit curve. */
  fit?: {
    sortedMeans: number[];
    fittedVariances: number[];
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

// ─── /svd/loadings — used by the PC-scree popup ────────────────────

export type PcLoadingsDirection = "both" | "positive" | "negative";

export interface PcLoadingsRow {
  /** Reserved — Gemma may emit null when the probe row no longer
   *  resolves to a `CompositeSequence`. */
  designElementId?: number | null;
  /** Probe / design-element name. */
  designElementName?: string | null;
  /** Reserved — gene-symbol enrichment via CompositeSequence → Gene
   *  is deferred. Currently always null. */
  geneSymbol?: string | null;
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
  bioAssayScores: Record<string, number>;
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
      getOrNull<{ data?: PcLoadings } | PcLoadings>(
        `/rest/v2/datasets/${experimentId}/svd/loadings?pc=${pc}&top=${top}&direction=${direction}`,
      ).then((raw) => {
        if (!raw) return null;
        if ("rows" in (raw as Record<string, unknown>)) {
          return raw as PcLoadings;
        }
        return (raw as { data?: PcLoadings }).data ?? null;
      }),
    enabled: experimentId > 0 && pc !== null,
  });
}
