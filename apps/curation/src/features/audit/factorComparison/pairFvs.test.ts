import { describe, expect, it } from "vitest";
import { pairFvs } from "./pairFvs";
import type { Factor } from "@/features/experiment/types";
import type { FactorComparisonPair } from "./FactorComparisonGrid";

/** Read an FV cell's label. A paired-row cell is
 *  ``GridFv | Continuation``; ``pairFvs`` never emits the
 *  ``CONTINUATION`` sentinel, so narrow it away for the assertion. */
function cellLabel(
  cell: FactorComparisonPair["left"] | FactorComparisonPair["right"] | undefined,
): string | undefined {
  if (cell == null || typeof cell === "symbol") return undefined;
  return cell.free_text_label;
}

/**
 * Contract tests for ``pairFvs`` — the greedy Jaccard-based FV
 * pairing helper (threshold ≥ 0.5).
 *
 * The function consumes two FactorLike objects and returns a
 * FactorComparisonPair[] whose ``status`` field drives the grid
 * column glyph. These tests lock the pairing semantics so future
 * refactors to the threshold / strategy can't silently break the
 * grid renderer.
 */

/** Minimal FV that satisfies the GridFv contract. */
function mkFv(
  label: string,
  bms: string[],
): Factor["factor_values"][number] {
  return {
    id: Math.random(),
    free_text_label: label,
    is_baseline: false,
    biomaterial_short_names: bms,
    statements: [],
  } as unknown as Factor["factor_values"][number];
}

/** Minimal factor-like wrapping an FV list. */
function mkFactor(
  fvs: Array<Factor["factor_values"][number]>,
): Factor {
  return { factor_values: fvs } as unknown as Factor;
}

