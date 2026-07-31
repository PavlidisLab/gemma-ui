import { describe, expect, it } from "vitest";
import { factorTarget, fvTarget, parseTargetId, tagTarget } from "./targetIds";

/**
 * Discriminator round-trip + backward compatibility, per the
 * 2026-07-30 target_id collision fix (two factors/FVs sharing a
 * category previously collided on target_id and masked one
 * disposition — see `~/Dev/eclipseworkspace/Gemma/handoffs/
 * STORE_REPLY_2026_07_30_DISPOSITION_DROPS_TARGET_ID_COLLISION.md`).
 * The `#{id}` suffix is optional and additive: `factorSlug`/`fvSlug`
 * must stay pure (discriminator stripped) so every pre-existing
 * slug-equality comparison in the codebase keeps working unchanged.
 */
describe("targetIds discriminator", () => {
  it("factorTarget omits the discriminator when no id is given", () => {
    expect(factorTarget("treatment")).toBe("factor:treatment");
    expect(factorTarget("treatment", null)).toBe("factor:treatment");
    expect(factorTarget("treatment", undefined)).toBe("factor:treatment");
  });

  it("factorTarget appends #{id} when an id is given", () => {
    expect(factorTarget("treatment", 101)).toBe("factor:treatment#101");
  });

  it("fvTarget omits the discriminator when no id is given", () => {
    expect(fvTarget("treatment", "vehicle")).toBe("fv:treatment/vehicle");
  });

  it("fvTarget appends #{id} when an id is given", () => {
    expect(fvTarget("treatment", "vehicle", 205)).toBe(
      "fv:treatment/vehicle#205",
    );
  });

  it("tagTarget never carries a discriminator (Tag.id isn't a Gemma id)", () => {
    expect(tagTarget("disease", "cancer")).toBe("tag:disease/cancer");
  });

  it("parseTargetId strips the discriminator into factorId, keeping factorSlug pure", () => {
    const parsed = parseTargetId("factor:treatment#101");
    expect(parsed).toEqual({
      kind: "factor",
      factorSlug: "treatment",
      factorId: 101,
    });
  });

  it("parseTargetId leaves factorId undefined for the legacy bare form", () => {
    const parsed = parseTargetId("factor:treatment");
    expect(parsed).toEqual({ kind: "factor", factorSlug: "treatment" });
  });

  it("parseTargetId strips the discriminator into fvId, keeping fvSlug pure", () => {
    const parsed = parseTargetId("fv:treatment/vehicle#205");
    expect(parsed).toEqual({
      kind: "fv",
      factorSlug: "treatment",
      fvSlug: "vehicle",
      fvId: 205,
    });
  });

  it("parseTargetId leaves fvId undefined for the legacy bare form", () => {
    const parsed = parseTargetId("fv:treatment/vehicle");
    expect(parsed).toEqual({
      kind: "fv",
      factorSlug: "treatment",
      fvSlug: "vehicle",
    });
  });

  it("round-trips factorTarget -> parseTargetId", () => {
    const id = parseTargetId(factorTarget("cell type", 42));
    expect(id).toEqual({
      kind: "factor",
      factorSlug: "cell-type",
      factorId: 42,
    });
  });

  it("round-trips fvTarget -> parseTargetId", () => {
    const id = parseTargetId(fvTarget("cell type", "T cell", 7));
    expect(id).toEqual({
      kind: "fv",
      factorSlug: "cell-type",
      fvSlug: "t-cell",
      fvId: 7,
    });
  });

  it("treats a non-numeric suffix as absent, but still strips it from the slug", () => {
    // Malformed / hand-typed target_id — id is unusable, but the base
    // slug must not leak the "#garbage" tail into factorSlug (that
    // would break every downstream slug-equality comparison).
    const parsed = parseTargetId("factor:treatment#abc");
    expect(parsed).toEqual({ kind: "factor", factorSlug: "treatment" });
  });

  it("bare numeric calibration shape (factor:<id>) is unaffected", () => {
    // Legacy calibration_factor_match shape: the whole slug IS the id,
    // no category component, no discriminator. Must still parse as a
    // plain slug (numeric-slug detection lives in the caller, e.g.
    // ComparisonFactorCard.resolveGoldFactorByIdOrIndex).
    const parsed = parseTargetId("factor:70503");
    expect(parsed).toEqual({ kind: "factor", factorSlug: "70503" });
  });

  it("tags of the same category+value collide by design (no discriminator support yet)", () => {
    expect(tagTarget("disease", "cancer")).toBe(
      tagTarget("Disease", "  Cancer  "),
    );
  });
});
