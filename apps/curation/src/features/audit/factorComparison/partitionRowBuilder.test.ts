/**
 * Tests for the partition_mismatch → row builder (Option B).
 *
 * The builder emits rowspan-aware ``FactorComparisonPair[]`` so the
 * shared grid renders the umbrella side ONCE across its child rows
 * instead of duplicating the label + count. Anchored on the
 * GSE165287 organism-part agent_coarser case Paul caught
 * 2026-06-16 ("you have the numbers shown twice").
 *
 * Spec:
 *   - agent_finer:    gold side rowspans (LEFT umbrella)
 *   - agent_coarser:  agent side rowspans (RIGHT umbrella)
 *   - cross_cutting / unknown: flat per-row (no rowspan)
 *
 * Tests cover the row count, rowspan placement, CONTINUATION
 * markers on subsequent rows, and the cross_cutting fallback.
 */

import { describe, expect, it } from "vitest";
import {
  buildPartitionMismatchPairs,
  type PartitionFvPairInput,
} from "./partitionRowBuilder";
import {
  CONTINUATION,
  type FactorComparisonPair,
} from "./FactorComparisonGrid";

// Lightweight projector — returns a minimal grid-compatible shape;
// the grid renders FvDisplayRow which reads free_text_label +
// statements + biomaterial_short_names.
function project(
  term: { label: string; uri: string | null },
  _stmt: unknown,
  samples: readonly string[] | null,
) {
  return {
    free_text_label: term.label,
    statements: [],
    biomaterial_short_names: samples ? [...samples] : [],
  } as unknown as FactorComparisonPair["left"];
}

function makePair(
  agentLabel: string,
  goldLabel: string,
  agentN: number,
  goldN: number,
): PartitionFvPairInput {
  return {
    agent: { label: agentLabel, uri: null },
    gold: { label: goldLabel, uri: null },
    agent_biomaterial_short_names: Array.from(
      { length: agentN },
      (_, i) => `A${i}`,
    ),
    gold_biomaterial_short_names: Array.from(
      { length: goldN },
      (_, i) => `G${i}`,
    ),
  };
}

describe("buildPartitionMismatchPairs — agent_coarser", () => {
  // Anchor: GSE165287 organism part — 1 agent FV (frontal cortex, 20
  // samples) merging 2 gold child FVs (L hemi 10, R hemi 10).
  const input: PartitionFvPairInput[] = [
    makePair("frontal cortex", "frontal cortex L", 20, 10),
    makePair("frontal cortex", "frontal cortex R", 20, 10),
  ];

  it("emits one row per fv_pair", () => {
    const rows = buildPartitionMismatchPairs({
      direction: "agent_coarser",
      fvPairs: input,
      project,
    });
    expect(rows).toHaveLength(2);
  });

  it("the FIRST row carries the agent FV with rightRowSpan = group size", () => {
    const rows = buildPartitionMismatchPairs({
      direction: "agent_coarser",
      fvPairs: input,
      project,
    });
    expect(rows[0].right).not.toBe(CONTINUATION);
    expect(rows[0].rightRowSpan).toBe(2);
    expect(rows[0].leftRowSpan).toBeUndefined();
  });

  it("subsequent rows mark the agent side as CONTINUATION (so the grid skips it)", () => {
    const rows = buildPartitionMismatchPairs({
      direction: "agent_coarser",
      fvPairs: input,
      project,
    });
    expect(rows[1].right).toBe(CONTINUATION);
  });

  it("every row's LEFT side renders the child gold FV (no rowspan)", () => {
    const rows = buildPartitionMismatchPairs({
      direction: "agent_coarser",
      fvPairs: input,
      project,
    });
    expect(rows[0].left).not.toBe(CONTINUATION);
    expect(rows[1].left).not.toBe(CONTINUATION);
  });

  it("shows the per-FV count on each grouped Current (left) child chip", () => {
    // The cluster mid shows one total (20 ↔ 20); the individual grouped
    // Current counts (10, 10 here; 31, 9 on GSE306566) must still read on
    // their own chips. leftShowSampleCount drives the FvDisplayRow badge.
    const rows = buildPartitionMismatchPairs({
      direction: "agent_coarser",
      fvPairs: input,
      project,
    });
    expect(rows[0].leftShowSampleCount).toBe(true);
    expect(rows[1].leftShowSampleCount).toBe(true);
    // The umbrella (agent/right) side keeps its count in the cluster mid.
    expect(rows[0].rightShowSampleCount).toBeUndefined();
  });

  it("groups multiple agent umbrellas independently (3 umbrellas × 2 children = 6 rows)", () => {
    const fvPairs: PartitionFvPairInput[] = [
      makePair("frontal cortex", "frontal cortex L", 20, 10),
      makePair("frontal cortex", "frontal cortex R", 20, 10),
      makePair("striatum", "striatum L", 20, 10),
      makePair("striatum", "striatum R", 20, 10),
      makePair("hippocampus", "Ammon L", 20, 10),
      makePair("hippocampus", "Ammon R", 20, 10),
    ];
    const rows = buildPartitionMismatchPairs({
      direction: "agent_coarser",
      fvPairs,
      project,
    });
    expect(rows).toHaveLength(6);
    expect(rows[0].rightRowSpan).toBe(2);
    expect(rows[1].right).toBe(CONTINUATION);
    expect(rows[2].rightRowSpan).toBe(2);
    expect(rows[3].right).toBe(CONTINUATION);
    expect(rows[4].rightRowSpan).toBe(2);
    expect(rows[5].right).toBe(CONTINUATION);
  });
});

