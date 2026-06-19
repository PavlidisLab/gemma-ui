/**
 * Focused tests for the isPairAllowed() guard from sources.ts.
 *
 * isPairAllowed is the pair-level validity check that useChipState
 * (writeUrl) uses to prevent persisting a forbidden chip combination
 * into the URL.  When isPairAllowed returns false, writeUrl forces the
 * comparator to "empty" so the URL never encodes the muddled state.
 *
 * These tests are co-located with the broader sources.test.ts, which
 * already touches isPairAllowed as part of the "pair rule" describe
 * block.  This file focuses specifically on the guard cases called out
 * in the task specification and adds the identity / default-allow
 * coverage to make the contract explicit.
 *
 * NOTE: sources.test.ts is the authoritative style reference for this
 * directory.  Follow its pattern (describe/it, no beforeEach, inline
 * fixtures, explicit assertion per case).
 */

import { describe, expect, it } from "vitest";
import { isPairAllowed } from "./sources";

describe("isPairAllowed — chip-strip pair guard", () => {
  it("rejects baseline=empty + comparator=preboard (the only forbidden pair in the spec)", () => {
    expect(isPairAllowed("empty", "preboard")).toBe(false);
  });

  it("allows baseline=empty + comparator=agent_proposal (proposal mode)", () => {
    expect(isPairAllowed("empty", "agent_proposal")).toBe(true);
  });

  it("allows baseline=preboard + comparator=agent_proposal (standard edit flow)", () => {
    expect(isPairAllowed("preboard", "agent_proposal")).toBe(true);
  });

  it("allows identity pairs (same source in both slots — regression-test mode)", () => {
    expect(isPairAllowed("empty", "empty")).toBe(true);
    expect(isPairAllowed("preboard", "preboard")).toBe(true);
    expect(isPairAllowed("agent_proposal", "agent_proposal")).toBe(true);
    expect(isPairAllowed("polished:cyan", "polished:cyan")).toBe(true);
  });

  it("allows all other pairs by default (default-allow semantics)", () => {
    // Spot-check a representative cross-section of non-forbidden pairs.
    expect(isPairAllowed("polished:cyan", "agent_proposal")).toBe(true);
    expect(isPairAllowed("polished:cyan", "polished:amanda")).toBe(true);
    expect(isPairAllowed("live", "agent_proposal")).toBe(true);
    expect(isPairAllowed("live", "polished:cyan")).toBe(true);
    expect(isPairAllowed("preboard", "polished:cyan")).toBe(true);
    expect(isPairAllowed("preboard", "empty")).toBe(true);
    expect(isPairAllowed("empty", "polished:cyan")).toBe(true);
    expect(isPairAllowed("empty", "live")).toBe(true);
  });
});
