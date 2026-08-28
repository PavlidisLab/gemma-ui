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