describe("pairFvs — Jaccard biomaterial pairing (threshold ≥ 0.5)", () => {
  it("matched: identical biomaterial sets pair as 'same' when labels also match", () => {
    const bms = ["GSM1", "GSM2", "GSM3"];
    const left = mkFactor([mkFv("control", bms)]);
    const right = mkFactor([mkFv("control", bms)]);
    const pairs = pairFvs(left, right);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].status).toBe("same");
    expect(cellLabel(pairs[0].left)).toBe("control");
    expect(cellLabel(pairs[0].right)).toBe("control");
  });

  it("drift: overlapping biomaterials (Jaccard > 0.5) pair as 'drift' when labels differ", () => {
    // 3 shared, 1 extra each → Jaccard = 3/5 = 0.6 > 0.5
    const leftBms = ["GSM1", "GSM2", "GSM3", "GSM4"];
    const rightBms = ["GSM1", "GSM2", "GSM3", "GSM5"];
    const left = mkFactor([mkFv("rotenone 10 µM", leftBms)]);
    const right = mkFactor([mkFv("rotenone 10 uM", rightBms)]);
    const pairs = pairFvs(left, right);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].status).toBe("drift");
  });

  it("left_only: an FV with no matching right pair surfaces as 'left_only'", () => {
    const left = mkFactor([mkFv("treated", ["GSM10", "GSM11"])]);
    const right = mkFactor([mkFv("vehicle", ["GSM20", "GSM21"])]);
    // Jaccard = 0/4 = 0 — below threshold
    const pairs = pairFvs(left, right);
    expect(pairs.some((p) => p.status === "left_only")).toBe(true);
    const lOnly = pairs.find((p) => p.status === "left_only");
    expect(cellLabel(lOnly?.left)).toBe("treated");
    expect(lOnly?.right).toBeNull();
  });

  it("right_only: an FV present only on the right surfaces as 'right_only'", () => {
    // Left has one FV, right has two — the extra right FV can't pair.
    const left = mkFactor([mkFv("control", ["GSM1", "GSM2"])]);
    const right = mkFactor([
      mkFv("control", ["GSM1", "GSM2"]),
      mkFv("treated", ["GSM3", "GSM4"]),
    ]);
    const pairs = pairFvs(left, right);
    expect(pairs.some((p) => p.status === "right_only")).toBe(true);
    const rOnly = pairs.find((p) => p.status === "right_only");
    expect(cellLabel(rOnly?.right)).toBe("treated");
    expect(rOnly?.left).toBeNull();
  });

  it("threshold edge: Jaccard exactly 0.5 pairs (threshold is ≥ 0.5, inclusive)", () => {
    // 2 shared, 2 exclusive each → inter=2, union=6 — wait, union = 2+2+2 = 6
    // Actually: left=[A,B,C,D], right=[A,B,E,F] → inter=2, union=6, J=2/6≈0.33 — no.
    // For exactly 0.5: need inter/union = 0.5 → e.g. inter=2, union=4 → left=[A,B,C], right=[A,B,D]
    // inter={A,B}=2, union={A,B,C,D}=4, J=0.5
    const leftBms = ["A", "B", "C"];
    const rightBms = ["A", "B", "D"];
    const left = mkFactor([mkFv("control", leftBms)]);
    const right = mkFactor([mkFv("treated", rightBms)]);
    const pairs = pairFvs(left, right);
    // Jaccard = 2/4 = 0.5; code uses bestJ >= 0.5, so should pair.
    expect(pairs).toHaveLength(1);
    expect(pairs[0].status).toBe("drift"); // labels differ
    expect(pairs[0].left).not.toBeNull();
    expect(pairs[0].right).not.toBeNull();
  });

  it("threshold edge: Jaccard just below 0.5 does NOT pair (left_only + right_only)", () => {
    // inter=1, union=5 → J=0.2 < 0.5
    const leftBms = ["A", "B", "C"];
    const rightBms = ["A", "D", "E"];
    const left = mkFactor([mkFv("x", leftBms)]);
    const right = mkFactor([mkFv("y", rightBms)]);
    const pairs = pairFvs(left, right);
    expect(pairs).toHaveLength(2);
    expect(pairs.map((p) => p.status).sort()).toEqual(["left_only", "right_only"]);
  });

  it("empty inputs: both sides null → empty array", () => {
    expect(pairFvs(null, null)).toEqual([]);
  });

  it("empty inputs: left null, right has FVs → all right_only", () => {
    const right = mkFactor([mkFv("ctrl", ["GSM1"]), mkFv("treated", ["GSM2"])]);
    const pairs = pairFvs(null, right);
    expect(pairs).toHaveLength(2);
    expect(pairs.every((p) => p.status === "right_only")).toBe(true);
  });

  it("empty inputs: right null, left has FVs → all left_only", () => {
    const left = mkFactor([mkFv("ctrl", ["GSM1"]), mkFv("treated", ["GSM2"])]);
    const pairs = pairFvs(left, null);
    expect(pairs).toHaveLength(2);
    expect(pairs.every((p) => p.status === "left_only")).toBe(true);
  });

  it("large input N=20 each side: bijective pairing — each FV pairs with its correct counterpart", () => {
    // 20 FVs each with distinct, disjoint biomaterial sets (perfect 1-to-1 match).
    const leftFvs = Array.from({ length: 20 }, (_, i) =>
      mkFv(`fv-${i}`, [`GSM_L_${i}_a`, `GSM_L_${i}_b`, `GSM_L_${i}_c`]),
    );
    const rightFvs = Array.from({ length: 20 }, (_, i) =>
      mkFv(`fv-${i}`, [`GSM_L_${i}_a`, `GSM_L_${i}_b`, `GSM_L_${i}_c`]),
    );
    const left = mkFactor(leftFvs);
    const right = mkFactor(rightFvs);
    const pairs = pairFvs(left, right);
    // All 20 should pair as "same" (labels and biomaterials identical).
    expect(pairs).toHaveLength(20);
    expect(pairs.every((p) => p.status === "same")).toBe(true);
    // Each pair should be bijective — no repeated FV on either side.
    const usedLeft = new Set(pairs.map((p) => cellLabel(p.left)));
    const usedRight = new Set(pairs.map((p) => cellLabel(p.right)));
    expect(usedLeft.size).toBe(20);
    expect(usedRight.size).toBe(20);
  });

  it("greedy pairing is bijective — a right FV claimed by the best left cannot be stolen", () => {
    // L1 overlaps R1 (Jaccard=1) and R2 (Jaccard=0.5).
    // L2 overlaps R2 (Jaccard=1). Greedy best match for L1 → R1,
    // so L2 should pair with R2, not be left_only.
    const sharedBms = ["A", "B"];
    const left = mkFactor([
      mkFv("L1", sharedBms),
      mkFv("L2", ["C", "D"]),
    ]);
    const right = mkFactor([
      mkFv("R1", sharedBms),
      mkFv("R2", ["C", "D"]),
    ]);
    const pairs = pairFvs(left, right);
    expect(pairs).toHaveLength(2);
    expect(pairs.every((p) => p.status === "same" || p.status === "drift")).toBe(true);
    expect(pairs.some((p) => p.status === "left_only")).toBe(false);
    expect(pairs.some((p) => p.status === "right_only")).toBe(false);
  });
});
