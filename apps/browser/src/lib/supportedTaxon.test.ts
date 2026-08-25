/**
 * The Platforms catalogue shows human, mouse and rat only.
 *
 * `/taxa` lists 48 — everything a sequence was ever imported against.
 * Only the three curated ones carry a `commonName`; the rest are
 * scientific names, and one of them is `Rattus rattus`, which is a
 * different animal from the `rat` this app means.
 */
import { describe, expect, it } from "vitest";
import { isSupportedTaxon } from "./gemmaConfig";

describe("isSupportedTaxon", () => {
  it("accepts the three curated taxa by id", () => {
    expect(isSupportedTaxon({ id: 1, scientificName: "Homo sapiens" })).toBe(true);
    expect(isSupportedTaxon({ id: 2, scientificName: "Mus musculus" })).toBe(true);
    expect(isSupportedTaxon({ id: 3, scientificName: "Rattus norvegicus" })).toBe(true);
  });

  it("rejects the rest of the corpus", () => {
    // Real ids and names from gemma2's /taxa.
    for (const t of [
      { id: 95, scientificName: "Danio rerio" },
      { id: 88, scientificName: "Saccharomyces cerevisiae" },
      { id: 86, scientificName: "synthetic construct" },
      { id: 128, scientificName: "Homo sapiens/Mus musculus xenograft" },
    ]) {
      expect(isSupportedTaxon(t)).toBe(false);
    }
  });

  it("does not mistake Rattus rattus for the rat", () => {
    // Id 79, one letter from Rattus norvegicus, and no commonName to
    // tell them apart — which is why this matches on id.
    expect(isSupportedTaxon({ id: 79, scientificName: "Rattus rattus" })).toBe(false);
    // Even with the id missing, the name fallback has to hold.
    expect(isSupportedTaxon({ scientificName: "Rattus rattus" })).toBe(false);
  });

  it("falls back to the scientific name when no id came down", () => {
    expect(isSupportedTaxon({ scientificName: "Mus musculus" })).toBe(true);
    expect(isSupportedTaxon({ scientificName: "Danio rerio" })).toBe(false);
  });

  it("treats a missing taxon as unsupported rather than throwing", () => {
    expect(isSupportedTaxon(null)).toBe(false);
    expect(isSupportedTaxon(undefined)).toBe(false);
    expect(isSupportedTaxon({})).toBe(false);
  });
});
