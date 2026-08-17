/**
 * Cases taken from GSE49354 (experiment 27438) and GSE-2427, because
 * the shapes that matter here are the ones real submitters produce:
 * `fetal Heart` curated to `heart`, `stroma` curated to something
 * else entirely, and a characteristic column whose name matches the
 * factor only case-insensitively.
 */
import { describe, expect, it } from "vitest";

import type { Biomaterial, Factor } from "@/features/experiment/types";

import {
  matchesOriginal,
  originalValuesByFv,
  sourceCharacteristicKey,
} from "./originalValue";

function bm(shortName: string, characteristics: Record<string, string>) {
  return { short_name: shortName, characteristics } as unknown as Biomaterial;
}

function factor(
  category: string,
  fvs: { id: number; label: string; samples: string[] }[],
  name = category,
): Factor {
  return {
    id: 1,
    name,
    category: { label: category, uri: "http://www.ebi.ac.uk/efo/EFO_0000635" },
    description: "",
    type: "categorical",
    factor_values: fvs.map((f) => ({
      id: f.id,
      free_text_label: f.label,
      is_baseline: false,
      statements: [],
      biomaterial_short_names: f.samples,
    })),
  } as unknown as Factor;
}

const GSE49354 = [
  bm("GSM1197892", { "organism part": "fetal Heart" }),
  bm("GSM1197893", { "organism part": "fetal Heart" }),
  bm("GSM1197956", { "organism part": "stroma" }),
  bm("GSM1197957", { "organism part": "stroma" }),
  bm("GSM1197945", { "organism part": "placenta" }),
];

describe("originalValuesByFv", () => {
  it("shows what the submitter wrote, even where curation renamed it", () => {
    const f = factor("organism part", [
      { id: 1, label: "heart", samples: ["GSM1197892", "GSM1197893"] },
      { id: 5, label: "placental villous stroma", samples: ["GSM1197956"] },
    ]);
    const got = originalValuesByFv(f, GSE49354);
    expect(got.get(1)).toEqual(["fetal Heart"]);
    expect(got.get(5)).toEqual(["stroma"]);
  });

  // 🛑 The reason it renders on every value, not only the renamed
  // ones: without the unchanged case a curator can't tell "the
  // submitter said this too" from "no source was recorded", and those
  // are the two readings the whole thing exists to separate.
  it("reports the original even when curation left it alone", () => {
    const f = factor("organism part", [
      { id: 7, label: "placenta", samples: ["GSM1197945"] },
    ]);
    expect(originalValuesByFv(f, GSE49354).get(7)).toEqual(["placenta"]);
  });

  // A merge is real curation and this is the only surface that shows
  // it happened.
  it("keeps every distinct original when one FV merges several", () => {
    const f = factor("organism part", [
      {
        id: 1,
        label: "heart",
        samples: ["GSM1197892", "GSM1197945", "GSM1197956"],
      },
    ]);
    expect(originalValuesByFv(f, GSE49354).get(1)).toEqual([
      "fetal Heart",
      "placenta",
      "stroma",
    ]);
  });

  it("dedupes repeats without reordering the rest", () => {
    const f = factor("organism part", [
      {
        id: 1,
        label: "heart",
        samples: ["GSM1197892", "GSM1197893", "GSM1197892"],
      },
    ]);
    expect(originalValuesByFv(f, GSE49354).get(1)).toEqual(["fetal Heart"]);
  });

  // A factor a curator built by hand has no source characteristic.
  // Guessing which column it might have come from would put words in
  // the submitter's mouth.
  it("says nothing when no characteristic answers to the factor", () => {
    const f = factor("disease", [
      { id: 1, label: "melanoma", samples: ["GSM1197892"] },
    ]);
    expect(originalValuesByFv(f, GSE49354).size).toBe(0);
  });

  it("omits an FV whose samples carry no value in that column", () => {
    const f = factor("organism part", [
      { id: 1, label: "heart", samples: ["GSM1197892"] },
      { id: 2, label: "curator invented this", samples: [] },
    ]);
    const got = originalValuesByFv(f, GSE49354);
    expect(got.has(1)).toBe(true);
    expect(got.has(2)).toBe(false);
  });
});

describe("sourceCharacteristicKey", () => {
  // The characteristics map is keyed by the names the SUBMITTER wrote,
  // so the match has to tolerate their capitalisation without
  // rewriting it.
  it("matches the column case-insensitively", () => {
    const f = factor("Organism Part", [
      { id: 1, label: "heart", samples: ["GSM1197892"] },
    ]);
    expect(sourceCharacteristicKey(f, GSE49354)).toBe("organism part");
  });

  // A promoted factor takes its name from the characteristic key; a
  // curator who later grounds the category shouldn't sever the link
  // back to the column it came from.
  it("falls back to the factor's own name when the category moved on", () => {
    const f = factor("anatomical entity", [
      { id: 1, label: "heart", samples: ["GSM1197892"] },
    ], "organism part");
    expect(sourceCharacteristicKey(f, GSE49354)).toBe("organism part");
  });
});

describe("matchesOriginal", () => {
  it("ignores case and padding — neither is a curation decision", () => {
    expect(matchesOriginal("Heart", [" heart "])).toBe(true);
  });

  it("counts a merge as a change even if one side matches", () => {
    expect(matchesOriginal("heart", ["heart", "fetal Heart"])).toBe(false);
  });

  it("is false when there is nothing to compare", () => {
    expect(matchesOriginal("", ["heart"])).toBe(false);
    expect(matchesOriginal("heart", [])).toBe(false);
  });
});
