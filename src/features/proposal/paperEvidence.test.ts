import { describe, expect, it } from "vitest";
import { extractPaperMeta, pmidFromPaperSource } from "./paperEvidence";

const REAL_GEO_EXCERPT = `=== GEO Metadata: GSE45642 ===
Title: Circadian patterns of gene expression in the human brain and disruption in major depressive disorder [control set]
Type: Expression profiling by array
Organism(s): Homo sapiens
Platform(s): GPL17027 — [HG-U133A] Affymetrix Human Genome U133A Array [hgu133ahsentrezg.cdf] — [in situ oligonucleotide]
Sample count: 670
Linked PMID(s): 23671070

Summary: A cardinal symptom of Major Depressive Disorder (MDD) ...

--- Linked Publication ---
=== ABSTRACT ===
A cardinal symptom of major depressive disorder...
`;

describe("extractPaperMeta", () => {
  it("parses title, PMID from a real GEO excerpt", () => {
    const meta = extractPaperMeta(REAL_GEO_EXCERPT);
    expect(meta.title).toBe(
      "Circadian patterns of gene expression in the human brain and disruption in major depressive disorder",
    );
    expect(meta.pubmed_id).toBe("23671070");
    expect(meta.doi).toBeNull();
  });

  it("recognises a doi.org URL when present", () => {
    const excerpt = "Title: Foo\nDOI: https://doi.org/10.1234/abcd.5678";
    const meta = extractPaperMeta(excerpt);
    expect(meta.doi).toBe("10.1234/abcd.5678");
  });

  it("recognises a bare 10.xxxx/yyyy DOI when no URL form exists", () => {
    const excerpt = "Title: Foo\nReference: 10.1038/s41586-023-12345-x and friends";
    const meta = extractPaperMeta(excerpt);
    expect(meta.doi).toBe("10.1038/s41586-023-12345-x");
  });

  it("strips a trailing bracketed suffix from the title", () => {
    const excerpt = "Title: Some study [control set]";
    expect(extractPaperMeta(excerpt).title).toBe("Some study");
  });

  it("preserves a bracketed token when it's mid-title", () => {
    const excerpt = "Title: Study [revised] full data";
    // Mid-title brackets stay — only the trailing-bracket case is
    // GEO disambiguation we strip.
    expect(extractPaperMeta(excerpt).title).toBe("Study [revised] full data");
  });

  it("returns null fields for an empty excerpt", () => {
    expect(extractPaperMeta("")).toEqual({
      title: null,
      pubmed_id: null,
      doi: null,
    });
  });

  it("matches PMID via 'PubMed ID' alias", () => {
    const excerpt = "Title: Foo\nPubMed ID: 12345678";
    expect(extractPaperMeta(excerpt).pubmed_id).toBe("12345678");
  });
});

describe("pmidFromPaperSource", () => {
  it("returns the source when it parses as a numeric PMID", () => {
    expect(pmidFromPaperSource("12345678")).toBe("12345678");
  });

  it("returns null for provenance labels", () => {
    expect(pmidFromPaperSource("geo_linked_fulltext")).toBeNull();
    expect(pmidFromPaperSource("biolit")).toBeNull();
    expect(pmidFromPaperSource("")).toBeNull();
    expect(pmidFromPaperSource(null)).toBeNull();
  });
});
