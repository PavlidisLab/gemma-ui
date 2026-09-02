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
import { useMemo } from "react";
import {
  readDiagnosticsCache,
  writeDiagnosticsCache,
  type DiagnosticsKind,
} from "@/lib/diagnosticsCache";
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


/** Seed a diagnostics query from localStorage.
 *
 *  A within-TTL entry is handed to TanStack as `initialData` WITH its
 *  original timestamp, so the query counts as fresh and does not
 *  refetch — the point being that a reload costs nothing, not merely
 *  that it renders sooner. See `lib/diagnosticsCache.ts` for the
 *  generation-bump trap that comes with persisting parse output. */
function useCacheSeed<T>(
  kind: DiagnosticsKind,
  experimentId: number | string,
  variant?: string,
) {
  const hit = useMemo(
    () => readDiagnosticsCache<T>(kind, experimentId, variant),
    [kind, experimentId, variant],
  );
  return hit
    ? { initialData: hit.data, initialDataUpdatedAt: hit.updatedAt }
    : {};
}

export function useDatasetSvd(experimentId: number | string) {
  const seed = useCacheSeed<SvdResult | null>("svd", experimentId);
  return useQuery({
    queryKey: ["diagnostics", "svd", experimentId],
    queryFn: async () => {
      // api.get already unwraps Gemma's `{apiVersion, data}`
      // envelope and snakeifies the result, so what we receive
      // is the snake_case SvdResult directly.
      const r = await getOrNull<SvdResult>(
        `/rest/v2/datasets/${experimentId}/svd`,
      );
      writeDiagnosticsCache("svd", experimentId, r);
      return r;
    },
    enabled: Boolean(experimentId),
    ...seed,
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

/** The matrix, or the server's own reason for there not being one.
 *
 *  🛑 **A 404 here is no longer one thing.** Gemma began refusing this
 *  route for single-cell datasets on `e8ccbfaae0` (2026-08-31) with a
 *  sentence that explains itself:
 *
 *      "GSE282329 is a single-cell dataset; its sample correlation
 *       matrix is computed across cell types and is not served while
 *       that is being revised."
 *
 *  The card used to answer every 404 with a fixed guess — "hasn't been
 *  preprocessed, or the route isn't deployed" — and both halves of that
 *  guess are now wrong for a whole class of dataset, on a panel a
 *  curator consults to decide whether something is missing or broken.
 *  The reason travels so the card can print what the server said
 *  instead of what we assumed. */
export interface SampleCorrelationResult {
  matrix: SampleCorrelationMatrix | null;
  /** Empty when the matrix is present, or when the 404 carried no
   *  message. Never reworded — it is the server's sentence. */
  reason: string;
}

export function useSampleCorrelation(experimentId: number | string) {
  const seed = useCacheSeed<SampleCorrelationResult>(
    "sample-correlation",
    experimentId,
  );
  return useQuery<SampleCorrelationResult>({
    queryKey: ["diagnostics", "sample-correlation", experimentId],
    queryFn: async () => {
      try {
        const matrix = await api.get<SampleCorrelationMatrix>(
          `/rest/v2/datasets/${experimentId}/sample-correlation`,
        );
        const r = { matrix, reason: "" };
        writeDiagnosticsCache("sample-correlation", experimentId, r);
        return r;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 204)) {
          // Cached too: a 404 here is a real answer about the dataset
          // (not preprocessed, or single-cell and withheld), and it
          // carries the server's own sentence. Re-asking every reload
          // just to be told the same thing helps nobody.
          const r = { matrix: null, reason: e.detail || "" };
          writeDiagnosticsCache("sample-correlation", experimentId, r);
          return r;
        }
        throw e;
      }
    },
    enabled: Boolean(experimentId),
    ...seed,
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

export function useMeanVariance(experimentId: number | string) {
  const seed = useCacheSeed<MeanVarianceData | null>(
    "mean-variance",
    experimentId,
  );
  return useQuery({
    queryKey: ["diagnostics", "mean-variance", experimentId],
    queryFn: async () => {
      const r = await getOrNull<MeanVarianceData>(
        `/rest/v2/datasets/${experimentId}/mean-variance`,
      );
      writeDiagnosticsCache("mean-variance", experimentId, r);
      return r;
    },
    enabled: Boolean(experimentId),
    ...seed,
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
   *  is deferred. Currently always null; prefer `genes`. */
  gene_symbol?: string | null;
  /** The genes this probe maps to. The route has served these all
   *  along — the browser's copy of this panel renders symbols from
   *  them — and only curation's mirror of the type was missing it,
   *  which is why this panel showed bare probe ids while the browser's
   *  showed `App`, `Rab6a`, `Ndfip1`. Snake_case here because
   *  `client.ts` snakeifies the response; `probeRowLabel` wants the
   *  camel shape, so the popup maps across. */
  genes?: Array<{
    id?: number | null;
    ncbi_id?: number | null;
    official_symbol?: string | null;
    /** The gene's full name. Gemma calls it `name`, not
     *  `officialName` — verified on the wire, eid 40086 PC1:
     *  `{id, officialSymbol, name, ncbiId}`. */
    name?: string | null;
  }> | null;
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
  experimentId: number | string,
  pc: number | null,
  top = 50,
  direction: PcLoadingsDirection = "both",
) {
  // The popup varies by PC / depth / direction, so each combination is
  // its own entry rather than one overwriting the next.
  const variant = `${pc}:${top}:${direction}`;
  const seed = useCacheSeed<PcLoadings | null>(
    "pc-loadings",
    experimentId,
    variant,
  );
  return useQuery({
    queryKey: [
      "diagnostics",
      "pc-loadings",
      experimentId,
      pc,
      top,
      direction,
    ],
    queryFn: async () => {
      const r = await getOrNull<PcLoadings>(
        `/rest/v2/datasets/${experimentId}/svd/loadings?pc=${pc}&top=${top}&direction=${direction}`,
      );
      writeDiagnosticsCache("pc-loadings", experimentId, r, variant);
      return r;
    },
    enabled: Boolean(experimentId) && pc !== null,
    ...seed,
  });
}
