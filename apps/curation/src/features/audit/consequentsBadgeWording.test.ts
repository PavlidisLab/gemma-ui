import { describe, expect, it } from "vitest";

/**
 * `consequents` has two producers and only one means a removal.
 *
 * The partition-mismatch case absorbs another factor's grouping, so
 * accepting the finer split really does remove the downstream. The
 * finding ROLL-UP populates the same field to say "one decision,
 * listed once rather than duplicated" — nothing is removed there.
 *
 * Observed on sandbox 9001: an `ungrounded_fv` on `genotype` carried
 * `consequents: ["fv:genotype/wild-type#9001"]` and the card read
 * "IMPLIES REMOVAL OF `WILD TYPE`", for a finding whose applyAction is
 * `needs_curator_decision` with every payload field null.
 */
function impliesRemoval(issueCode: string | null | undefined): boolean {
  return (issueCode ?? "").endsWith("_partition_mismatch");
}

describe("consequents badge wording", () => {
  it("says removal ONLY for a partition mismatch", () => {
    expect(impliesRemoval("calibration_factor_partition_mismatch")).toBe(true);
  });

  it("🛑 never says removal for a roll-up consequent", () => {
    // The case Paul caught: nothing in this finding removes anything.
    expect(impliesRemoval("ungrounded_fv")).toBe(false);
    expect(impliesRemoval("ungrounded_term")).toBe(false);
    expect(impliesRemoval("missing_tag")).toBe(false);
  });

  it("does not match a code that merely mentions partition", () => {
    // Suffix, not substring — `partition_mismatch_resolved` (say)
    // would not be an absorbing split.
    expect(impliesRemoval("partition_mismatch_resolved")).toBe(false);
  });

  it("treats an absent issue code as no removal", () => {
    // Absence is not evidence of an absorbing split; the safe reading
    // is the one that does not tell a curator their data will be lost.
    expect(impliesRemoval(null)).toBe(false);
    expect(impliesRemoval(undefined)).toBe(false);
    expect(impliesRemoval("")).toBe(false);
  });
});
