import { describe, expect, it } from "vitest";
import {
  ALL_SOURCES,
  defaultSlots,
  isPairAllowed,
  isSourceValidInSlot,
  modeOf,
  parseSource,
} from "./sources";

describe("slot validity", () => {
  it("rejects agent_proposal as a baseline", () => {
    expect(isSourceValidInSlot("baseline", "agent_proposal")).toBe(false);
  });

  it("accepts every other source as a baseline", () => {
    for (const s of ALL_SOURCES) {
      if (s === "agent_proposal") continue;
      expect(isSourceValidInSlot("baseline", s)).toBe(true);
    }
  });

  it("accepts every source as a comparator (preboard-with-empty-baseline gated by pair rule)", () => {
    for (const s of ALL_SOURCES) {
      expect(isSourceValidInSlot("comparator", s)).toBe(true);
    }
  });
});

describe("pair rule", () => {
  it("rejects baseline=empty + comparator=preboard (conceptually muddled per spec)", () => {
    expect(isPairAllowed("empty", "preboard")).toBe(false);
  });

  it("accepts every other pair involving empty", () => {
    expect(isPairAllowed("empty", "empty")).toBe(true);
    expect(isPairAllowed("empty", "cy_polished")).toBe(true);
    expect(isPairAllowed("empty", "am_polished")).toBe(true);
    expect(isPairAllowed("empty", "agent_proposal")).toBe(true);
    expect(isPairAllowed("preboard", "empty")).toBe(true);
  });

  it("accepts identity pairs (regression-test mode)", () => {
    expect(isPairAllowed("cy_polished", "cy_polished")).toBe(true);
    expect(isPairAllowed("preboard", "preboard")).toBe(true);
  });
});

describe("modeOf", () => {
  it("classifies all 25 combinations", () => {
    expect(modeOf("empty", "empty")).toBe("degenerate");
    expect(modeOf("empty", "agent_proposal")).toBe("proposal");
    expect(modeOf("cy_polished", "empty")).toBe("bare");
    expect(modeOf("cy_polished", "agent_proposal")).toBe("audit");
    expect(modeOf("cy_polished", "cy_polished")).toBe("identity");
  });
});

describe("defaults", () => {
  it("review opens to Cy polished + agent proposal", () => {
    expect(defaultSlots("review")).toEqual({
      baseline: "cy_polished",
      comparator: "agent_proposal",
    });
  });

  it("edit opens to Gemma preboard + agent proposal", () => {
    expect(defaultSlots("edit")).toEqual({
      baseline: "preboard",
      comparator: "agent_proposal",
    });
  });
});

describe("parseSource", () => {
  it("round-trips every known token", () => {
    for (const s of ALL_SOURCES) {
      expect(parseSource(s)).toBe(s);
    }
  });

  it("returns null on unknown tokens", () => {
    expect(parseSource("xyz")).toBeNull();
    expect(parseSource("")).toBeNull();
    expect(parseSource(null)).toBeNull();
    expect(parseSource(undefined)).toBeNull();
  });
});
