/**
 * What a dataset's own samples say it is.
 *
 * The experiment-type tag is going away, and these three per-assay
 * fields replace it: `libraryStrategy`, `extractedMolecule`,
 * `librarySelection`. Fixtures are the shapes `GET
 * /datasets/{id}/samples` returned on gemma2, 2026-09-16 — GSE270825
 * (24 samples, SSRNA_SEQ / cDNA / polyARNA) and GSE11630 (32 samples,
 * MICROARRAY_ONE_COLOR / totalRNA, no selection).
 */
import { describe, expect, it } from "vitest";

import {
  libraryKindLabel,
  libraryProfile,
  libraryProfileTitle,
} from "./platformConstants";

const seq = (n: number) =>
  Array.from({ length: n }, () => ({
    libraryStrategy: "SSRNA_SEQ",
    librarySelection: "cDNA",
    extractedMolecule: "polyARNA",
  }));

const array = (n: number) =>
  Array.from({ length: n }, () => ({
    libraryStrategy: "MICROARRAY_ONE_COLOR",
    extractedMolecule: "totalRNA",
  }));

describe("libraryProfile", () => {
  it("tallies one uniform sequencing dataset", () => {
    const p = libraryProfile(seq(24));
    expect(p.total).toBe(24);
    expect(p.strategies).toEqual([
      { value: "SSRNA_SEQ", label: "ssRNA-seq", n: 24 },
    ]);
    expect(p.molecules).toEqual([
      { value: "polyARNA", label: "poly(A)+ RNA", n: 24 },
    ]);
    expect(p.selections).toEqual([{ value: "cDNA", label: "cDNA", n: 24 }]);
  });

  // Microarray records no library selection — the field describes
  // something the technology does not do. An empty tally, not a gap to
  // report.
  it("leaves selection empty for microarray", () => {
    expect(libraryProfile(array(32)).selections).toEqual([]);
  });

  it("orders a mixed dataset by how many samples carry each value", () => {
    const p = libraryProfile([...array(2), ...seq(5)]);
    expect(p.strategies.map((t) => [t.value, t.n])).toEqual([
      ["SSRNA_SEQ", 5],
      ["MICROARRAY_ONE_COLOR", 2],
    ]);
  });

  it("counts every assay in `total`, carrying a value or not", () => {
    expect(libraryProfile([...seq(2), {}, {}]).total).toBe(4);
  });
});

describe("libraryKindLabel", () => {
  it("names the strategy", () => {
    expect(libraryKindLabel(libraryProfile(seq(24)))).toBe("ssRNA-seq");
  });

  // A dataset that is part one thing and part another must say both.
  // Rendering only the majority states a fact that is wrong for the
  // rest of its samples — ~18 datasets on gemma2 are mixed.
  it("names every strategy in a mixed dataset", () => {
    expect(libraryKindLabel(libraryProfile([...seq(5), ...array(2)]))).toBe(
      "ssRNA-seq + One-colour microarray",
    );
  });

  it("is null when no sample records one, so the caller falls back", () => {
    expect(libraryKindLabel(libraryProfile([{}, {}]))).toBeNull();
    expect(libraryKindLabel(libraryProfile([]))).toBeNull();
    expect(libraryKindLabel(null)).toBeNull();
  });

  // Unmapped upstream values render as themselves rather than
  // disappearing — a strategy Gemma adds shows up unlabelled, not as
  // "no kind recorded".
  it("falls through to the raw value for an unmapped strategy", () => {
    expect(
      libraryKindLabel(libraryProfile([{ libraryStrategy: "ATAC_SEQ" }])),
    ).toBe("ATAC_SEQ");
  });
});

describe("libraryProfileTitle", () => {
  it("states the three fields when they cover every sample", () => {
    expect(libraryProfileTitle(libraryProfile(seq(24)))).toBe(
      "From the samples' own library records — ssRNA-seq · poly(A)+ RNA · cDNA selection.",
    );
  });

  it("omits a field no sample carries", () => {
    expect(libraryProfileTitle(libraryProfile(array(32)))).toBe(
      "From the samples' own library records — One-colour microarray · total RNA.",
    );
  });

  // The count is the point of the sentence: a value on some samples is
  // not a fact about the dataset, and "n of m" is what keeps the two
  // apart.
  it("says n of m when a value covers only some samples", () => {
    const p = libraryProfile([...seq(3), {}, {}]);
    expect(libraryProfileTitle(p)).toBe(
      "From the samples' own library records — ssRNA-seq (3 of 5) · poly(A)+ RNA (3 of 5) · cDNA selection (3 of 5).",
    );
  });

  it("breaks a mixed dataset down by strategy", () => {
    const p = libraryProfile([...seq(5), ...array(2)]);
    expect(libraryProfileTitle(p)).toContain(
      "ssRNA-seq (5 of 7), One-colour microarray (2 of 7)",
    );
  });

  it("is null with nothing to describe", () => {
    expect(libraryProfileTitle(libraryProfile([]))).toBeNull();
    expect(libraryProfileTitle(libraryProfile([{}, {}]))).toBeNull();
  });
});
