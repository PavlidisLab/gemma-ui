import { describe, expect, it } from "vitest";
import { evidenceSourceMeta } from "./evidenceSource";

/**
 * Tests for the per-source evidence presentation. The key behaviours:
 * a stable label + distinct (non-emerald) accent per source, and the
 * Cellosaurus catalog special-case relabel/badge.
 */
describe("evidenceSourceMeta", () => {
  it("maps each source to its curator-facing label (GEO vocabulary)", () => {
    expect(evidenceSourceMeta("characteristic").label).toBe(
      "sample characteristic",
    );
    expect(evidenceSourceMeta("paper").label).toBe("paper");
    expect(evidenceSourceMeta("geo_metadata").label).toBe("GEO metadata");
    expect(evidenceSourceMeta("sample_names").label).toBe("sample names");
    expect(evidenceSourceMeta("preboarding").label).toBe("lab catalog");
  });

  it("gives each source a distinct border accent, none of them green", () => {
    const keys = [
      "characteristic",
      "paper",
      "geo_metadata",
      "sample_names",
      "preboarding",
    ] as const;
    const borders = keys.map((k) => evidenceSourceMeta(k).borderCls);
    // All distinct.
    expect(new Set(borders).size).toBe(keys.length);
    // Emerald is reserved for the ontology-backed cue.
    for (const b of borders) expect(b).not.toMatch(/emerald|green/);
  });

  it("badges the Cellosaurus catalog special-case but keeps the 'lab catalog' label", () => {
    const meta = evidenceSourceMeta("preboarding", "cellosaurus_catalog");
    expect(meta.label).toBe("lab catalog");
    expect(meta.badge).toBe("Cellosaurus");
  });

  it("only badges preboarding+cellosaurus_catalog, not other locations", () => {
    expect(evidenceSourceMeta("preboarding", "some other location").label).toBe(
      "lab catalog",
    );
    expect(evidenceSourceMeta("preboarding").badge).toBeUndefined();
  });
});
