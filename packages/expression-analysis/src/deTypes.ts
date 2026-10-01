// ─── Differential-expression wire shapes ───────────────────────────────────
//
// Mirror the Gemma REST VOs field-for-field (camelCase) — see
// apps/browser/src/lib/types.ts, which is where these were lifted from.
// Same rule as types.ts: each host's DifferentialExpressionApi
// implementation must hand back data in THIS shape regardless of its own
// transport casing.

export interface FactorValueVO {
  id?: number;
  value?: string | null;
  factor?: { name?: string | null; id?: number } | null;
}

export interface DiffExAnalysis {
  id: number;
  name?: string | null;
  bioAssaySetId?: number;
  numberOfDiffExpressedProbes?: number | null;
  subsetFactor?: { name?: string | null; id?: number } | null;
  subsetFactorValue?:
    | (FactorValueVO & {
        summary?: string | null;
        factorValue?: string | null;
        characteristics?: { value?: string | null }[];
      })
    | null;
  isSubset?: boolean | null;
  resultSets?: DiffExNestedResultSet[] | null;
}

export interface DiffExNestedResultSet {
  id: number;
  threshold?: number | null;
  numberOfProbesAnalyzed?: number | null;
  numberOfGenesAnalyzed?: number | null;
  numberOfDiffExpressedProbes?: number | null;
  numberOfUpregulatedProbes?: number | null;
  numberOfDownregulatedProbes?: number | null;
  upregulatedCount?: number | null;
  downregulatedCount?: number | null;
  experimentalFactors?:
    | {
        id?: number;
        name?: string | null;
        category?: string | null;
        description?: string | null;
      }[]
    | null;
  baselineGroup?:
    | {
        id?: number;
        factorValue?: string | null;
        characteristics?: { value?: string | null }[];
      }
    | null;
}

export interface PvalueDistribution {
  resultSetId: number;
  column: "raw" | "corrected";
  n: number;
  bins: { lo: number; hi: number; count: number }[];
}

// ─── Design shapes (only what the baseline/condition lookup needs) ────────

export interface FactorValueStatement {
  subject?: string | null;
  subjectUri?: string | null;
}

export interface FactorValueBasic {
  id: number;
  value?: string | null;
  summary?: string | null;
  isBaseline?: boolean | null;
  characteristics?: { value?: string | null; valueUri?: string | null }[];
  statements?: FactorValueStatement[];
}

export interface ExperimentalFactorEntry {
  id: number;
  name?: string | null;
  values: FactorValueBasic[];
}

export interface ExperimentalDesignForContrasts {
  experimentalFactors: ExperimentalFactorEntry[];
}

/**
 * Every data-fetching function `DifferentialExpressionPanel` needs.
 * `getDesign` is optional: without it, a contrast's non-baseline
 * condition level(s) can't be recovered (the analyses endpoint only
 * names the baseline, never what it was contrasted against), so the row
 * falls back to "baseline" / the raw baseline string with no condition
 * chips — still correct, just less informative.
 */
export interface DifferentialExpressionApi {
  getAnalyses(entityId: number, signal?: AbortSignal): Promise<DiffExAnalysis[]>;
  getPvalueDistribution(
    resultSetId: number,
    opts: { bins?: number; column?: "raw" | "corrected" },
    signal?: AbortSignal,
  ): Promise<PvalueDistribution | null>;
  downloadResultSetTsv(resultSetId: number, filename: string): Promise<void>;
  getDesign?(
    entityId: number,
    signal?: AbortSignal,
  ): Promise<ExperimentalDesignForContrasts | null>;
}
