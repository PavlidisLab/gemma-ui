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
 * carrying Gemma's own association statistic, in [0, 1].
 *
 * 🛑 This used to be η² for categorical factors and |Pearson r| for
 * continuous ones. Both are defensible and neither was Gemma's, so the
 * same dataset scored differently in the two places a curator can look
 * at it. It is now a faithful port of
 * `SVDServiceImpl.getSvdFactorAnalysis` — see `gemmaStats.ts` for the
 * rule and for the two documented departures.
 */

import { pcFactorAssociation } from "./gemmaStats";

export interface CategoricalLevel {
  /** Sample keys (anything stringy — bioMaterial id, short_name, etc.)
   *  carrying this level. */
  sampleKeys: string[];
  /** Human name for the level. Nothing in the association MATH reads
   *  it — it is here so a caller plotting the samples behind a bar can
   *  name the columns something better than "level 1". */
  label?: string;
  /** Numeric code for the level. Gemma uses the factor-value id; the
   *  level's position in the factor is the caller's fallback when no id
   *  is available. Only the Spearman branch reads it, and the
   *  Kruskal–Wallis branch exists to override that branch when the
   *  ordering turns out to carry nothing. Defaults to the index. */
  code?: number;
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
    // One (score-vector, covariate) pair per sample, in a stable order.
    // The covariate is the measurement for a continuous factor and the
    // level's code for a categorical one.
    const rows: { scores: number[]; code: number }[] = [];
    factor.levels.forEach((lvl, i) => {
      const code =
        factor.type === "continuous"
          ? (lvl as ContinuousLevel).x
          : ((lvl as CategoricalLevel).code ?? i);
      if (!Number.isFinite(code)) return;
      for (const sk of lvl.sampleKeys) {
        const scores = samples.get(sk);
        if (scores) rows.push({ scores, code });
      }
    });
    if (rows.length < 2) continue;

    const codes = rows.map((r) => r.code);
    const values: number[] = [];
    for (let pc = 0; pc < nPcs; pc++) {
      const v = pcFactorAssociation(
        rows.map((r) => r.scores[pc] ?? 0),
        codes,
        factor.type,
      );
      values.push(Number.isFinite(v) ? v : 0);
    }
    if (values.some((v) => v > 0)) {
      out.push({ label: factor.label, values });
    }
  }
  return out;
}
