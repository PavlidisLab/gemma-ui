import { describe, expect, it } from "vitest";
import type { SubtaskDecision } from "@/api/types";
import {
  dedupeSubtaskDecisions,
  duplicateSubtaskTargetPairs,
  rollupFreeTextValidator,
} from "./subtaskDecisions";

function dec(partial: Partial<SubtaskDecision>): SubtaskDecision {
  return {
    subtask: "S10_term_validator",
    label: "Term validator",
    verdict: "",
    citation: "",
    citation_url: "",
    target_id: "factor:genotype",
    ...partial,
  };
}

/**
 * Tests for the S10 term-validator free-text rollup. Paul 2026-06-19:
 * collapse the repeated 'object "X" is free-text — not in Gemma
 * vocabulary' notes to 'Left as free text: X, Y'.
 */
describe("rollupFreeTextValidator", () => {
  it("collapses a single ·-joined free-text verdict to a name list", () => {
    const out = rollupFreeTextValidator([
      dec({
        verdict:
          'object "T372E" is free-text — not in Gemma vocabulary · object "T372A" is free-text — not in Gemma vocabulary',
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].verdict).toBe("Left as free text: T372E, T372A");
    // carrier metadata (label / citation) preserved.
    expect(out[0].label).toBe("Term validator");
  });

  it("merges several free-text decisions into one summary, names deduped", () => {
    const out = rollupFreeTextValidator([
      dec({ verdict: 'object "T372E" is free-text — not in Gemma vocabulary' }),
      dec({ verdict: 'object "T372A" is free-text — not in Gemma vocabulary' }),
      dec({ verdict: 'object "T372E" is free-text — not in Gemma vocabulary' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].verdict).toBe("Left as free text: T372E, T372A");
  });

  it("leaves non-free-text decisions untouched and keeps order", () => {
    const other = dec({
      subtask: "S7_coverage",
      label: "Coverage",
      verdict: "All samples covered.",
    });
    const out = rollupFreeTextValidator([
      other,
      dec({ verdict: 'object "T372E" is free-text — not in Gemma vocabulary' }),
    ]);
    expect(out.map((d) => d.verdict)).toEqual([
      "All samples covered.",
      "Left as free text: T372E",
    ]);
  });

  it("does not collapse a verdict that mixes free-text with other prose", () => {
    const mixed = dec({
      verdict:
        'object "T372E" is free-text — not in Gemma vocabulary · but the subject resolved fine',
    });
    const out = rollupFreeTextValidator([mixed]);
    expect(out[0].verdict).toBe(mixed.verdict);
  });

  it("runs as part of dedupeSubtaskDecisions", () => {
    const out = dedupeSubtaskDecisions([
      dec({
        verdict:
          'object "T372E" is free-text — not in Gemma vocabulary · object "T372A" is free-text — not in Gemma vocabulary',
      }),
    ]);
    expect(out[0].verdict).toBe("Left as free text: T372E, T372A");
  });
});

/**
 * Data-uniqueness invariant for the Subtask Analysis list rendered by
 * `InlineSubtaskReasoning` (agentDetailsPanel.tsx). The panel groups the
 * pipeline's `subtask_decisions` by target and shows one row per
 * decision, so the audit trail must record each `(subtask, target_id)`
 * pair exactly ONCE.
 *
 * Regression guard for the boss re-run accumulation bug (agents
 * `db8d580`): the re-run appended its design-chain decisions on top of
 * round 1's, duplicating every `(subtask, target_id)` pair — e.g. twin
 * `S2u_uri_bind_validation` "reject Heterozygous" rows for one binding
 * (13 duplicate pairs on GSE306566). The pipeline now replaces round
 * 1's chain with the shipped design's chain; these tests assert the UI
 * relies on — and would surface a regression of — that data invariant.
 */
describe("subtask-analysis (subtask, target_id) uniqueness", () => {
  // Representative SHIPPED audit trail (post-fix, single chain): one
  // decision per (subtask, target), plus the boss review/action rows the
  // reconcile preserves. This is the shape the panel renders per factor.
  const shippedTrail: SubtaskDecision[] = [
    dec({
      subtask: "S2u_uri_bind_validation",
      target_id: "factor:genotype:object",
      verdict: "reject Heterozygous binding",
    }),
    dec({
      subtask: "S2i_confounding_check",
      target_id: "factor_pair:genotype|treatment",
      verdict: "no confound",
    }),
    dec({
      subtask: "S8_dea_usability",
      target_id: "design",
      verdict: "usable",
    }),
    dec({
      subtask: "boss_critic_round_1",
      target_id: "factor:treatment",
      verdict: "Missing treatment factor.",
      severity: "blocker",
    }),
    dec({
      subtask: "boss_rerun_regression_guard",
      target_id: "design",
      verdict: "KEPT the re-run",
    }),
  ];

  it("renders each (subtask, target_id) exactly once for a shipped trail", () => {
    expect(duplicateSubtaskTargetPairs(shippedTrail)).toEqual([]);
    // The display dedup must not INTRODUCE a collision either.
    expect(duplicateSubtaskTargetPairs(dedupeSubtaskDecisions(shippedTrail))).toEqual(
      [],
    );
  });

  it("flags the pre-fix accumulated-chain shape (twin S2u rejects)", () => {
    // The boss re-run re-emitted the same chain against the same target;
    // only the verdict prose differed (round-1 vs re-run rationale).
    const accumulated: SubtaskDecision[] = [
      dec({
        subtask: "S2u_uri_bind_validation",
        target_id: "factor:genotype:object",
        verdict: "round1: reject Heterozygous binding",
      }),
      ...shippedTrail.slice(1),
      dec({
        subtask: "S2u_uri_bind_validation",
        target_id: "factor:genotype:object",
        verdict: "rerun: reject Heterozygous binding",
      }),
    ];
    expect(duplicateSubtaskTargetPairs(accumulated)).toEqual([
      "S2u_uri_bind_validation||factor:genotype:object",
    ]);
    // Differing verdict prose survives the display dedup, so the panel
    // WOULD render the twin rows — the UI cannot rescue this; the
    // producer's data invariant must hold.
    expect(
      duplicateSubtaskTargetPairs(dedupeSubtaskDecisions(accumulated)),
    ).toContain("S2u_uri_bind_validation||factor:genotype:object");
  });
});
