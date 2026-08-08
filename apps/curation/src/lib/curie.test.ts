import { describe, expect, it } from "vitest";
import {
  cellosaurusUrl,
  curieToUrl,
  isOlsHosted,
  olsUrl,
  termRegistry,
} from "./curie";

/**
 * Tests for curieToUrl() — the CURIE-to-clickable-URL router used by
 * every surface that renders ontology term chips, picker dropdowns, and
 * statement subject/object suffixes.
 *
 * Key invariant: NCBI gene CURIEs carry TWO colons (``NCBI:gene:948``)
 * and must route to the canonical NCBI Gene page. A naive single-colon
 * split would interpret ``NCBI`` as the prefix and ``gene:948`` as the
 * local id, producing a wrong OLS fallback URL.
 */
describe("curieToUrl", () => {
  it("routes NCBI gene CURIE (two-colon form) to the NCBI Gene page — NOT a generic obolibrary or OLS URL", () => {
    const result = curieToUrl("NCBI:gene:1234");
    expect(result).toBe("https://www.ncbi.nlm.nih.gov/gene/1234");
    // Sanity-check: a naive single-colon split would produce something
    // containing "gene:1234" as the local part — make sure we don't.
    expect(result).not.toContain("gene:1234");
    expect(result).not.toContain("obolibrary");
    expect(result).not.toContain("ols4");
  });

  it("routes generic OBO CURIE (single colon) to the correct obolibrary URL", () => {
    expect(curieToUrl("MONDO:0000001")).toBe(
      "http://purl.obolibrary.org/obo/MONDO_0000001",
    );
  });

  it("routes HP CURIE to obolibrary", () => {
    expect(curieToUrl("HP:0002511")).toBe(
      "http://purl.obolibrary.org/obo/HP_0002511",
    );
  });

  it("returns null for null input", () => {
    expect(curieToUrl(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(curieToUrl(undefined)).toBeNull();
  });

  it("returns null for empty string input", () => {
    expect(curieToUrl("")).toBeNull();
  });

  it("returns full URLs unchanged (no double-expansion)", () => {
    const url = "http://purl.obolibrary.org/obo/MONDO_0004975";
    expect(curieToUrl(url)).toBe(url);
  });

  it("handles ENSEMBL-style CURIE where local id contains letters+digits after the colon", () => {
    // ENSEMBL is not in the known prefix table — falls back to OLS search.
    const result = curieToUrl("ENSEMBL:ENSG00000123");
    expect(result).toBeTruthy();
    // Should NOT be null or the raw CURIE passed through as a relative link.
    expect(result).not.toBeNull();
    // The OLS fallback URL encodes the full CURIE in the query param.
    expect(result).toContain("ENSG00000123");
  });

  it("handles EFO CURIE correctly (known prefix with numeric local id)", () => {
    expect(curieToUrl("EFO:0000513")).toBe(
      "http://www.ebi.ac.uk/efo/EFO_0000513",
    );
  });

  it("rewrites a mis-namespaced obo-purl EFO full URL to EFO's canonical namespace (obo-purl does not host EFO → 404)", () => {
    // GSE87281: agent index emitted this form; "open in OBO" 404'd.
    expect(
      curieToUrl("http://purl.obolibrary.org/obo/EFO_0022874"),
    ).toBe("http://www.ebi.ac.uk/efo/EFO_0022874");
  });

  it("rewrites a mis-namespaced obo-purl TGEMO full URL to Gemma's ont namespace (TGEMO is Gemma's own ontology, not in OBO)", () => {
    // predicates.json ships TGEMO predicate URIs under the OBO purl.
    expect(
      curieToUrl("http://purl.obolibrary.org/obo/TGEMO_00171"),
    ).toBe("http://gemma.msl.ubc.ca/ont/TGEMO_00171");
  });

  it("repairs a double-mangled IRI: obo-purl prefix glued onto a full gemma IRI with the inner scheme collapsed to _//", () => {
    // The shipped TGEMO.tsv synonym snapshot emits Homozygous negative
    // as this butchered IRI; left as-is it 404s in "open in OBO" and
    // misses Gemma's IRI-keyed term endpoint ("Gemma doesn't know this
    // term"). Must recover the canonical Gemma IRI.
    expect(
      curieToUrl(
        "http://purl.obolibrary.org/obo/http_//gemma.msl.ubc.ca/ont/TGEMO_00001",
      ),
    ).toBe("http://gemma.msl.ubc.ca/ont/TGEMO_00001");
  });

  it("re-canonicalises the inner IRI after unmangling (double-mangled obo-purl EFO → EFO's ebi host)", () => {
    // Recursion through curieToUrl means the recovered inner IRI still
    // gets the single-mangle EFO/TGEMO namespace fix applied.
    expect(
      curieToUrl(
        "http://purl.obolibrary.org/obo/http_//purl.obolibrary.org/obo/EFO_0000513",
      ),
    ).toBe("http://www.ebi.ac.uk/efo/EFO_0000513");
  });
});

describe("cellosaurusUrl — cell lines only", () => {
  it("links a CVCL accession straight to its Cellosaurus page (any wrapping shape)", () => {
    for (const uri of [
      "cellosaurus:CVCL_0395",
      "CVCL_0395",
      "https://www.cellosaurus.org/CVCL_0395",
    ]) {
      expect(cellosaurusUrl(uri)).toBe("https://www.cellosaurus.org/CVCL_0395");
    }
  });

  it("drops the :SX sex-provenance suffix, keeping just the accession page", () => {
    expect(cellosaurusUrl("cellosaurus:CVCL_1045:SX")).toBe(
      "https://www.cellosaurus.org/CVCL_1045",
    );
  });

  it("falls back to a site name-search for a CLO cell line (no CVCL, but a label)", () => {
    // Gemma grounds cell lines to CLO, never CVCL — so the operative path
    // is a Cellosaurus SEARCH by the cell-line name.
    expect(
      cellosaurusUrl("http://purl.obolibrary.org/obo/CLO_0051454", "KGN"),
    ).toBe("https://www.cellosaurus.org/search?query=KGN");
  });

  it("returns null for a CLO term with no label (nothing to search by)", () => {
    expect(
      cellosaurusUrl("http://purl.obolibrary.org/obo/CLO_0051454"),
    ).toBeNull();
  });

  it("returns null for non-cell-line ontology terms (UBERON / CL / EFO)", () => {
    expect(
      cellosaurusUrl("http://purl.obolibrary.org/obo/UBERON_0018241", "prime adult stage"),
    ).toBeNull();
    // CL is a cell TYPE, not a cell line — no Cellosaurus link.
    expect(
      cellosaurusUrl("http://purl.obolibrary.org/obo/CL_0000056", "myoblast"),
    ).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(cellosaurusUrl(null)).toBeNull();
    expect(cellosaurusUrl(undefined)).toBeNull();
    expect(cellosaurusUrl("")).toBeNull();
  });
});

describe("olsUrl", () => {
  it("resolves a CURIE to its full IRI, then hands OLS an exact-match query", () => {
    expect(olsUrl("EFO:0000513")).toBe(
      "https://www.ebi.ac.uk/ols4/search?q=" +
        encodeURIComponent("http://www.ebi.ac.uk/efo/EFO_0000513") +
        "&exactMatch=true",
    );
  });

  it("returns null for empty input", () => {
    expect(olsUrl(null)).toBeNull();
    expect(olsUrl("")).toBeNull();
  });

  // OLS indexes the OBO Foundry set plus EFO. Offering it for anything
  // else only ever opens an empty result page.
  it("returns null for ontologies OLS does not index", () => {
    expect(olsUrl("TGEMO:00022")).toBeNull();
    expect(olsUrl("http://gemma.msl.ubc.ca/ont/TGEMO_00022")).toBeNull();
    expect(olsUrl("cellosaurus:CVCL_0395")).toBeNull();
    expect(olsUrl("CVCL_0395")).toBeNull();
    expect(olsUrl("MGI:97490")).toBeNull();
    expect(olsUrl("NCBI:gene:948")).toBeNull();
  });

  it("still resolves for OBO Foundry terms", () => {
    expect(olsUrl("CL:0000127")).toContain("ols4/search");
    expect(olsUrl("http://purl.obolibrary.org/obo/UBERON_0000955")).toContain(
      "ols4/search",
    );
  });
});

describe("termRegistry / isOlsHosted", () => {
  it("places OBO Foundry terms, by CURIE and by IRI", () => {
    expect(termRegistry("CL:0000127")).toBe("obo");
    expect(termRegistry("http://purl.obolibrary.org/obo/MONDO_0004975")).toBe(
      "obo",
    );
    expect(isOlsHosted("CHEBI:15377")).toBe(true);
  });

  it("places EFO on its own namespace but still inside OLS", () => {
    expect(termRegistry("EFO:0000513")).toBe("efo");
    // Mis-namespaced under the OBO purl upstream — curieToUrl rewrites
    // it to the canonical EFO namespace, so it must still classify efo.
    expect(termRegistry("http://purl.obolibrary.org/obo/EFO_0022874")).toBe(
      "efo",
    );
    expect(isOlsHosted("EFO:0000513")).toBe(true);
  });

  it("places TGEMO at Gemma, in neither OBO nor OLS", () => {
    expect(termRegistry("TGEMO:00022")).toBe("tgemo");
    expect(termRegistry("http://gemma.msl.ubc.ca/ont/TGEMO_00022")).toBe(
      "tgemo",
    );
    // Same mis-namespacing rewrite as EFO above.
    expect(termRegistry("http://purl.obolibrary.org/obo/TGEMO_00171")).toBe(
      "tgemo",
    );
    expect(isOlsHosted("TGEMO:00022")).toBe(false);
  });

  it("leaves Cellosaurus, MGI, NCBI genes and unknown prefixes unplaced", () => {
    expect(termRegistry("cellosaurus:CVCL_0395")).toBe("other");
    expect(termRegistry("MGI:97490")).toBe("other");
    expect(termRegistry("NCBI:gene:948")).toBe("other");
    expect(termRegistry("WHATEVER:123")).toBe("other");
    expect(termRegistry(null)).toBe("other");
    expect(isOlsHosted("MGI:97490")).toBe(false);
  });
});
