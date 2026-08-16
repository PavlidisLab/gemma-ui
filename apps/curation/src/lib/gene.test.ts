import { describe, expect, it } from "vitest";
import {
  geneDisplayLabel,
  geneSpeciesNeedsCheck,
  geneSpeciesVerdict,
  isGeneUri,
  parseGeneLabel,
} from "./gene";

const HUMAN_ESR1 = "http://purl.org/commons/record/ncbi_gene/2099";

describe("isGeneUri", () => {
  it("recognizes the gene URI forms the wire actually carries", () => {
    expect(isGeneUri(HUMAN_ESR1)).toBe(true);
    expect(isGeneUri("NCBI:gene:2099")).toBe(true);
    expect(isGeneUri("ncbigene:2099")).toBe(true);
  });

  it("is false for an ontology term and for free text", () => {
    expect(isGeneUri("http://purl.obolibrary.org/obo/CL_0000127")).toBe(false);
    expect(isGeneUri(null)).toBe(false);
    expect(isGeneUri("")).toBe(false);
    // "ESR1" as an unresolved string is NOT a gene — gene-ness comes
    // from the URI, never the label.
    expect(isGeneUri("ESR1")).toBe(false);
  });
});

describe("parseGeneLabel", () => {
  it("splits Gemma's prior-usage form, species in brackets", () => {
    expect(parseGeneLabel("ESR1 [human] estrogen receptor 1")).toEqual({
      symbol: "ESR1",
      species: "human",
      fullName: "estrogen receptor 1",
    });
  });

  it("keeps parenthesised name detail out of the symbol", () => {
    expect(parseGeneLabel("Esr1 [mouse] estrogen receptor 1 (alpha)")).toEqual({
      symbol: "Esr1",
      species: "mouse",
      fullName: "estrogen receptor 1 (alpha)",
    });
  });

  it("handles the gene-catalogue form, which states no species", () => {
    expect(parseGeneLabel("Esr1 estrogen receptor 1")).toEqual({
      symbol: "Esr1",
      species: null,
      fullName: "estrogen receptor 1",
    });
  });

  it("handles the NCBI adapter's em-dash form", () => {
    expect(parseGeneLabel("ESR1 — estrogen receptor 1")).toEqual({
      symbol: "ESR1",
      species: null,
      fullName: "estrogen receptor 1",
    });
  });

  it("handles a bare symbol — how most stored bindings look", () => {
    expect(parseGeneLabel("ESR1")).toEqual({
      symbol: "ESR1",
      species: null,
      fullName: null,
    });
  });

  it("preserves symbol case, which is how species reads at a glance", () => {
    expect(parseGeneLabel("Trp53").symbol).toBe("Trp53");
    expect(parseGeneLabel("TP53").symbol).toBe("TP53");
  });

  it("yields a blank symbol on empty input so callers can fall back", () => {
    expect(parseGeneLabel("").symbol).toBe("");
    expect(parseGeneLabel(null).symbol).toBe("");
    expect(parseGeneLabel(undefined).symbol).toBe("");
  });
});

describe("geneSpeciesVerdict", () => {
  it("matches across the common/scientific name split", () => {
    expect(geneSpeciesVerdict("human", "human")).toBe("match");
    expect(geneSpeciesVerdict("Homo sapiens", "human")).toBe("match");
    expect(geneSpeciesVerdict("human", "Homo sapiens")).toBe("match");
  });

  it("calls a genuine cross-species binding a mismatch", () => {
    expect(geneSpeciesVerdict("mouse", "human")).toBe("mismatch");
    expect(geneSpeciesVerdict("Mus musculus", "human")).toBe("mismatch");
  });

  it("is unknown — not match — when the label states no species", () => {
    // The whole point: a binding nobody can verify must not read as a
    // verified one.
    expect(geneSpeciesVerdict(null, "human")).toBe("unknown");
    expect(geneSpeciesVerdict("  ", "human")).toBe("unknown");
  });

  it("is unchecked off an experiment page, where there is no dataset", () => {
    expect(geneSpeciesVerdict("human", null)).toBe("unchecked");
  });

  it("prefers unknown over unchecked when neither side is known", () => {
    expect(geneSpeciesVerdict(null, null)).toBe("unknown");
  });
});

describe("geneSpeciesNeedsCheck", () => {
  it("flags mismatch and unknown, and only those", () => {
    expect(geneSpeciesNeedsCheck("mismatch")).toBe(true);
    expect(geneSpeciesNeedsCheck("unknown")).toBe(true);
    expect(geneSpeciesNeedsCheck("match")).toBe(false);
    expect(geneSpeciesNeedsCheck("unchecked")).toBe(false);
  });
});

describe("geneDisplayLabel", () => {
  // The case Paul caught 2026-08-16: Gemma's composite label rendered
  // verbatim in a chip, wrapping over three lines where "Trp53" fits.
  const MOUSE_TRP53 = "http://purl.org/commons/record/ncbi_gene/22059";

  it("reduces Gemma's composite gene label to the symbol", () => {
    expect(
      geneDisplayLabel(
        "Trp53 [mouse] transformation related protein 53",
        MOUSE_TRP53,
      ),
    ).toBe("Trp53");
  });

  it("handles the other label shapes the wire carries", () => {
    expect(geneDisplayLabel("Esr1 estrogen receptor 1", HUMAN_ESR1)).toBe("Esr1");
    expect(geneDisplayLabel("ESR1 — estrogen receptor 1", HUMAN_ESR1)).toBe("ESR1");
    // Already short: unchanged, not re-parsed into something else.
    expect(geneDisplayLabel("ESR1", HUMAN_ESR1)).toBe("ESR1");
  });

  // Gene-ness comes from the URI, never the label — a bare "ESR1" as
  // free text is a curator's unresolved string, and a non-gene term
  // whose label happens to have several words must survive intact.
  it("leaves anything that is not a gene URI alone", () => {
    expect(geneDisplayLabel("ESR1", null)).toBe("ESR1");
    expect(
      geneDisplayLabel(
        "left occipital lobe",
        "http://purl.obolibrary.org/obo/UBERON_0002806",
      ),
    ).toBe("left occipital lobe");
    expect(geneDisplayLabel("transcription profiling by array assay", null)).toBe(
      "transcription profiling by array assay",
    );
  });

  it("is safe on empty input", () => {
    expect(geneDisplayLabel(null, MOUSE_TRP53)).toBe("");
    expect(geneDisplayLabel("", null)).toBe("");
    expect(geneDisplayLabel(undefined, undefined)).toBe("");
  });
});
