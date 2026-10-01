/**
 * Differential expression browse — the curation-side
 * `DifferentialExpressionApi` for `@gemma/expression-analysis`'s
 * `DifferentialExpressionPanel`.
 *
 * Same Gemma REST endpoints apps/browser reads
 * (`/datasets/{id}/analyses/differential`,
 * `/resultSets/{id}/pvalueDistribution`, `/resultSets/{id}` for the TSV
 * download, `/datasets/{id}/design` for contrast condition labels).
 *
 * 🛑 Same snake_case decoding rule as `geneExpression.ts` — see that
 * file's header. `asList` below exists because this client's envelope
 * auto-unwrap only fires when `data` is the ONLY non-metadata key
 * (`client.ts`'s `unwrapGemmaEnvelope`); whether a given list endpoint
 * also carries pagination siblings isn't verified against a live
 * backend in this pass, so every list read tolerates both a bare array
 * (auto-unwrapped) and `{data: [...]}` (not).
 */
import { api, apiBlob } from "./client";
import type {
  DiffExAnalysis,
  DiffExNestedResultSet,
  DifferentialExpressionApi,
  ExperimentalDesignForContrasts,
  PvalueDistribution,
} from "@gemma/expression-analysis";

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

function asList<T>(x: T[] | { data?: T[] } | null | undefined): T[] {
  if (Array.isArray(x)) return x;
  return x?.data ?? [];
}

// ─── Wire shapes (snake_case) ───────────────────────────────────────────────

interface WireFactorValueVo {
  id?: number;
  value?: string | null;
  factor?: { name?: string | null; id?: number } | null;
}

interface WireDiffExNestedResultSet {
  id: number;
  threshold?: number | null;
  number_of_probes_analyzed?: number | null;
  number_of_diff_expressed_probes?: number | null;
  number_of_upregulated_probes?: number | null;
  number_of_downregulated_probes?: number | null;
  upregulated_count?: number | null;
  downregulated_count?: number | null;
  experimental_factors?: { id?: number; name?: string | null; category?: string | null; description?: string | null }[] | null;
  baseline_group?: { id?: number; factor_value?: string | null; characteristics?: { value?: string | null }[] } | null;
}

interface WireDiffExAnalysis {
  id: number;
  name?: string | null;
  bio_assay_set_id?: number;
  number_of_diff_expressed_probes?: number | null;
  subset_factor?: { name?: string | null; id?: number } | null;
  subset_factor_value?: (WireFactorValueVo & { summary?: string | null; factor_value?: string | null; characteristics?: { value?: string | null }[] }) | null;
  is_subset?: boolean | null;
  result_sets?: WireDiffExNestedResultSet[] | null;
}

function adaptResultSet(rs: WireDiffExNestedResultSet): DiffExNestedResultSet {
  return {
    id: rs.id,
    threshold: rs.threshold,
    numberOfProbesAnalyzed: rs.number_of_probes_analyzed,
    numberOfDiffExpressedProbes: rs.number_of_diff_expressed_probes,
    numberOfUpregulatedProbes: rs.number_of_upregulated_probes,
    numberOfDownregulatedProbes: rs.number_of_downregulated_probes,
    upregulatedCount: rs.upregulated_count,
    downregulatedCount: rs.downregulated_count,
    experimentalFactors: rs.experimental_factors,
    baselineGroup: rs.baseline_group
      ? {
          id: rs.baseline_group.id,
          factorValue: rs.baseline_group.factor_value,
          characteristics: rs.baseline_group.characteristics,
        }
      : null,
  };
}

export async function getAnalyses(entityId: number): Promise<DiffExAnalysis[]> {
  const r = await api.get<WireDiffExAnalysis[] | { data?: WireDiffExAnalysis[] }>(
    `/rest/v2/datasets/${entityId}/analyses/differential`,
  );
  return asList(r).map((a) => ({
    id: a.id,
    name: a.name,
    bioAssaySetId: a.bio_assay_set_id,
    numberOfDiffExpressedProbes: a.number_of_diff_expressed_probes,
    subsetFactor: a.subset_factor,
    subsetFactorValue: a.subset_factor_value
      ? {
          id: a.subset_factor_value.id,
          value: a.subset_factor_value.value,
          factor: a.subset_factor_value.factor,
          summary: a.subset_factor_value.summary,
          factorValue: a.subset_factor_value.factor_value,
          characteristics: a.subset_factor_value.characteristics,
        }
      : null,
    isSubset: a.is_subset,
    resultSets: (a.result_sets ?? []).map(adaptResultSet),
  }));
}

export async function getPvalueDistribution(
  resultSetId: number,
  opts: { bins?: number; column?: "raw" | "corrected" },
): Promise<PvalueDistribution | null> {
  interface WireDist {
    result_set_id: number;
    column: "raw" | "corrected";
    n: number;
    bins: { lo: number; hi: number; count: number }[];
  }
  // `client.ts`'s `request()` already returns `undefined` on a bare 204
  // (before attempting to parse a body) — no special-case needed here,
  // unlike apps/browser's own version which has to route around
  // `apiGet`'s unconditional `r.json()`.
  const r = await api.get<WireDist | undefined>(
    `/rest/v2/resultSets/${resultSetId}/pvalueDistribution${qs({ bins: opts.bins, column: opts.column })}`,
  );
  return r ? { resultSetId: r.result_set_id, column: r.column, n: r.n, bins: r.bins } : null;
}

/** `/resultSets/{id}` content-negotiates JSON vs TSV; `client.ts`'s
 *  `api.get` always asks JSON, so this goes through `apiBlob` with an
 *  explicit `Accept` instead. */
export async function downloadResultSetTsv(resultSetId: number, filename: string): Promise<void> {
  const blob = await apiBlob(`/rest/v2/resultSets/${resultSetId}`, {
    accept: "text/tab-separated-values",
  });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function getDesign(entityId: number): Promise<ExperimentalDesignForContrasts | null> {
  interface WireFv {
    id: number;
    value?: string | null;
    summary?: string | null;
    is_baseline?: boolean | null;
    characteristics?: { value?: string | null; value_uri?: string | null }[];
    statements?: { subject?: string | null; subject_uri?: string | null }[];
  }
  interface WireFactor {
    id: number;
    name?: string | null;
    values: WireFv[];
  }
  interface WireDesign {
    experimental_factors: WireFactor[];
  }
  const r = await api.get<WireDesign>(`/rest/v2/datasets/${entityId}/design`);
  if (!r) return null;
  return {
    experimentalFactors: (r.experimental_factors ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      values: (f.values ?? []).map((v) => ({
        id: v.id,
        value: v.value,
        summary: v.summary,
        isBaseline: v.is_baseline,
        characteristics: (v.characteristics ?? []).map((c) => ({ value: c.value, valueUri: c.value_uri })),
        statements: (v.statements ?? []).map((s) => ({ subject: s.subject, subjectUri: s.subject_uri })),
      })),
    })),
  };
}

export const differentialExpressionApi: DifferentialExpressionApi = {
  getAnalyses,
  getPvalueDistribution,
  downloadResultSetTsv,
  getDesign,
};
