/**
 * Which side is which in the alignment mapping.
 *
 * 🛑 **a = PROPOSED, b = EXISTING.** Forced, not agreed:
 * `FactorPair.b_id` is a *Gemma* id and only the side already in Gemma
 * can have one. The producer pins it as `align(proposal, existing)`
 * with `b_id` on the existing factor
 * (`agents/audit/graph_alignment.py:566`).
 *
 * This file had it reversed until 2026-08-25 and nothing caught it,
 * because the join has never run: the audit has never shipped a
 * `mapping` (0 across 100 experiments), so every call fell through to
 * the `pairFvs` heuristic. These tests exist so it cannot silently
 * swap back when the audit starts feeding the aligner.
 */
import { describe, expect, it } from "vitest";
import type { AuditFinding, AuditReport } from "@/api/auditTypes";
import { factorPairForFinding } from "./mappingPairing";

/** a=2 is the proposed factor, b=7 the existing one carrying the id. */
const PAIR = { a_idx: 2, b_idx: 7, score: 0.9, kind: "exact", b_id: 70503 };

function report(): AuditReport {
  return {
    evidence: { mapping: { factor_pairs: [PAIR], fv_pairs: [] } },
  } as unknown as AuditReport;
}

function finding(f: Record<string, unknown>): AuditFinding {
  return f as unknown as AuditFinding;
}

describe("factorPairForFinding — which index is which side", () => {
  it("joins the legacy spelling with gold on B, not on A", () => {
    // gold = EXISTING = b. agent = PROPOSED = a.
    const got = factorPairForFinding(
      report(),
      finding({ gold_target_index: 7, agent_target_index: 2 }),
    );
    expect(got).toEqual(PAIR);
  });

  it("does NOT match when the two are swapped", () => {
    // The exact shape of the old bug: it would have matched this and
    // paired the proposed factor against the wrong existing one.
    const got = factorPairForFinding(
      report(),
      finding({ gold_target_index: 2, agent_target_index: 7 }),
    );
    expect(got).toBeNull();
  });

  it("reads the neutral spelling the same way", () => {
    const got = factorPairForFinding(
      report(),
      finding({ existing_target_index: 7, proposed_target_index: 2 }),
    );
    expect(got).toEqual(PAIR);
  });

  it("prefers the neutral spelling when both arrive", () => {
    // The wire has not moved yet, so a payload could carry both. The
    // neutral one is the producer's own name for the field.
    const got = factorPairForFinding(
      report(),
      finding({
        existing_target_index: 7,
        proposed_target_index: 2,
        gold_target_index: 999,
        agent_target_index: 999,
      }),
    );
    expect(got).toEqual(PAIR);
  });

  it("returns null when either side is missing — the caller falls back", () => {
    expect(
      factorPairForFinding(report(), finding({ agent_target_index: 2 })),
    ).toBeNull();
    expect(
      factorPairForFinding(report(), finding({ gold_target_index: 7 })),
    ).toBeNull();
  });

  it("returns null when the report carries no mapping at all", () => {
    // Today's every-case: 0 mappings across 100 experiments.
    expect(
      factorPairForFinding(
        { evidence: {} } as unknown as AuditReport,
        finding({ gold_target_index: 7, agent_target_index: 2 }),
      ),
    ).toBeNull();
  });
});
