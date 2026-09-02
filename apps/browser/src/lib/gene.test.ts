/**
 * Gene chips show the symbol.
 *
 * Labels taken from real annotation payloads — dataset 27773 carries
 * "Tardbp [mouse] TAR DNA binding protein" twice under TREATMENT,
 * which is what prompted this.
 */
import { describe, expect, it } from "vitest";
import { geneDisplayLabel, isGeneUri, parseGeneLabel } from "./gene";

const GENE_URI = "http://purl.org/commons/record/ncbi_gene/230908";

describe("isGeneUri — decided by the URI, never the label", () => {
  it("recognises an ncbi_gene record URI", () => {
    expect(isGeneUri(GENE_URI)).toBe(true);
  });

  it("rejects an ontology term, a null and an empty string", () => {
    expect(isGeneUri("http://purl.obolibrary.org/obo/UBERON_0000956")).toBe(false);
    expect(isGeneUri(null)).toBe(false);
    expect(isGeneUri("")).toBe(false);
  });
});

describe("parseGeneLabel", () => {
  it("splits the bracketed-species form", () => {
    expect(parseGeneLabel("Tardbp [mouse] TAR DNA binding protein")).toEqual({
      symbol: "Tardbp",
      species: "mouse",
      fullName: "TAR DNA binding protein",
    });
  });

  it("splits the catalogue form with no species", () => {
    expect(parseGeneLabel("Esr1 estrogen receptor 1")).toEqual({
      symbol: "Esr1",
      species: null,
      fullName: "estrogen receptor 1",
    });
  });

  it("drops an em-dash separator from the name", () => {
    expect(parseGeneLabel("ESR1 — estrogen receptor 1").fullName).toBe(
      "estrogen receptor 1",
    );
  });

  it("treats a symbol-only label as all symbol", () => {
    expect(parseGeneLabel("ESR1")).toEqual({
      symbol: "ESR1",
      species: null,
      fullName: null,
    });
  });

  it("preserves case — human upper, mouse title", () => {
    expect(parseGeneLabel("Tardbp [mouse] x").symbol).toBe("Tardbp");
    expect(parseGeneLabel("TARDBP [human] x").symbol).toBe("TARDBP");
  });

  it("yields a blank symbol for a blank label", () => {
    expect(parseGeneLabel("").symbol).toBe("");
    expect(parseGeneLabel(null).symbol).toBe("");
  });
});

describe("geneDisplayLabel", () => {
  it("shortens a gene to its symbol", () => {
    expect(
      geneDisplayLabel("Tardbp [mouse] TAR DNA binding protein", GENE_URI),
    ).toBe("Tardbp");
  });

  it("leaves a non-gene term untouched", () => {
    expect(
      geneDisplayLabel(
        "cerebral cortex",
        "http://purl.obolibrary.org/obo/UBERON_0000956",
      ),
    ).toBe("cerebral cortex");
  });

  it("leaves an ungrounded free-text label untouched", () => {
    // "ESR1" written as free text is an unresolved string, not a
    // gene — shortening it would assert something we don't know.
    expect(geneDisplayLabel("ESR1 estrogen receptor 1", null)).toBe(
      "ESR1 estrogen receptor 1",
    );
  });

  it("falls back to the given label when the parse yields nothing", () => {
    expect(geneDisplayLabel("", GENE_URI)).toBe("");
  });
});
