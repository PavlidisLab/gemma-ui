import { describe, expect, it } from "vitest";
import { asFindingEvidence, mergeEvidence } from "./justification";

const NOTE = { source: "legacy_note", quote: "likely genetic background" };

describe("asFindingEvidence", () => {
  it("keeps an item carrying a quote, whatever its source", () => {
    expect(asFindingEvidence([NOTE])).toEqual([NOTE]);
  });

  it("is undefined for a bare string, null, and nothing renderable", () => {
    // A plain-text note is what the column held before it became JSON.
    expect(asFindingEvidence("likely genetic background")).toBeUndefined();
    expect(asFindingEvidence(null)).toBeUndefined();
    expect(asFindingEvidence([{ source: "paper" }, 3])).toBeUndefined();
  });
});

describe("mergeEvidence", () => {
  it("lists an item several samples carry once", () => {
    expect(mergeEvidence([[NOTE], [{ ...NOTE }], undefined])).toEqual([NOTE]);
  });

  it("keeps items that differ only in location apart", () => {
    const a = {
      source: "curator_ruling",
      quote: "strain is C57BL/6",
      location: "curator ruling, 2026-09-07",
    };
    const b = { ...a, location: "curator ruling, 2026-09-08" };
    expect(mergeEvidence([[a], [b]])).toEqual([a, b]);
  });

  it("is undefined when nothing is renderable", () => {
    expect(mergeEvidence([undefined, null, "x", []])).toBeUndefined();
  });
});
