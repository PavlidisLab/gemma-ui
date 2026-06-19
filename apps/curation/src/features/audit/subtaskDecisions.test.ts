import { describe, expect, it } from "vitest";
import type { SubtaskDecision } from "@/api/types";
import {
  dedupeSubtaskDecisions,
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
