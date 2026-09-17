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
  libraryProfileFromCounts,
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

// The dataset payload's own tallies, landed gemma-side 2026-09-16.
// Shapes are from the contract handoff: {value, numberOfBioAssays},
// ordered by descending count, ties broken on the value, and a null
// value counting the assays that record none.
describe("libraryProfileFromCounts", () => {
  it("reads the tallies without touching a sample", () => {
    const p = libraryProfileFromCounts(
      {
        strategies: [{ value: "SSRNA_SEQ", numberOfBioAssays: 24 }],
        molecules: [{ value: "polyARNA", numberOfBioAssays: 24 }],
        selections: [{ value: "cDNA", numberOfBioAssays: 24 }],
      },
      24,
    );
    expect(libraryKindLabel(p)).toBe("ssRNA-seq");
    expect(libraryProfileTitle(p)).toBe(
      "From the samples' own library records — ssRNA-seq · poly(A)+ RNA · cDNA selection.",
    );
  });

  // 🛑 A null entry is the count of assays recording NOTHING. It keeps
  // the counts summing to the dataset's assay count, and a microarray
  // dataset's selections arrive as [{null, 30}] rather than empty —
  // which must read as "no selection recorded", not as a value called
  // "null".
  it("treats a null value as not-recorded, not as a level", () => {
    const p = libraryProfileFromCounts(
      {
        strategies: [{ value: "MICROARRAY_ONE_COLOR", numberOfBioAssays: 30 }],
        molecules: [{ value: "totalRNA", numberOfBioAssays: 30 }],
        selections: [{ value: null, numberOfBioAssays: 30 }],
      },
      30,
    );
    expect(p.selections).toEqual([]);
    expect(libraryProfileTitle(p)).toBe(
      "From the samples' own library records — One-colour microarray · total RNA.",
    );
  });

  // GSE38680 as the payload will report it until the backfill lands:
  // 45 of 58 totalRNA, 13 recording nothing. The count has to read as
  // partial rather than as a fact about the whole dataset.
  it("keeps the total, so a partly-recorded field says n of m", () => {
    const p = libraryProfileFromCounts(
      {
        strategies: [{ value: "MICROARRAY_ONE_COLOR", numberOfBioAssays: 58 }],
        molecules: [
          { value: "totalRNA", numberOfBioAssays: 45 },
          { value: null, numberOfBioAssays: 13 },
        ],
      },
      58,
    );
    expect(libraryProfileTitle(p)).toBe(
      "From the samples' own library records — One-colour microarray · total RNA (45 of 58).",
    );
  });

  // Entries arrive ordered by descending count, and the label must
  // keep that order: [0] is the value that speaks for the dataset.
  it("keeps the server's order for a mixed dataset", () => {
    const p = libraryProfileFromCounts(
      {
        strategies: [
          { value: "RNA_SEQ", numberOfBioAssays: 12 },
          { value: "CHIP_SEQ", numberOfBioAssays: 4 },
        ],
      },
      16,
    );
    expect(libraryKindLabel(p)).toBe("RNA-Seq + ChIP-Seq");
  });

  it("is empty for a dataset with no samples", () => {
    const p = libraryProfileFromCounts({ strategies: [] }, 0);
    expect(libraryKindLabel(p)).toBeNull();
    expect(libraryProfileTitle(p)).toBeNull();
  });
});
