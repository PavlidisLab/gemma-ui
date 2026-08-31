import { describe, expect, it } from "vitest";
import { stripObsoletePrefix } from "./ontologyTerm";

describe("stripObsoletePrefix", () => {
  it("drops EFO's underscore form — the case this exists for", () => {
    // `EFO_0000408` is a live Gemma annotation category published under
    // this spelling; measured on gemma2 2026-08-30 as the only one of
    // the 28 carrying the prefix.
    expect(stripObsoletePrefix("obsolete_disease")).toBe("disease");
  });

  it("drops CLO's space form", () => {
    expect(stripObsoletePrefix("obsolete immortal cat cell line cell")).toBe(
      "immortal cat cell line cell",
    );
  });

  it("leaves an ordinary label alone", () => {
    expect(stripObsoletePrefix("cell line")).toBe("cell line");
    expect(stripObsoletePrefix("disease model")).toBe("disease model");
  });

  it("🛑 only strips a LEADING prefix", () => {
    // A term whose own name contains the word keeps it — stripping mid
    // string would rename the term rather than drop a marker.
    expect(stripObsoletePrefix("marker of obsolete cell line")).toBe(
      "marker of obsolete cell line",
    );
  });

  it("does not eat a label that is only the marker", () => {
    // No captured remainder, so there is nothing to strip TO.
    expect(stripObsoletePrefix("obsolete")).toBe("obsolete");
  });

  it("is empty-safe for the `|| fallback` callers", () => {
    expect(stripObsoletePrefix(null)).toBe("");
    expect(stripObsoletePrefix(undefined)).toBe("");
    expect(stripObsoletePrefix("   ")).toBe("");
  });
});
