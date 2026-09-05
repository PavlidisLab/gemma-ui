/**
 * The gene page's sub-resources, pinned to what the wire actually
 * sends. All three had a TS interface that described a payload Gemma
 * does not serve, and every mismatch failed silently — an absent field
 * types as `undefined`, so the UI rendered a blank rather than an
 * error.
 *
 * Fixtures are verbatim rows measured on gemma2 `886eb555fb` (TP53,
 * NCBI 7157, 2026-09-04).
 *
 * The Function section shows a GO COUNT, not the terms, so `GoTerm`'s
 * corrected shape is documented on the interface rather than exercised
 * here — nothing renders a term any more.
 *
 * The sub-resources are keyed by NCBI id, not by `gene.id`. TP53's
 * internal id is 162841 and `/genes/162841/locations` 404s with "The
 * identifier was recognised to be 'ncbiGeneId'"; 7157 answers. That is
 * the trap this whole file exists to keep shut.
 */
import { describe, expect, it } from "vitest";
import { geneLocationRange, formatMultifunctionalityRank } from "./endpoints";

/** `/genes/7157/locations` — the only row TP53 has. Note there is no
 *  `nucleotideStart` and no `nucleotideEnd`: a START and a LENGTH. */
const TP53_LOCATION = {
  id: 120460234,
  nucleotide: 7668420,
  nucleotideLength: 19069,
  strand: "-",
  bin: 643,
  chromosome: "17",
};

/** `/genes/7157/overview` — the one field that endpoint adds over the
 *  plain `/genes/{gene}` payload, and the reason the Function section
 *  calls it at all. */
const TP53_MULTIFUNCTIONALITY_RANK = 0.9993201359728054;

describe("geneLocationRange — start plus length, not start and end", () => {
  it("derives the end by adding the length to the start", () => {
    // chr17:7,668,420–7,687,489. Reading `nucleotideEnd` off this row
    // yields undefined, which printed "?" on the page.
    expect(geneLocationRange(TP53_LOCATION)).toEqual({
      start: 7668420,
      end: 7687489,
    });
  });

  it("yields null rather than NaN when the length is missing", () => {
    expect(geneLocationRange({ nucleotide: 7668420 })).toEqual({
      start: 7668420,
      end: null,
    });
  });

  it("yields nulls for a row with no coordinates at all", () => {
    expect(geneLocationRange({ chromosome: "17" })).toEqual({
      start: null,
      end: null,
    });
  });

  it("keeps a zero start, which is falsy but real", () => {
    expect(geneLocationRange({ nucleotide: 0, nucleotideLength: 500 })).toEqual({
      start: 0,
      end: 500,
    });
  });
});

describe("formatMultifunctionalityRank — two decimals, like the legacy page", () => {
  it("rounds TP53's rank the way the legacy page prints it", () => {
    // gemma2 sends 0.9993201359728054; showGene.html reads "1.00".
    expect(formatMultifunctionalityRank(TP53_MULTIFUNCTIONALITY_RANK)).toBe("1.00");
  });

  it("keeps a mid-range rank legible", () => {
    expect(formatMultifunctionalityRank(0.5)).toBe("0.50");
    expect(formatMultifunctionalityRank(0.123456)).toBe("0.12");
  });

  it("prints a real zero rather than hiding it", () => {
    expect(formatMultifunctionalityRank(0)).toBe("0.00");
  });

  it("returns null for an absent score, never \"0.00\"", () => {
    // "0.00" would assert the gene is minimally multifunctional, which
    // is the opposite claim from "we don't have a score".
    expect(formatMultifunctionalityRank(null)).toBeNull();
    expect(formatMultifunctionalityRank(undefined)).toBeNull();
    expect(formatMultifunctionalityRank(NaN)).toBeNull();
  });
});
