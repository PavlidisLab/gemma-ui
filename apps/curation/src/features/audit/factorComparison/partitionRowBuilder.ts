/**
 * Build ``FactorComparisonPair[]`` rows for a partition_mismatch
 * finding, emitting rowspan hints + CONTINUATION markers so the
 * shared ``FactorComparisonGrid`` can render umbrella sides ONCE
 * across their child rows instead of duplicating the label + count
 * on every row.
 *
 * Direction semantics (per the producer's
 * ``calibration_factor_partition_mismatch`` payload):
 *   - ``agent_finer``    — agent split one gold FV into multiple.
 *                          Gold side is the umbrella (LEFT rowspans).
 *   - ``agent_coarser``  — agent merged multiple gold FVs into one.
 *                          Agent side is the umbrella (RIGHT rowspans).
 *
 * The umbrella's MID-cell count rowspans alongside its label so the
 * "20 ↔ 10" / "20 ↔ 10" / "20 ↔ 10" duplicate read Paul caught
 * 2026-06-16 collapses to one "20" with three child "10"s.
 *
 * Each pair carries the FactorComparisonGrid-compatible ``status =
 * "drift"`` since partition_mismatch by definition means labels
 * differ at the FV level even though categories match.
 */

import {
  CONTINUATION,
  type FactorComparisonPair,
} from "./FactorComparisonGrid";

/** Minimal shape this builder needs from the producer's
 *  ``PartitionMismatchPayload.fv_pairs[]``. Decoupled from the audit
 *  wire types so the builder + its tests stay independent of schema
 *  drift in unrelated fields. */
export interface PartitionFvPairInput {
  agent: { label: string; uri: string | null };
  gold: { label: string; uri: string | null };
  agent_statement?: unknown;
  gold_statement?: unknown;
  agent_biomaterial_short_names?: string[] | null;
  gold_biomaterial_short_names?: string[] | null;
}

/** Caller-supplied projector that turns an FV reference (term +
 *  statement + samples) into a ``GridFv``-shaped object the shared
 *  ``FvDisplayRow`` can render. Mirrors
 *  ``FindingDetailsEditor::_fvDisplayFromMapping`` so the builder
 *  stays unit-testable without dragging in React state. */
export type FvProjector = (
  term: { label: string; uri: string | null },
  statement: unknown,
  samples: readonly string[] | null,
) => FactorComparisonPair["left"];

/** Group the input fv_pairs by umbrella key. */
function groupByUmbrella(
  fvPairs: PartitionFvPairInput[],
  umbrellaIsGold: boolean,
): Array<{ key: string; pairs: PartitionFvPairInput[] }> {
  const keyOf = (p: PartitionFvPairInput): string =>
    umbrellaIsGold
      ? `${p.gold.label}|${p.gold.uri ?? ""}`
      : `${p.agent.label}|${p.agent.uri ?? ""}`;
  const order: string[] = [];
  const buckets = new Map<string, PartitionFvPairInput[]>();
  for (const p of fvPairs) {
    const k = keyOf(p);
    const bucket = buckets.get(k);
    if (bucket) {
      bucket.push(p);
    } else {
      buckets.set(k, [p]);
      order.push(k);
    }
  }
  return order.map((k) => ({ key: k, pairs: buckets.get(k) as PartitionFvPairInput[] }));
}

export function buildPartitionMismatchPairs(args: {
  direction: "agent_finer" | "agent_coarser" | "cross_cutting" | string;
  fvPairs: PartitionFvPairInput[];
  project: FvProjector;
}): FactorComparisonPair[] {
  const { direction, fvPairs, project } = args;
  // cross_cutting (and any unrecognised direction) falls through to
  // the flat shape — no rowspan, every row is independent.
  if (direction !== "agent_finer" && direction !== "agent_coarser") {
    return fvPairs.map<FactorComparisonPair>((p) => ({
      left: project(p.gold, p.gold_statement, p.gold_biomaterial_short_names ?? null),
      right: project(p.agent, p.agent_statement, p.agent_biomaterial_short_names ?? null),
      status: "drift",
    }));
  }

  const umbrellaIsGold = direction === "agent_finer";
  const groups = groupByUmbrella(fvPairs, umbrellaIsGold);
  const rows: FactorComparisonPair[] = [];
  for (const g of groups) {
    const span = g.pairs.length;
    for (let i = 0; i < span; i++) {
      const p = g.pairs[i];
      const goldFv = project(
        p.gold,
        p.gold_statement,
        p.gold_biomaterial_short_names ?? null,
      );
      const agentFv = project(
        p.agent,
        p.agent_statement,
        p.agent_biomaterial_short_names ?? null,
      );
      // First row in the group carries the umbrella + its rowspan;
      // subsequent rows mark the umbrella side as CONTINUATION.
      if (umbrellaIsGold) {
        rows.push({
          left: i === 0 ? goldFv : CONTINUATION,
          right: agentFv,
          status: "drift",
          // Gold (LEFT) is umbrella → rowspan on first row only;
          // span > 1 means subsequent rows skip the left cell.
          leftRowSpan: i === 0 ? span : 1,
        });
      } else {
        rows.push({
          left: goldFv,
          right: i === 0 ? agentFv : CONTINUATION,
          status: "drift",
          rightRowSpan: i === 0 ? span : 1,
        });
      }
    }
  }
  return rows;
}
