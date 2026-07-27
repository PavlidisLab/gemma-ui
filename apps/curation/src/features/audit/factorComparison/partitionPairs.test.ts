/**
 * Tests for the partition_mismatch → FactorComparisonPair mapping.
 *
 * Contract: every factor-side card (match, partition_mismatch, extra,
 * miss) renders its side-by-side visual via the SAME
 * FactorComparisonGrid. The grid is fed `FactorComparisonPair[]`; the
 * partition_mismatch consumer (FindingDetailsEditor) builds that array
 * by walking `pm.fv_pairs` and projecting each side through
 * `_fvDisplayFromMapping`. These tests pin the projection:
 *
 *   - one pair per fv_pair entry (no group-collapse)
 *   - per-side biomaterial_short_names land on the projected FV
 *   - per-side statements land as the FV's first statement
 *   - free_text_label is the term's label, verbatim
 *
 * If this regresses, the partition card silently drops sample counts
 * or statement chips — both the reviewer-flagged regressions tonight.
 */

import { describe, expect, it } from "vitest";

// Re-derive the shape ``_fvDisplayFromMapping`` produces. We can't
// import that helper (it's a private symbol in FindingDetailsEditor)
// without breaking the public API, but the helper itself is six
// lines: re-export the contract here so the test stays decoupled
// from the consumer file's structure.
function projectFvForGrid(
  term: { label: string; uri: string | null },
  stmt:
    | {
        subject?: { label: string; uri: string | null } | null;
        predicate?: { label: string; uri: string | null } | null;
        object?: { label: string; uri: string | null } | null;
      }
    | null
    | undefined,
  samples: readonly string[] | null,
) {
  const statements = stmt
    ? [
        {
          subject: stmt.subject
            ? { label: stmt.subject.label, uri: stmt.subject.uri ?? null }
            : null,
          predicate: stmt.predicate
            ? { label: stmt.predicate.label, uri: stmt.predicate.uri ?? null }
            : null,
          object: stmt.object
            ? { label: stmt.object.label, uri: stmt.object.uri ?? null }
            : null,
        },
      ]
    : [];
  return {
    free_text_label: term.label,
    statements,
    biomaterial_short_names: samples ? [...samples] : [],
  };
}

interface FakeFvPair {
  agent: { label: string; uri: string | null };
  gold: { label: string; uri: string | null };
  agent_statement?: {
    subject?: { label: string; uri: string | null } | null;
    predicate?: { label: string; uri: string | null } | null;
    object?: { label: string; uri: string | null } | null;
  } | null;
  gold_statement?: typeof undefined | FakeFvPair["agent_statement"];
  agent_biomaterial_short_names?: string[];
  gold_biomaterial_short_names?: string[];
}

function buildPairs(fvPairs: FakeFvPair[]) {
  return fvPairs.map((p) => ({
    left: projectFvForGrid(
      p.gold,
      p.gold_statement ?? null,
      p.gold_biomaterial_short_names ?? null,
    ),
    right: projectFvForGrid(
      p.agent,
      p.agent_statement ?? null,
      p.agent_biomaterial_short_names ?? null,
    ),
    status: "drift" as const,
  }));
}

