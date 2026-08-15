import { describe, expect, it } from "vitest";
import { parseGene } from "./genes";

/**
 * Shape captured from the live endpoint on 2026-08-14 —
 * ``GET /rest/v2/genes/2099`` — AFTER the API client has done its two
 * transformations: the pure ``{apiVersion, buildInfo, data}`` envelope
 * is unwrapped to the array, and every key is snakeified.
 *
 * Both of those bit on the way in. The first cut of this parser read
 * ``raw.data`` and ``officialSymbol`` and quietly returned null for
 * every gene, which surfaced as an amber "sp?" on a chip whose species
 * the catalogue had just answered — a lookup failure that looks exactly
 * like an unknown species.
 */
const LIVE_ESR1 = [
  {
    id: 43987,
    aliases: ["ER", "ESR", "ESRA", "ESTRR", "Era", "NR3A1"],
    associated_experiment_count: 28,
    ncbi_id: 2099,
    ensembl_id: "ENSG00000091831",
    official_name: "estrogen receptor 1",
    official_symbol: "ESR1",
    ncbi_uri: "http://purl.org/commons/record/ncbi_gene/2099",
    taxon: {
      id: 1,
      scientific_name: "Homo sapiens",
      common_name: "human",
      ncbi_id: 9606,
    },
  },
];

describe("parseGene", () => {
  it("reads the live, client-transformed response", () => {
    expect(parseGene(LIVE_ESR1, "2099")).toEqual({
      ncbiId: "2099",
      symbol: "ESR1",
      name: "estrogen receptor 1",
      taxonCommonName: "human",
      taxonScientificName: "Homo sapiens",
      aliases: ["ER", "ESR", "ESRA", "ESTRR", "Era", "NR3A1"],
    });
  });

  it("also reads the still-wrapped form, in case the unwrap rule shifts", () => {
    expect(parseGene({ data: LIVE_ESR1 }, "2099")?.taxonScientificName).toBe(
      "Homo sapiens",
    );
  });

  it("takes the first row when an id maps to several", () => {
    const second = { ...LIVE_ESR1[0], official_symbol: "OTHER" };
    expect(parseGene([LIVE_ESR1[0], second], "2099")?.symbol).toBe("ESR1");
  });

  it("is null on an empty result, so the caller falls back to the label", () => {
    expect(parseGene([], "2099")).toBeNull();
    expect(parseGene({ data: [] }, "2099")).toBeNull();
    expect(parseGene(null, "2099")).toBeNull();
    expect(parseGene({ error: { code: 404 } }, "2099")).toBeNull();
  });

  it("is null when a row carries no identity at all", () => {
    // Better to say "unknown" and flag it than to render a chip with a
    // blank species that reads as checked.
    expect(parseGene([{ id: 1, taxon: {} }], "2099")).toBeNull();
  });

  it("tolerates a missing taxon block without losing the symbol", () => {
    const g = parseGene([{ official_symbol: "ESR1" }], "2099");
    expect(g?.symbol).toBe("ESR1");
    expect(g?.taxonScientificName).toBeNull();
  });
});
