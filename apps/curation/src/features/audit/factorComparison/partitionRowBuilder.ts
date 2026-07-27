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
 * "20 ↔ 10" / "20 ↔ 10" / "20 ↔ 10" duplicate read the reviewer caught
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
  const bmCount = (arr?: string[] | null): number => (arr ?? []).length;
  for (const g of groups) {
    const span = g.pairs.length;
    // Cluster (split) totals: the umbrella side is one FV (same across
    // the group); the child side is the sum across the group. The mid
    // cell shows ONE summary for the whole split (umbrellaTotal ↔
    // childTotal) — e.g. gold "reference substance role" 60 ↔ agent
    // "spontaneous sleep" 48 + "baseline" 12 = 60. Emerald when the
    // totals agree (a clean split), amber otherwise.
    const goldTotal = umbrellaIsGold
      ? bmCount(g.pairs[0].gold_biomaterial_short_names)
      : g.pairs.reduce((s, p) => s + bmCount(p.gold_biomaterial_short_names), 0);
    const agentTotal = umbrellaIsGold
      ? g.pairs.reduce((s, p) => s + bmCount(p.agent_biomaterial_short_names), 0)
      : bmCount(g.pairs[0].agent_biomaterial_short_names);
    const totalsKnown = goldTotal > 0 || agentTotal > 0;
    const equal = goldTotal === agentTotal;
    const midOverride =
      span > 1 && totalsKnown
        ? {
            text: `${goldTotal} ↔ ${agentTotal}`,
            cls: equal
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-amber-600 dark:text-amber-400",
            title: equal
              ? `${goldTotal} sample(s) each side — split totals agree`
              : `${goldTotal} left vs ${agentTotal} right — split totals differ`,
          }
        : undefined;
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
      // First row in the group carries the umbrella + its rowspan + the
      // cluster mid summary (midRowSpan = span); subsequent rows mark
      // the umbrella side as CONTINUATION and let the grid suppress
      // their own mid (covered by the umbrella's midRowSpan).
      if (umbrellaIsGold) {
        // agent_finer: the AGENT (right) side is the child — show its
        // per-FV count on the chip so the cluster mid summary doesn't
        // hide the individual split members.
        rows.push({
          left: i === 0 ? goldFv : CONTINUATION,
          right: agentFv,
          status: "drift",
          leftRowSpan: i === 0 ? span : 1,
          ...(span > 1 ? { rightShowSampleCount: true } : {}),
          ...(i === 0 && span > 1
            ? { midRowSpan: span, midOverride }
            : {}),
        });
      } else {
        // agent_coarser: the GOLD/Current (left) side is the child — show
        // each grouped Current FV's own count (e.g. 31 and 9) that the
        // cluster mid total (40 ↔ 40) would otherwise hide.
        rows.push({
          left: goldFv,
          right: i === 0 ? agentFv : CONTINUATION,
          status: "drift",
          rightRowSpan: i === 0 ? span : 1,
          ...(span > 1 ? { leftShowSampleCount: true } : {}),
          ...(i === 0 && span > 1
            ? { midRowSpan: span, midOverride }
            : {}),
        });
      }
    }
  }
  return rows;
}
