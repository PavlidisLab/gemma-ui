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

/** `fv:genotype/wild-type#9001` -> `wild-type`. */
function targetTail(targetId: string): string {
  const noSuffix = targetId.split("#")[0] ?? targetId;
  const afterSlash = noSuffix.includes("/")
    ? noSuffix.slice(noSuffix.lastIndexOf("/") + 1)
    : noSuffix;
  return afterSlash.trim() || targetId;
}

describe("the chip's fallback label", () => {
  it("shortens a target id instead of shouting the whole thing", () => {
    // The chip read "ALSO APPLIES TO `FV:GENOTYPE/WILD-TYPE#9001`" when
    // the consequent finding had no backticked term to name it by.
    expect(targetTail("fv:genotype/wild-type#9001")).toBe("wild-type");
    expect(targetTail("fv:treatment/vehicle#9003")).toBe("vehicle");
  });

  it("handles a target with no value segment", () => {
    expect(targetTail("factor:genotype#9001")).toBe("factor:genotype");
  });

  it("never returns empty — an unnamed chip is worse than an ugly one", () => {
    expect(targetTail("#9001")).toBe("#9001");
    expect(targetTail("")).toBe("");
  });
});
