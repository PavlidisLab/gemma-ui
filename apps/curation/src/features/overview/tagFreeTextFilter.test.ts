import { describe, expect, it } from "vitest";
import {
  hiddenFreeTextValueCount,
  visibleTagValues,
} from "./tagFreeTextFilter";

/**
 * The GSE104849 shape that started this: three inherited BM-synth
 * tags, each mixing one ontology-resolved value with raw ones. The
 * tag-level test called every one of them "resolved", so five italic
 * chips rendered with "Hide free-text" checked.
 */
const CLO = "http://purl.obolibrary.org/obo/CLO_0000010";
const MONDO = "http://purl.obolibrary.org/obo/MONDO_0005105";
const CLO_A375 = "http://purl.obolibrary.org/obo/CLO_0001582";

const SOURCE = [
  { label: "ATCC cell line cell", uri: CLO },
  { label: "generated at DKFZ", uri: null },
  { label: "isolated at DKFZ", uri: null },
];
const BIOSOURCE = [
  { label: "melanoma", uri: MONDO },
  { label: "healthy donnor", uri: null },
];
const CELL_LINE = [
  { label: "A-375 cell", uri: CLO_A375 },
  { label: "Skmel28", uri: null },
  { label: "WM266-4", uri: null },
];

describe("visibleTagValues", () => {
  it("passes everything through when the box is unchecked", () => {
    expect(visibleTagValues(SOURCE, false)).toEqual(SOURCE);
  });

  it("drops the raw values of a mixed tag, keeping the resolved one", () => {
    expect(visibleTagValues(SOURCE, true).map((v) => v.label)).toEqual([
      "ATCC cell line cell",
    ]);
    expect(visibleTagValues(BIOSOURCE, true).map((v) => v.label)).toEqual([
      "melanoma",
    ]);
    expect(visibleTagValues(CELL_LINE, true).map((v) => v.label)).toEqual([
      "A-375 cell",
    ]);
  });

  it("keeps the values when NOTHING in the group resolves", () => {
    // Such a group only reaches the renderer when a statement resolved
    // its entities — filtering would leave an empty chip in the row.
    const raw = [
      { label: "batch 3", uri: null },
      { label: "2019-05-15", uri: null },
    ];
    expect(visibleTagValues(raw, true)).toEqual(raw);
  });

  it("is a no-op on an all-resolved group", () => {
    const resolved = [{ label: "total RNA", uri: "http://efo/EFO_0004964" }];
    expect(visibleTagValues(resolved, true)).toEqual(resolved);
  });
});

describe("hiddenFreeTextValueCount", () => {
  it("counts the raw values of a mixed tag", () => {
    expect(hiddenFreeTextValueCount(SOURCE, true)).toBe(2);
    expect(hiddenFreeTextValueCount(BIOSOURCE, true)).toBe(1);
    expect(hiddenFreeTextValueCount(CELL_LINE, true)).toBe(2);
    // The GSE104849 header count: 5 chips across the three tags.
    expect(
      [SOURCE, BIOSOURCE, CELL_LINE].reduce(
        (n, vals) => n + hiddenFreeTextValueCount(vals, true),
        0,
      ),
    ).toBe(5);
  });

  it("counts every value when the whole tag goes", () => {
    const raw = [
      { label: "batch 3", uri: null },
      { label: "2019-05-15", uri: null },
    ];
    expect(hiddenFreeTextValueCount(raw, false)).toBe(2);
  });

  it("counts nothing for a tag a statement rescues", () => {
    const raw = [{ label: "ID3 overexpressing", uri: null }];
    expect(hiddenFreeTextValueCount(raw, true)).toBe(0);
  });

  it("counts nothing when every value resolves", () => {
    expect(
      hiddenFreeTextValueCount([{ label: "total RNA", uri: "http://x" }], true),
    ).toBe(0);
  });
});
