import { describe, expect, it } from "vitest";
import {
  guidelineRefForFinding,
  guidelineRefByKey,
} from "./guidelineRegistry";

describe("guidelineRefForFinding — resolver precedence", () => {
  it("prefers citation over issue_code when citation is a registry key", () => {
    // citation names the baseline D-code; issue_code names a tag rule.
    // The precise citation wins.
    const ref = guidelineRefForFinding({
      citation: "D8",
      issue_code: "calibration_gold_only_miss",
    });
    expect(ref).not.toBeNull();
    expect(ref?.rule_id).toBe("baselines.factor_needs_baseline");
    expect(ref?.topic).toBe("baselines");
  });

  it("falls back to issue_code when citation is not a registry key", () => {
    const ref = guidelineRefForFinding({
      citation: "09_experiment_tags.md § When tags are needed", // free-text, not a key
      issue_code: "calibration_gold_only_miss",
    });
    expect(ref).not.toBeNull();
    expect(ref?.rule_id).toBe("tags.redundant_bm_covered");
    expect(ref?.title).toMatch(/redundant/i);
  });

  it("falls back to issue_code when citation is empty", () => {
    const ref = guidelineRefForFinding({
      citation: "",
      issue_code: "calibration_tag_match_near",
    });
    expect(ref?.rule_id).toBe("tags.same_concept_choose_one");
    expect(ref?.title).toMatch(/Same concept/i);
  });

  it("returns null when neither citation nor issue_code matches", () => {
    expect(
      guidelineRefForFinding({
        citation: "nope",
        issue_code: "totally_unknown_code",
      }),
    ).toBeNull();
  });

  it("returns null for null / empty findings", () => {
    expect(guidelineRefForFinding(null)).toBeNull();
    expect(guidelineRefForFinding(undefined)).toBeNull();
    expect(guidelineRefForFinding({})).toBeNull();
  });
});

describe("guidelineRefByKey — link tolerance", () => {
  it("resolves an entry without a links field (links absent)", () => {
    const ref = guidelineRefByKey("calibration_gold_only_miss");
    expect(ref).not.toBeNull();
    // Most entries don't carry links — must tolerate absence.
    expect(ref?.links).toBeUndefined();
  });

  it("surfaces links when the entry carries them (D8)", () => {
    const ref = guidelineRefByKey("D8");
    expect(ref?.links?.length).toBeGreaterThan(0);
    expect(ref?.links?.[0]).toHaveProperty("url");
    expect(ref?.links?.[0]).toHaveProperty("title");
  });

  it("returns null for an unknown key / empty key", () => {
    expect(guidelineRefByKey("nope")).toBeNull();
    expect(guidelineRefByKey("")).toBeNull();
    expect(guidelineRefByKey(null)).toBeNull();
  });
});
