import { describe, expect, it } from "vitest";
import { evidenceSourceMeta } from "./evidenceSource";

/**
 * Tests for the per-source evidence presentation. The key behaviours:
 * a stable label + distinct (non-emerald) accent per source, and the
 * Cellosaurus catalog special-case relabel/badge.
 */
describe("evidenceSourceMeta", () => {
  it("maps each source to its curator-facing label (GEO vocabulary)", () => {
    // Names where it came from, not just what it is — the sibling is
    // already "GEO metadata", and a bare "sample characteristic" left
    // curators to guess whether the submitter wrote it or we derived
    // it (2026-08-16).
    expect(evidenceSourceMeta("characteristic").label).toBe(
      "GEO sample characteristic",
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

  it("falls back to a neutral label for an unknown/missing source — never 'sample characteristic'", () => {
    // Wire could carry a source the UI doesn't model yet (or an empty
    // string). Defaulting to the authoritative "sample characteristic"
    // misrepresents unknown provenance (design review 2026-06-19); stay neutral.
    const unknown = evidenceSourceMeta("totally_new_source" as never);
    expect(unknown.label).toBe("source");
    expect(unknown.label).not.toBe("sample characteristic");
    expect(evidenceSourceMeta("" as never).label).toBe("source");
  });
});
