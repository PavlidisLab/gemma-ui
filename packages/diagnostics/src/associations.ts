/**
 * PC × factor association math — shared between curation + browser
 * even though each app shapes the design data differently. The math
 * is identical; the caller is responsible for normalising its app-
 * specific design shape into the neutral input we accept here.
 *
 * Inputs the caller provides:
 *
 *   1. `samples` — per-sample PC scores. The "sample" key is opaque to
 *      this module (browser uses bioMaterial id; curation uses biomaterial
 *      short_name). Whatever the caller picks must match between
 *      `samples` and the per-factor membership lists.
 *   2. `factors` — for each factor, its type and per-level membership.
 *      Levels for categorical factors have a list of sample keys;
 *      continuous-factor levels carry a numeric `x` per level alongside.
 *
 * Output: one row per factor with a `values[]` array of length nPcs
 * carrying either η² (categorical) or |Pearson r| (continuous). Both
 * metrics live in [0, 1] so the PcFactorBars chart can compare across
 * factors without re-scaling.
 */

import { mean, pearson } from "./math";

export interface CategoricalLevel {
  /** Sample keys (anything stringy — bioMaterial id, short_name, etc.)
   *  carrying this level. */
  sampleKeys: string[];
}

export interface ContinuousLevel {
  /** Numeric value for the level (NaN dropped before computing). */
  x: number;
  /** Sample keys carrying this level. */
  sampleKeys: string[];
}

export interface AssocFactor {
  /** Human label for the factor; threaded through into the
   *  PcFactorBars row label. */
  label: string;
  type: "categorical" | "continuous";
  levels: CategoricalLevel[] | ContinuousLevel[];
}

export interface PcFactorAssoc {
  /** Echoed back from the input factor for the consumer. */
  label: string;
  /** Per-PC association strength in [0, 1]. Length === nPcs. */
  values: number[];
}

export function computePcFactorAssociations(
  /** Sample key → PC scores. Length of the score array should be ≥ nPcs. */
  samples: Map<string, number[]>,
  factors: AssocFactor[],
  nPcs: number,
): PcFactorAssoc[] {
  const out: PcFactorAssoc[] = [];
  for (const factor of factors) {
    const values: number[] = [];
    if (factor.type === "continuous") {
      const points: { score: number[]; x: number }[] = [];
      for (const lvl of factor.levels as ContinuousLevel[]) {
        if (!Number.isFinite(lvl.x)) continue;
        for (const sk of lvl.sampleKeys) {
          const score = samples.get(sk);
          if (score) points.push({ score, x: lvl.x });
        }
      }
      for (let pc = 0; pc < nPcs; pc++) {
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.score[pc] ?? 0);
        values.push(Math.abs(pearson(xs, ys)));
      }
    } else {
      // Categorical: η² = SS_between / SS_total.
      const groups: number[][][] = []; // [levelIdx][pc] -> scores
      for (const lvl of factor.levels as CategoricalLevel[]) {
        const arr: number[][] = Array.from({ length: nPcs }, () => []);
        for (const sk of lvl.sampleKeys) {
          const score = samples.get(sk);
          if (!score) continue;
          for (let pc = 0; pc < nPcs; pc++) {
            arr[pc].push(score[pc] ?? 0);
          }
        }
        groups.push(arr);
      }
      for (let pc = 0; pc < nPcs; pc++) {
        const allScores: number[] = [];
        for (const g of groups) allScores.push(...g[pc]);
        const grand = mean(allScores);
        let ssTotal = 0;
        for (const s of allScores) ssTotal += (s - grand) ** 2;
        let ssBetween = 0;
        for (const g of groups) {
          if (g[pc].length === 0) continue;
          const gm = mean(g[pc]);
          ssBetween += g[pc].length * (gm - grand) ** 2;
        }
        values.push(ssTotal > 0 ? Math.min(1, ssBetween / ssTotal) : 0);
      }
    }
    if (values.some((v) => v > 0)) {
      out.push({ label: factor.label, values });
    }
  }
  return out;
}
