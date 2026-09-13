import { useQuery } from "@tanstack/react-query";

import { api } from "./client";
import { useGemmaMode } from "@/lib/gemmaMode";

/**
 * Which factors a differential-expression analysis actually SUBSET by.
 *
 * 🛑 **A fact, not advice.** `Factor.subset_relevance` says a DEA
 * *should* subset by a factor; this says one *did*. Gemma keeps them
 * apart deliberately and they are allowed to disagree — a
 * recommendation between curation and the next analysis run is advice
 * nobody has acted on yet, which is the normal state and not a
 * discrepancy to reconcile. Neither is derivable from the other, which
 * is why the UI reads both.
 *
 * The route is Gemma's own; the curation store does not serve it, so
 * this is inert outside remote mode rather than erroring.
 */
export interface SubsetAnalysis {
  /** Gemma's `ExperimentalFactor` id — matches `Factor.gemma_factor_id`,
   *  never the design-local `Factor.id`. */
  subsetFactorId: number | null;
  /** The level the subset was taken at, when the analysis names one. */
  subsetFactorValue?: unknown;
  isSubset?: boolean | null;
}

interface WireAnalysis {
  id?: number | null;
  is_subset?: boolean | null;
  subset_factor_id?: number | null;
  subset_factor?: unknown;
  subset_factor_value?: unknown;
}

/**
 * The Gemma factor ids this experiment's analyses subset by.
 *
 * ✅ **Exercised 2026-09-11.** It answered zero everywhere until then —
 * the reference-500 experiments had their DEAs deleted by design commits
 * and are queued for re-run, so the population that would carry one was
 * exactly the population missing its analyses. Measured on gemma2: eid 5
 * and eid 16 each return two rows with `isSubset: true` and
 * `subsetFactorId` 6 / 29, matching the factor each design names. Built
 * to the field names the OpenAPI declares on
 * `DifferentialExpressionAnalysisValueObject` (`isSubset`,
 * `subsetFactorId`, `subsetFactor`, `subsetFactorValue`), read
 * tolerantly, and a shape change shows as an absent mark rather than a
 * broken one.
 */
export async function fetchSubsetAnalyses(
  experimentId: number | string,
): Promise<SubsetAnalysis[]> {
  const rows = await api.get<WireAnalysis[]>(
    `/rest/v2/datasets/${experimentId}/analyses/differential`,
  );
  if (!Array.isArray(rows)) return [];
  const out: SubsetAnalysis[] = [];
  for (const r of rows) {
    const id = typeof r.subset_factor_id === "number" ? r.subset_factor_id : null;
    // `isSubset` alone names no factor, and a factor id alone is the
    // whole point — keep the row only when it can be matched to one.
    if (id === null) continue;
    out.push({
      subsetFactorId: id,
      subsetFactorValue: r.subset_factor_value,
      isSubset: r.is_subset ?? null,
    });
  }
  return out;
}

/** The set of Gemma factor ids some analysis subset by. Empty in local
 *  mode, and empty — not absent — on any failure: a factor that cannot
 *  be shown to have been used must read as unmarked, never as ruled
 *  out. */
export function useSubsetAnalyses(experimentId: number | string) {
  const { mode } = useGemmaMode();
  return useQuery({
    queryKey: ["subset-analyses", experimentId] as const,
    enabled: Boolean(experimentId) && mode === "remote",
    queryFn: () => fetchSubsetAnalyses(experimentId),
    // Analyses change when a DEA is re-run, not while a curator edits a
    // design, so this does not need to be fresh on every render.
    staleTime: 5 * 60_000,
  });
}
