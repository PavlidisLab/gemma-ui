/**
 * The port is checked against Gemma's OWN published output, not against
 * itself: the fixture is GSE143419 read live from gemma2, and the
 * expected numbers are the bars Gemma 1.0's PCA+Factors chart draws for
 * that dataset. If these drift, the two surfaces have stopped agreeing
 * and one of them is now lying to a curator.
 *
 * 🛑 The fixture codes each level by its real FACTOR VALUE ID, because
 * that is what Gemma correlates against. The app codes by the level's
 * position in the draft factor — see the note in `gemmaStats.ts`. This
 * file tests the statistics, not that coding choice.
 */
import { describe, expect, it } from "vitest";
import {
  correlationForPvalue,
  kruskalWallisTest,
  pcFactorAssociation,
  rankTransform,
  spearmanRankCorrelation,
} from "@gemma/diagnostics";
import fixture from "./__fixtures__/gse143419.svd.json";

const PCS = fixture.pcs as number[][];
const F = fixture.factors as Record<string, number[]>;
const DATE = fixture.dateRun as number[];

/** What Gemma 1.0 draws for eid 17573, read off its chart. */
const GEMMA_1_0 = {
  "organism part": [0.83, 0.7, 0.7],
  block: [0.72, 0.7, 0.73],
  treatment: [0.05, 0.07, 0.05],
  "Date run": [0.36, 0.4, 0.71],
};

const across = (fn: (pc: number) => number) => [0, 1, 2].map(fn);

describe("Gemma's PC × factor statistic, on GSE143419", () => {
  it("reproduces Gemma's `Organism part` bars, including the Kruskal–Wallis fallback", () => {
    // PC1 takes the Spearman branch (the level order happens to track
    // the component); PC2 and PC3 take the KW fallback, which is why
    // both land at 0.70 despite Spearman reading 0.05 and 0.42.
    const codes = F["organism part#35078"];
    const got = across((pc) => pcFactorAssociation(PCS[pc], codes, "categorical"));
    got.forEach((v, i) => expect(v).toBeCloseTo(GEMMA_1_0["organism part"][i], 1));
  });

  it("reproduces Gemma's `Batch` bars from the same five groups", () => {
    // 🛑 `block` partitions the 224 samples IDENTICALLY to organism
    // part — same five groups, member for member — yet Gemma scores
    // them differently, because the Spearman branch reads the level
    // ORDER and the two factors' ids sort differently. Reproducing that
    // asymmetry is the sharpest evidence the port is faithful.
    const codes = F["block#35079"];
    const got = across((pc) => pcFactorAssociation(PCS[pc], codes, "categorical"));
    got.forEach((v, i) => expect(v).toBeCloseTo(GEMMA_1_0.block[i], 1));
  });

  it("reproduces Gemma's `Treatment` bars — two levels, so Spearman alone", () => {
    const codes = F["treatment#35076"];
    const got = across((pc) => pcFactorAssociation(PCS[pc], codes, "categorical"));
    got.forEach((v, i) => expect(v).toBeCloseTo(GEMMA_1_0.treatment[i], 1));
  });

  it("reproduces Gemma's `Date run` bars", () => {
    const got = across((pc) => pcFactorAssociation(PCS[pc], DATE, "continuous"));
    got.forEach((v, i) => expect(v).toBeCloseTo(GEMMA_1_0["Date run"][i], 1));
  });

  it("scores treatment far below organism part on PC1 — the reading that matters", () => {
    // The question this chart is on the page to answer.
    const region = pcFactorAssociation(PCS[0], F["organism part#35078"], "categorical");
    const treat = pcFactorAssociation(PCS[0], F["treatment#35076"], "categorical");
    expect(region).toBeGreaterThan(0.8);
    expect(treat).toBeLessThan(0.1);
  });
});

describe("the pieces", () => {
  it("gives tied values the average rank", () => {
    expect(rankTransform([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  it("is +1 / -1 for a monotone pair regardless of spacing", () => {
    expect(spearmanRankCorrelation([1, 2, 3, 4], [10, 200, 3000, 40000])).toBeCloseTo(1, 12);
    expect(spearmanRankCorrelation([1, 2, 3, 4], [40000, 3000, 200, 10])).toBeCloseTo(-1, 12);
  });

  it("drops pairs where either side is missing", () => {
    expect(spearmanRankCorrelation([1, 2, NaN, 4], [1, 2, 99, 4])).toBeCloseTo(1, 12);
  });

  it("inverts a p-value back to the correlation that produced it", () => {
    // Gemma's own step: z / sqrt(n-3), un-Fisher-transformed. These are
    // the two inversions that produce the 0.70 and 0.72 bars above.
    expect(correlationForPvalue(2.59e-38, 224)).toBeCloseTo(0.7, 2);
    expect(correlationForPvalue(7.2e-43, 224)).toBeCloseTo(0.73, 2);
    expect(correlationForPvalue(1, 224)).toBe(0);
  });

  it("finds the five-group split that a rank correlation can miss", () => {
    const codes = F["block#35079"];
    // Spearman on PC2 reads 0.40; Kruskal–Wallis says p ~ 1e-38.
    expect(Math.abs(spearmanRankCorrelation(PCS[1], codes))).toBeCloseTo(0.398, 2);
    expect(kruskalWallisTest(PCS[1], codes)).toBeLessThan(1e-30);
  });

  it("returns 1 for a factor with a single level", () => {
    expect(kruskalWallisTest([1, 2, 3, 4], [7, 7, 7, 7])).toBe(1);
  });
});