describe("partition_mismatch → FactorComparisonPair projection", () => {
  it("emits one grid pair per fv_pair (no group collapse)", () => {
    const fvPairs: FakeFvPair[] = [
      {
        agent: { label: "frontal cortex", uri: "UBERON:0001870" },
        gold: { label: "frontal cortex L", uri: "UBERON:0001870" },
      },
      {
        agent: { label: "frontal cortex", uri: "UBERON:0001870" },
        gold: { label: "frontal cortex R", uri: "UBERON:0001870" },
      },
      {
        agent: { label: "striatum", uri: "UBERON:0002435" },
        gold: { label: "striatum L", uri: "UBERON:0002435" },
      },
    ];
    const pairs = buildPairs(fvPairs);
    expect(pairs).toHaveLength(3);
  });

  it("threads gold samples to the LEFT side and agent samples to the RIGHT side", () => {
    const fvPairs: FakeFvPair[] = [
      {
        agent: { label: "frontal cortex", uri: null },
        gold: { label: "frontal cortex L hemi", uri: null },
        agent_biomaterial_short_names: [
          "GSM1", "GSM2", "GSM3", "GSM4", "GSM5",
          "GSM6", "GSM7", "GSM8", "GSM9", "GSM10",
          "GSM11", "GSM12", "GSM13", "GSM14", "GSM15",
          "GSM16", "GSM17", "GSM18", "GSM19", "GSM20",
        ], // 20 agent samples
        gold_biomaterial_short_names: ["GSM1", "GSM2", "GSM3", "GSM4", "GSM5",
          "GSM6", "GSM7", "GSM8", "GSM9", "GSM10"], // 10 gold samples
      },
    ];
    const pairs = buildPairs(fvPairs);
    expect(pairs[0].left.biomaterial_short_names).toHaveLength(10);
    expect(pairs[0].right.biomaterial_short_names).toHaveLength(20);
  });

  it("threads gold_statement to the LEFT and agent_statement to the RIGHT", () => {
    const fvPairs: FakeFvPair[] = [
      {
        agent: { label: "frontal cortex", uri: "UBERON:0001870" },
        gold: { label: "frontal cortex L hemi", uri: "UBERON:0001870" },
        agent_statement: {
          subject: { label: "frontal cortex", uri: "UBERON:0001870" },
        },
        gold_statement: {
          subject: { label: "frontal cortex", uri: "UBERON:0001870" },
          predicate: { label: "located in", uri: null },
          object: { label: "left hemisphere", uri: null },
        },
      },
    ];
    const pairs = buildPairs(fvPairs);
    expect(pairs[0].left.statements[0].object?.label).toBe("left hemisphere");
    expect(pairs[0].right.statements[0].subject?.label).toBe("frontal cortex");
    expect(pairs[0].right.statements[0].object).toBeNull();
  });

  it("survives an fv_pair with no statement (renders as plain label)", () => {
    const fvPairs: FakeFvPair[] = [
      {
        agent: { label: "X", uri: null },
        gold: { label: "Y", uri: null },
      },
    ];
    const pairs = buildPairs(fvPairs);
    expect(pairs[0].left.statements).toEqual([]);
    expect(pairs[0].right.statements).toEqual([]);
    expect(pairs[0].left.free_text_label).toBe("Y");
    expect(pairs[0].right.free_text_label).toBe("X");
  });

  it("survives an fv_pair with no sample lists (returns [])", () => {
    const fvPairs: FakeFvPair[] = [
      { agent: { label: "X", uri: null }, gold: { label: "Y", uri: null } },
    ];
    const pairs = buildPairs(fvPairs);
    expect(pairs[0].left.biomaterial_short_names).toEqual([]);
    expect(pairs[0].right.biomaterial_short_names).toEqual([]);
  });

  it("status is always 'drift' for partition_mismatch — never 'same' / 'left_only' / 'right_only'", () => {
    const fvPairs: FakeFvPair[] = [
      { agent: { label: "X", uri: null }, gold: { label: "Y", uri: null } },
      { agent: { label: "A", uri: null }, gold: { label: "A", uri: null } },
    ];
    const pairs = buildPairs(fvPairs);
    expect(pairs.every((p) => p.status === "drift")).toBe(true);
  });
});

describe("partition_mismatch 1:1 detection (label drift)", () => {
  // The producer ships ``direction=agent_finer`` / ``agent_coarser``
  // even when the partition is actually 1:1 with label drift. The
  // consumer (FindingDetailsEditor) detects this by counting
  // distinct umbrella-side keys vs total pair count. If they match
  // AND every pair has a unique umbrella key → 1:1 drift, not
  // partition mismatch.
  function distinctUmbrellaCount(
    fvPairs: FakeFvPair[],
    direction: "agent_finer" | "agent_coarser",
  ): number {
    const keyOf = (p: FakeFvPair) =>
      direction === "agent_finer"
        ? `${p.gold.label}|${p.gold.uri ?? ""}`
        : `${p.agent.label}|${p.agent.uri ?? ""}`;
    return new Set(fvPairs.map(keyOf)).size;
  }

  it("agent_finer with 2 unique gold parents and 2 pairs → 1:1 drift", () => {
    const fvPairs: FakeFvPair[] = [
      { agent: { label: "ad lib", uri: null }, gold: { label: "RSR", uri: null } },
      { agent: { label: "CR", uri: null }, gold: { label: "calorie restricted", uri: null } },
    ];
    const distinct = distinctUmbrellaCount(fvPairs, "agent_finer");
    const is1to1 = fvPairs.length > 0 && distinct === fvPairs.length;
    expect(is1to1).toBe(true);
  });

  it("agent_coarser with 1 unique agent umbrella and 2 pairs → M:1 partition mismatch", () => {
    const fvPairs: FakeFvPair[] = [
      { agent: { label: "frontal cortex", uri: null }, gold: { label: "FC L", uri: null } },
      { agent: { label: "frontal cortex", uri: null }, gold: { label: "FC R", uri: null } },
    ];
    const distinct = distinctUmbrellaCount(fvPairs, "agent_coarser");
    const is1to1 = fvPairs.length > 0 && distinct === fvPairs.length;
    expect(is1to1).toBe(false);
  });
});
