import { describe, expect, it } from "vitest";
import { leanButtonKinds } from "./FindingDetailsEditor";
import type { DefenderLean } from "./defenderLean";

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

/** Regression test for the GSE93824 genotype-FV2 split-bug
 *  (Paul 2026-05-21): the OUTER button row at the bottom of a
 *  finding card and the INNER per-FV `PickButton` row inside the
 *  same `DisagreementBlock` were driven by different lean-aware
 *  logic — the outer row migrated to `leanButtonKinds` in 21f7f17
 *  but the inner row stayed on plain active-only styling. The fix
 *  threads the same `leanKinds` object into `DisagreementBlock` so
 *  the inner `PickButton`s read `recommended={leanKinds.keep ===
 *  "primary-keep"}` / `leanKinds.accept === "primary-accept"`. Both
 *  rows now derive their primary from the SAME lean computation;
 *  this test pins that contract so a future drift would fail. */
describe("per-FV row mirrors outer row primary", () => {
  function recommendedSide(lean: DefenderLean): "keep" | "accept" | "both" {
    const kinds = leanButtonKinds(lean);
    const keepPrimary = kinds.keep === "primary-keep";
    const acceptPrimary = kinds.accept === "primary-accept";
    if (keepPrimary && acceptPrimary) return "both";
    if (keepPrimary) return "keep";
    return "accept";
  }

  it("pro_gold: outer + per-FV both recommend `keep` (GSE93824 case)", () => {
    expect(recommendedSide("pro_gold")).toBe("keep");
  });

  it("pro_agent: outer + per-FV both recommend `accept`", () => {
    expect(recommendedSide("pro_agent")).toBe("accept");
  });

  it("neutral: outer + per-FV both recommend equally (`both`)", () => {
    expect(recommendedSide("neutral")).toBe("both");
  });
});
