import { describe, expect, it } from "vitest";
import type { AuditFinding } from "@/api/auditTypes";
import type { Factor } from "@/features/experiment/types";
import { resolveGoldFactorByIdOrIndex } from "./ComparisonFactorCard";

/** Regression: GSE306566 genotype FACTOR MATCH rendered "(no factor)"
 *  because the card resolved the Current/gold factor by POSITIONAL
 *  ``gold_target_index`` into a baseline whose order/content had drifted
 *  (or a stripped preboard baseline). The finding names the matched
 *  factor by its stable Gemma id in ``target_id`` ("factor:<id>"); an id
 *  join is the reliable resolution. Positional index stays as a fallback
 *  for label-based target_ids and missing-id cases. */

function fac(id: number, label: string): Factor {
  return {
    id,
    name: label,
    category: { label, uri: null },
    description: "",
    type: "categorical",
    factor_values: [],
  } as unknown as Factor;
}

function finding(partial: Partial<AuditFinding>): AuditFinding {
  return {
    target_kind: "factor",
    target_id: "factor:70503",
    issue_code: "calibration_factor_match_exact",
    gold_target_index: 1,
    ...partial,
  } as unknown as AuditFinding;
}

describe("resolveGoldFactorByIdOrIndex", () => {
  it("resolves by Gemma factor id regardless of position (order drift)", () => {
    // Live design reordered: genotype (70503) is now at index 0, not the
    // finding's gold_target_index=1. Id join must still find it.
    const live = [fac(70503, "genotype"), fac(70496, "collection of material")];
    const got = resolveGoldFactorByIdOrIndex(finding({}), [live]);
    expect(got?.id).toBe(70503);
    expect(got?.category.label).toBe("genotype");
  });

  it("prefers the owning-curation pool over the live design pool", () => {
    const owning = [fac(70503, "genotype-owning")];
    const live = [fac(70503, "genotype-live")];
    const got = resolveGoldFactorByIdOrIndex(finding({}), [owning, live]);
    expect(got?.name).toBe("genotype-owning");
  });

  it("does NOT fall back to the wrong positional factor when the id is absent", () => {
    // Preboard skeleton lacks the human-curated genotype factor (id
    // 70503). Index 1 here is a DIFFERENT factor — must not be returned
    // as the genotype match; return null so the caller uses its
    // self-carry fallback instead of showing the wrong factor.
    const preboard = [fac(999, "batch"), fac(998, "platform")];
    const got = resolveGoldFactorByIdOrIndex(finding({}), [preboard]);
    expect(got).toBeNull();
  });

  it("falls back to positional index for label-based target_ids (factor_extra)", () => {
    const live = [fac(1, "collection of material"), fac(2, "treatment")];
    const got = resolveGoldFactorByIdOrIndex(
      finding({
        target_id: "calibration:factor_extra:treatment",
        gold_target_index: 1,
      }),
      [live],
    );
    expect(got?.id).toBe(2);
  });

  it("returns null when neither id nor index resolves", () => {
    const got = resolveGoldFactorByIdOrIndex(
      finding({ target_id: "factor:70503", gold_target_index: null }),
      [[fac(1, "batch")]],
    );
    expect(got).toBeNull();
  });

  it("resolves by explicit gemma_factor_id when target_id is label-based", () => {
    // A rename finding names the factor by slug ("factor:genotype") —
    // no numeric id to parse from target_id. The stable Gemma factor id
    // rides on rename.gold.gemma_factor_id; the id join must use it and
    // ignore the (drifted) positional gold_target_index.
    const live = [fac(70496, "collection of material"), fac(70503, "genotype")];
    const got = resolveGoldFactorByIdOrIndex(
      finding({ target_id: "factor:genotype", gold_target_index: 0 }),
      [live],
      70503,
    );
    expect(got?.id).toBe(70503);
    expect(got?.category.label).toBe("genotype");
  });

  it("prefers the numeric target_id over the explicit gemma_factor_id arg", () => {
    // When target_id already carries a numeric id, that wins — the
    // explicit arg is only a fallback for label-based target_ids.
    const live = [fac(70503, "genotype"), fac(70999, "other")];
    const got = resolveGoldFactorByIdOrIndex(
      finding({ target_id: "factor:70503" }),
      [live],
      70999,
    );
    expect(got?.id).toBe(70503);
  });

  it("returns null (no positional guess) when the explicit id is absent from the pool", () => {
    // Label-based target_id + a gemma_factor_id that isn't in the
    // stripped baseline → return null so the caller uses its self-carry
    // fallback rather than the wrong positional factor.
    const preboard = [fac(999, "batch"), fac(998, "platform")];
    const got = resolveGoldFactorByIdOrIndex(
      finding({ target_id: "factor:genotype", gold_target_index: 1 }),
      [preboard],
      70503,
    );
    expect(got).toBeNull();
  });
});
