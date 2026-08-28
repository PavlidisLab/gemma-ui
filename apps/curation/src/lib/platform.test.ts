/**
 * The platform, from either producer, against bytes gemma2 sends.
 *
 * Gemma had no platform on its dataset VO until 2026-08-28 — the whole
 * platform line rendered blank in remote mode, so a curator could not
 * see what a dataset was run on, and `originalPlatform` (the field that
 * says a dataset was switched) was invisible. gembro added `platforms`
 * and `originalPlatforms` to both `/datasets` and `/datasets/{id}` at no
 * measurable cost (build `cb6b67e854`).
 *
 * Both fixtures below are verbatim from that build.
 */
import { describe, expect, it } from "vitest";
import { snakeify } from "@/api/client";
import { platformFields, type PlatformBearingRow } from "./platform";

/** ee 1658 / GSE11630 — one platform, never switched. */
const NOT_SWITCHED = {
  platforms: [
    {
      id: 350,
      shortName: "GPL571",
      name: "Affymetrix GeneChip Human Genome U133A 2.0 Array",
    },
  ],
  originalPlatforms: [],
};

/** ee 715 / GSE8939 — moved off GPL96 onto a merged platform. */
const SWITCHED = {
  platforms: [
    { id: 226, shortName: "HG-U133A/B/Plus_2", name: "HG-U133_Plus_2 or U133A or U133B" },
  ],
  originalPlatforms: [
    {
      id: 1,
      shortName: "GPL96",
      name: "Affymetrix GeneChip Human Genome U133 Array Set HG-U133A",
    },
  ],
};

const wire = (o: unknown) => snakeify(o) as PlatformBearingRow;

describe("platformFields — Gemma's list shape", () => {
  it("reads the platform name and short name", () => {
    const f = platformFields(wire(NOT_SWITCHED));
    expect(f.platform_short_name).toBe("GPL571");
    expect(f.platform).toBe("Affymetrix GeneChip Human Genome U133A 2.0 Array");
    expect(f.platform_id).toBe(350);
  });

  it("an empty originalPlatforms means NOT switched", () => {
    // 🛑 Gemma leaves out an "original" that is also in use, so the
    // emptiness is the answer to "was this moved", not a missing record.
    const f = platformFields(wire(NOT_SWITCHED));
    expect(f.original_platform).toBe("");
    expect(f.original_platform_short_name).toBe("");
    expect(f.original_platform_id).toBeNull();
  });

  it("a non-empty originalPlatforms names what it was moved off", () => {
    const f = platformFields(wire(SWITCHED));
    expect(f.platform_short_name).toBe("HG-U133A/B/Plus_2");
    expect(f.original_platform_short_name).toBe("GPL96");
    expect(f.original_platform).toBe(
      "Affymetrix GeneChip Human Genome U133 Array Set HG-U133A",
    );
  });
});

describe("platformFields — the store's flat shape", () => {
  it("reads the flat scalars unchanged", () => {
    const f = platformFields({
      platform: "Illumina HiSeq 2500",
      platform_short_name: "GPL16791",
      platform_id: 7,
    });
    expect(f.platform).toBe("Illumina HiSeq 2500");
    expect(f.platform_short_name).toBe("GPL16791");
    expect(f.platform_id).toBe(7);
  });

  it("the flat name wins when a row somehow carries both", () => {
    const f = platformFields({
      platform_short_name: "GPL16791",
      platforms: [{ id: 1, short_name: "GPL96", name: "n" }],
    });
    expect(f.platform_short_name).toBe("GPL16791");
  });
});

describe("platformFields — more than one platform", () => {
  it("names every one rather than the first", () => {
    // Showing one of three is a wrong answer given confidently.
    const f = platformFields({
      platforms: [
        { id: 1, short_name: "GPL96", name: "U133A" },
        { id: 2, short_name: "GPL97", name: "U133B" },
      ],
    });
    expect(f.platform_short_name).toBe("GPL96 · GPL97");
    expect(f.platform).toBe("U133A · U133B");
  });

  it("drops the id when it would not identify the joined string", () => {
    const f = platformFields({
      platforms: [
        { id: 1, short_name: "GPL96", name: "U133A" },
        { id: 2, short_name: "GPL97", name: "U133B" },
      ],
    });
    expect(f.platform_id).toBeNull();
  });
});

