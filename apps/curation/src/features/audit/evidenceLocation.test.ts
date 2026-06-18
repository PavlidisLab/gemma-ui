import { describe, expect, it } from "vitest";
import { parseEvidenceLocation } from "./evidenceLocation";

/**
 * Tests for the evidence-location parser. Shapes come from
 * UIB_HANDOFF_2026_06_18_TAG_EVIDENCE_QUOTES §3.
 */
describe("parseEvidenceLocation", () => {
  it("parses constant coverage — 'scope (all N samples)'", () => {
    expect(parseEvidenceLocation("strain (all 24 samples)")).toEqual({
      kind: "constant",
      scope: "strain",
      count: 24,
    });
  });

  it("handles singular 'all 1 sample'", () => {
    const r = parseEvidenceLocation("sex (all 1 sample)");
    expect(r).toEqual({ kind: "constant", scope: "sex", count: 1 });
  });

  it("parses partial coverage with a sample list + '+N more'", () => {
    expect(
      parseEvidenceLocation(
        "strain in GSM0, GSM1, GSM2, +1 more (4/6 samples)",
      ),
    ).toEqual({
      kind: "partial",
      scope: "strain",
      samples: ["GSM0", "GSM1", "GSM2"],
      moreCount: 1,
      matched: 4,
      total: 6,
    });
  });

  it("parses partial coverage with no '+N more'", () => {
    const r = parseEvidenceLocation("cell type in GSM0, GSM1 (2/2 samples)");
    expect(r).toMatchObject({
      kind: "partial",
      samples: ["GSM0", "GSM1"],
      moreCount: 0,
      matched: 2,
      total: 2,
    });
  });

  it("flags the producer-bug 0/N case", () => {
    expect(
      parseEvidenceLocation(
        "strain (claimed by caller but matched 0/6 samples — investigate)",
      ),
    ).toEqual({ kind: "bug", scope: "strain", total: 6 });
  });

  it("parses a paper-scan alias mapping (unicode + ASCII arrow)", () => {
    expect(
      parseEvidenceLocation("matched alias 'C57BL/6J' → 'C57BL/6J'"),
    ).toEqual({ kind: "alias", from: "C57BL/6J", to: "C57BL/6J" });
    expect(
      parseEvidenceLocation("matched alias 'B6' -> 'C57BL/6J'"),
    ).toEqual({ kind: "alias", from: "B6", to: "C57BL/6J" });
  });

  it("recognises the Cellosaurus catalog sentinel", () => {
    expect(parseEvidenceLocation("cellosaurus_catalog")).toEqual({
      kind: "catalog",
    });
  });

  it("falls back to plain for unrecognised / empty strings", () => {
    expect(parseEvidenceLocation("strain key")).toEqual({
      kind: "plain",
      text: "strain key",
    });
    expect(parseEvidenceLocation("")).toEqual({ kind: "plain", text: "" });
    expect(parseEvidenceLocation(null)).toEqual({ kind: "plain", text: "" });
  });
});
