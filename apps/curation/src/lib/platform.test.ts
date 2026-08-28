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
