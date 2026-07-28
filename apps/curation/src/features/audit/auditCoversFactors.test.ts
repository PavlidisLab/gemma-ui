import { describe, expect, it } from "vitest";
import { auditCoversFactors, auditCoversTags } from "./findingList";

/**
 * Regression test for the "Factors the audit didn't see" scope gate.
 *
 * Bug (ticket 152, Paul 2026-07-28): a tags-only ad-hoc ticket
 * (scope.include = ["tags"]) rendered a "FACTORS THE AUDIT DIDN'T SEE" card
 * for a `cell type` factor next to the single dev-stage tag under review —
 * because BaselineDriftSection surfaced every current factor the tag-only
 * audit never scored. The drift section must render ONLY when the audit's
 * scope actually covered factors.
 */
describe("auditCoversFactors — gate the factor-drift section on audit scope", () => {
  it("false for a tags-only audit (the ticket-152 case)", () => {
    expect(auditCoversFactors({ include: ["tags"] })).toBe(false);
  });

  it("true when factors are in scope", () => {
    expect(auditCoversFactors({ include: ["factors", "tags"] })).toBe(true);
    expect(auditCoversFactors({ include: ["factors", "fvs", "tags", "assignments"] })).toBe(true);
  });

  it("false for a scope that excludes factors (fvs/assignments only)", () => {
    expect(auditCoversFactors({ include: ["fvs"] })).toBe(false);
    expect(auditCoversFactors({ include: ["assignments"] })).toBe(false);
  });

  it("treats an absent or empty scope as 'all' — keeps the section", () => {
    expect(auditCoversFactors(null)).toBe(true);
    expect(auditCoversFactors(undefined)).toBe(true);
    expect(auditCoversFactors({ include: [] })).toBe(true);
  });
});

/**
 * Symmetric mirror. `auditCoversTags` is NOT wired to any render today (there
 * is no tag-drift section) — this locks its semantics so that if such a
 * section is added, a factor-only audit won't surface phantom tags.
 */
describe("auditCoversTags — ready mirror for a future tag-drift section", () => {
  it("false for a factors-only audit (the mirror of ticket 152)", () => {
    expect(auditCoversTags({ include: ["factors"] })).toBe(false);
  });

  it("true when tags are in scope", () => {
    expect(auditCoversTags({ include: ["tags"] })).toBe(true);
    expect(auditCoversTags({ include: ["factors", "tags"] })).toBe(true);
  });

  it("treats an absent or empty scope as 'all'", () => {
    expect(auditCoversTags(null)).toBe(true);
    expect(auditCoversTags(undefined)).toBe(true);
    expect(auditCoversTags({ include: [] })).toBe(true);
  });
});