describe("buildPartitionMismatchPairs — agent_finer", () => {
  // Mirror case: 1 gold FV split into 2 agent child FVs. Gold side
  // is the umbrella → leftRowSpan on the first row, LEFT is
  // CONTINUATION on subsequent rows.
  const input: PartitionFvPairInput[] = [
    makePair("treated_dose_low", "treated", 5, 10),
    makePair("treated_dose_high", "treated", 5, 10),
  ];

  it("the FIRST row carries the gold FV with leftRowSpan = group size", () => {
    const rows = buildPartitionMismatchPairs({
      direction: "agent_finer",
      fvPairs: input,
      project,
    });
    expect(rows[0].left).not.toBe(CONTINUATION);
    expect(rows[0].leftRowSpan).toBe(2);
    expect(rows[0].rightRowSpan).toBeUndefined();
  });

  it("subsequent rows mark the LEFT (gold) side as CONTINUATION", () => {
    const rows = buildPartitionMismatchPairs({
      direction: "agent_finer",
      fvPairs: input,
      project,
    });
    expect(rows[1].left).toBe(CONTINUATION);
  });

  it("every row's RIGHT side renders the child agent FV", () => {
    const rows = buildPartitionMismatchPairs({
      direction: "agent_finer",
      fvPairs: input,
      project,
    });
    expect(rows[0].right).not.toBe(CONTINUATION);
    expect(rows[1].right).not.toBe(CONTINUATION);
  });
});

describe("buildPartitionMismatchPairs — cross_cutting + unknown", () => {
  it("cross_cutting renders a flat per-row shape with no rowspans", () => {
    const fvPairs: PartitionFvPairInput[] = [
      makePair("A", "X", 5, 5),
      makePair("A", "Y", 5, 5),
      makePair("B", "X", 5, 5),
    ];
    const rows = buildPartitionMismatchPairs({
      direction: "cross_cutting",
      fvPairs,
      project,
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.leftRowSpan == null)).toBe(true);
    expect(rows.every((r) => r.rightRowSpan == null)).toBe(true);
    expect(rows.every((r) => r.left !== CONTINUATION)).toBe(true);
    expect(rows.every((r) => r.right !== CONTINUATION)).toBe(true);
  });

  it("unknown direction also falls through to flat shape (defensive)", () => {
    const rows = buildPartitionMismatchPairs({
      direction: "future_kind_we_dont_know" as never,
      fvPairs: [makePair("X", "Y", 5, 5)],
      project,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].leftRowSpan).toBeUndefined();
    expect(rows[0].rightRowSpan).toBeUndefined();
  });
});

describe("buildPartitionMismatchPairs — 1:1 detection (label drift)", () => {
  // When every umbrella key has exactly one child, the agent_finer /
  // agent_coarser tag is a misclassification — the partition is 1:1
  // with label drift. Builder still emits one row per pair with
  // rowSpan=1 (effectively no rowspan), which is the right shape.
  it("agent_finer with 1:1 pairs has rowSpan=1 on every row (effectively flat)", () => {
    const fvPairs: PartitionFvPairInput[] = [
      makePair("CR", "calorie restricted", 6, 6),
      makePair("ad libitum", "RSR", 6, 6),
    ];
    const rows = buildPartitionMismatchPairs({
      direction: "agent_finer",
      fvPairs,
      project,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].leftRowSpan).toBe(1);
    expect(rows[1].leftRowSpan).toBe(1);
    expect(rows.every((r) => r.left !== CONTINUATION)).toBe(true);
  });
});
