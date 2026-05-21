import { describe, expect, it } from "vitest";
import { leanButtonKinds } from "./FindingDetailsEditor";

/** Pins the (lean → button kinds) mapping that drives which of the
 *  (keep, accept) buttons in `FindingDetailsEditor`'s ActionRow
 *  reads as primary (filled, prominent) vs secondary (outline).
 *  Together with the lean-aware header label in
 *  `AuditSidebarPanel`'s SUGGESTION panel, this is the
 *  GSE93824-Arctic-APP fix surface (Paul 2026-05-21).
 */

describe("leanButtonKinds", () => {
  // ---- Case 1: pro_gold — judge says agent is wrong (GSE93824) ----
  it("pro_gold → keep is primary, accept demotes to secondary", () => {
    expect(leanButtonKinds("pro_gold")).toEqual({
      keep: "primary-keep",
      accept: "secondary",
    });
  });

  // ---- Case 2: pro_agent — today's behaviour preserved ----
  it("pro_agent → accept is primary, keep demotes to secondary", () => {
    expect(leanButtonKinds("pro_agent")).toEqual({
      keep: "secondary",
      accept: "primary-accept",
    });
  });

  // ---- Case 3: neutral / no defender — both equally weighted ----
  it("neutral → both buttons primary (no recommendation)", () => {
    expect(leanButtonKinds("neutral")).toEqual({
      keep: "primary-keep",
      accept: "primary-accept",
    });
  });
});