describe("platformFields — nothing to report", () => {
  it("returns empty strings and null ids, never undefined", () => {
    for (const r of [null, undefined, {}, { platforms: [] }]) {
      const f = platformFields(r as PlatformBearingRow | null | undefined);
      expect(f.platform).toBe("");
      expect(f.platform_short_name).toBe("");
      expect(f.platform_id).toBeNull();
      expect(f.original_platform).toBe("");
    }
  });
});

/**
 * The technology classifier.
 *
 * 🛑 GENELIST is not an instrument. It is the generic platform Gemma
 * switches sequencing data ONTO — "Generic platform for Mus musculus,
 * indexed by NCBI IDs" — and it is HALF the corpus: 252 of 500 sampled
 * read GENELIST against 1 that reads SEQUENCING. Every one of those 252
 * carries an `originalPlatforms` entry and every one of those is
 * SEQUENCING (gembro, measured 2026-08-28).
 *
 * So a modality map that sends GENELIST to unknown, or to microarray,
 * is wrong on half of everything — and the platform NAME cannot rescue
 * it, because on a switched dataset the name is "Generic platform for…"
 * and says nothing about sequencing. `modality.ts` already routes
 * GENELIST to sequencing; this pins the field reaching it.
 *
 * Fixtures verbatim from gemma2 build `5e18682e84`.
 */
describe("platformFields — technology type", () => {
  it("takes the dataset's own classifier when it has one", () => {
    // ee 517 / GSE6306.
    const f = platformFields(
      wire({
        technologyType: "ONECOLOR",
        platforms: [{ id: 1, shortName: "GPL96", name: "U133A", technologyType: "ONECOLOR" }],
        originalPlatforms: [],
      }),
    );
    expect(f.technology_type).toBe("ONECOLOR");
  });

  it("carries GENELIST through, and names the sequencer it was switched off", () => {
    // GSE21860 — the shape half the corpus has.
    const f = platformFields(
      wire({
        technologyType: "GENELIST",
        platforms: [
          { id: 2, shortName: "Generic_mouse_ncbiIds", name: "Generic platform for Mus musculus, indexed by NCBI IDs", technologyType: "GENELIST" },
        ],
        originalPlatforms: [{ id: 3, shortName: "GPL9185", name: "Illumina Genome Analyzer II", technologyType: "SEQUENCING" }],
      }),
    );
    expect(f.technology_type).toBe("GENELIST");
    expect(f.original_platform_short_name).toBe("GPL9185");
    // The name that would have to carry it if the classifier did not.
    expect(f.platform).toContain("Generic platform");
  });

  it("falls back to the platforms when the dataset field is null", () => {
    // Null there means "they disagree — ask the platforms", never
    // "unknown".
    const f = platformFields(
      wire({
        technologyType: null,
        platforms: [
          { id: 1, shortName: "A", name: "a", technologyType: "SEQUENCING" },
          { id: 2, shortName: "B", name: "b", technologyType: "SEQUENCING" },
        ],
      }),
    );
    expect(f.technology_type).toBe("SEQUENCING");
  });

  it("says nothing when the platforms genuinely disagree", () => {
    // A dataset on a microarray AND a sequencer is both. Picking one
    // labels half of it wrong with nothing to mark the guess.
    const f = platformFields(
      wire({
        technologyType: null,
        platforms: [
          { id: 1, shortName: "A", name: "a", technologyType: "ONECOLOR" },
          { id: 2, shortName: "B", name: "b", technologyType: "SEQUENCING" },
        ],
      }),
    );
    expect(f.technology_type).toBe("");
  });

  it("is a string when nothing carries one", () => {
    expect(platformFields({}).technology_type).toBe("");
    expect(platformFields(null).technology_type).toBe("");
  });
});
