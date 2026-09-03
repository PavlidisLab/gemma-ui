/**
 * GENELIST means sequencing, and it is half the corpus.
 *
 * 🛑 GENELIST is not an instrument. It is the generic platform Gemma
 * switches sequencing data ONTO — "Generic platform for Mus musculus,
 * indexed by NCBI IDs" and its human and rat siblings. Measured on 500
 * datasets, 2026-08-28:
 *
 *     GENELIST 252 · ONECOLOR 185 · TWOCOLOR 43 · DUALMODE 19 · SEQUENCING 1
 *
 * All 252 GENELIST datasets carry an `originalPlatforms` entry and every
 * one of those reads SEQUENCING. So a classifier that sends GENELIST to
 * unknown — or worse, to microarray — is wrong about half of everything.
 *
 * `inferModality` has treated GENELIST as sequencing since it was
 * written. What it never had was a value: Gemma answered
 * `technologyType: null` on 300 of 300 datasets until the field was
 * populated on 2026-08-28, so this branch had never once fired against
 * real data and nothing said what depended on it.
 *
 * ⚠️ The regex fallback below it cannot cover this. On a switched
 * dataset the platform NAME is "Generic platform for Mus musculus,
 * indexed by NCBI IDs", which says nothing about sequencing at all.
 */
import { describe, expect, it } from "vitest";
import { inferModality } from "./modality";
import type { Design } from "./types";

const design = (patch: Partial<Design>): Design =>
  ({ factors: [], tags: [], ...patch }) as unknown as Design;

describe("inferModality — GENELIST", () => {
  it("reads GENELIST as bulk RNA-seq, not unknown", () => {
    expect(inferModality(design({ technology_type: "GENELIST" }))).toBe(
      "bulk-rnaseq",
    );
  });

  it("is not rescued by the platform name — GSE21860's says nothing", () => {
    // The name is the only other signal, and on a switched dataset it is
    // the generic stand-in. Without the classifier this is "unknown".
    const d = design({
      platform: "Generic platform for Mus musculus, indexed by NCBI IDs",
    });
    expect(inferModality(d)).toBe("unknown");
  });

  it("still refines to single-cell when the assay tags say so", () => {
    const d = design({
      technology_type: "GENELIST",
      tags: [
        {
          category: { label: "assay", uri: null },
          value: { label: "single-cell RNA sequencing assay", uri: null },
        },
      ] as unknown as Design["tags"],
    });
    expect(inferModality(d)).toBe("single-cell");
  });

  it("the microarray classifiers are unaffected", () => {
    for (const tt of ["ONECOLOR", "TWOCOLOR", "DUALMODE"]) {
      expect(inferModality(design({ technology_type: tt }))).toBe("microarray");
    }
  });

  it("SEQUENCING reads as bulk unless the tags refine it", () => {
    expect(inferModality(design({ technology_type: "SEQUENCING" }))).toBe(
      "bulk-rnaseq",
    );
  });

  it("an empty classifier with nothing else is unknown, not a guess", () => {
    expect(inferModality(design({ technology_type: "" }))).toBe("unknown");
  });
});

/**
 * 🛑 Gemma's own `isSingleCell` outranks every heuristic in this module.
 *
 * The tests above exist because `technology_type` could not separate
 * single-cell from bulk — and measured over 100 single-cell datasets on
 * 2026-09-03, it is **GENELIST on all 100**. So the regex was carrying
 * the whole load: it fired on any study whose platform string mentioned
 * 10x and missed any that did not.
 *
 * `is_single_cell` was true on 92 of those 100 and false on 8, and the 8
 * false are exactly the 8 with no subset groups — it tracks whether
 * single-cell data is LOADED, which is what the tab is gated on.
 */
describe("inferModality — Gemma's own is_single_cell", () => {
  it("wins over a GENELIST technology type with nothing else to go on", () => {
    // The shape of all 100: GENELIST, no assay tag naming 10x. Without
    // the flag this is "bulk-rnaseq".
    const d = design({ technology_type: "GENELIST" });
    expect(inferModality(d)).toBe("bulk-rnaseq");
    expect(inferModality({ ...d, is_single_cell: true })).toBe("single-cell");
  });

  it("wins over a platform string that says microarray", () => {
    // A single-cell study whose stand-in platform name mentions an array
    // must not be classified off the string when Gemma has answered.
    const d = design({
      technology_type: "",
      platform: "Affymetrix Human Genome U133 Plus 2.0",
    });
    expect(inferModality(d)).toBe("microarray");
    expect(inferModality({ ...d, is_single_cell: true })).toBe("single-cell");
  });

  it("🛑 a FALSE flag does not short-circuit — it is not a modality answer", () => {
    // `is_single_cell: false` says "not single-cell"; it does not say
    // whether the study is microarray or bulk, so the heuristics still
    // have to run.
    const d = design({ technology_type: "ONECOLOR", is_single_cell: false });
    expect(inferModality(d)).toBe("microarray");
    const seq = design({ technology_type: "SEQUENCING", is_single_cell: false });
    expect(inferModality(seq)).toBe("bulk-rnaseq");
  });

  it("falls back to the heuristics when the flag is absent", () => {
    // Local mode, and any host predating 2026-09-03. The 10x string is
    // all there is, and it still works.
    const d = design({
      technology_type: "GENELIST",
      platform: "10x Genomics Chromium",
    });
    expect(d.is_single_cell).toBeUndefined();
    expect(inferModality(d)).toBe("single-cell");
  });

  it("does not treat the flag as present when it is explicitly null", () => {
    const d = { ...design({ technology_type: "ONECOLOR" }), is_single_cell: undefined };
    expect(inferModality(d)).toBe("microarray");
  });
});
