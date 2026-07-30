import { describe, expect, it } from "vitest";
import { taxonAbbreviation, taxonSortPriority } from "./taxon";

/**
 * Tests for the taxon display helpers that let the term picker show
 * ``KRAS (H.s.)`` vs ``Kras (M.m.)`` as distinguishable rows. Anchor
 * mappings are the fixed genus-species → abbreviation table in
 * ``taxon.ts``, covering the common lab species Gemma sees.
 */
describe("taxonAbbreviation", () => {
  it("abbreviates the anchor species to G.s. form", () => {
    expect(taxonAbbreviation("Homo sapiens")).toBe("H.s.");
    expect(taxonAbbreviation("Mus musculus")).toBe("M.m.");
    expect(taxonAbbreviation("Rattus norvegicus")).toBe("R.n.");
    expect(taxonAbbreviation("Danio rerio")).toBe("D.r.");
    expect(taxonAbbreviation("Drosophila melanogaster")).toBe("D.m.");
    expect(taxonAbbreviation("Caenorhabditis elegans")).toBe("C.e.");
    expect(taxonAbbreviation("Mycobacterium tuberculosis")).toBe("M.t.");
  });

  it("returns empty string for null / blank / single-word names", () => {
    expect(taxonAbbreviation(null)).toBe("");
    expect(taxonAbbreviation(undefined)).toBe("");
    expect(taxonAbbreviation("")).toBe("");
    expect(taxonAbbreviation("   ")).toBe("");
    expect(taxonAbbreviation("Homo")).toBe("");
  });

  it("tolerates extra whitespace between genus and species", () => {
    expect(taxonAbbreviation("  Homo   sapiens  ")).toBe("H.s.");
  });
});

describe("taxonSortPriority", () => {
  it("orders human < mouse < rat < others", () => {
    expect(taxonSortPriority("human", "Homo sapiens")).toBe(0);
    expect(taxonSortPriority("mouse", "Mus musculus")).toBe(1);
    expect(taxonSortPriority("rat", "Rattus norvegicus")).toBe(2);
    expect(taxonSortPriority("zebrafish", "Danio rerio")).toBe(3);
  });

  it("matches on scientific name when common name is missing", () => {
    expect(taxonSortPriority(null, "Homo sapiens")).toBe(0);
    expect(taxonSortPriority(undefined, "Mus musculus")).toBe(1);
  });

  it("falls through to lowest priority when nothing is known", () => {
    expect(taxonSortPriority(null, null)).toBe(3);
  });
});
