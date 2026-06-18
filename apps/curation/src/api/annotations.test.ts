import { describe, expect, it } from "vitest";
import { orderCandidatesByTaxon, type AnnotationCandidate } from "./annotations";

/**
 * Tests for orderCandidatesByTaxon — the in-memory clustering that keeps
 * same-symbol gene hits adjacent (human → mouse → rat → others) without
 * disturbing the backend's usage ranking for everything else.
 * UIB_HANDOFF_2026_06_18_ANNOTATION_SEARCH_GENE_TAXON, step 5.
 */
function gene(
  label: string,
  scientific: string,
  common: string,
  usage: number,
  id: number,
): AnnotationCandidate {
  return {
    label,
    uri: `NCBI:gene:${id}`,
    category_label: "gene",
    category_uri: null,
    usage_count: usage,
    taxon_id: id,
    taxon_common_name: common,
    taxon_scientific_name: scientific,
  };
}

function term(label: string, usage: number): AnnotationCandidate {
  return {
    label,
    uri: `EFO:${label}`,
    category_label: "disease",
    category_uri: null,
    usage_count: usage,
    taxon_id: null,
    taxon_common_name: null,
    taxon_scientific_name: null,
  };
}

describe("orderCandidatesByTaxon", () => {
  it("clusters same-symbol genes human → mouse → rat → other, regardless of input order", () => {
    const input = [
      gene("Kras", "Danio rerio", "zebrafish", 5, 30033),
      gene("KRAS", "Mus musculus", "mouse", 2, 16653),
      gene("KRAS", "Homo sapiens", "human", 9, 3845),
      gene("Kras", "Rattus norvegicus", "rat", 1, 24525),
    ];
    const out = orderCandidatesByTaxon(input);
    expect(out.map((c) => c.taxon_common_name)).toEqual([
      "human",
      "mouse",
      "rat",
      "zebrafish",
    ]);
  });

  it("orders by descending usage within the same species", () => {
    const input = [
      gene("FOO", "Homo sapiens", "human", 3, 1),
      gene("FOO", "Homo sapiens", "human", 8, 2),
    ];
    const out = orderCandidatesByTaxon(input);
    expect(out.map((c) => c.taxon_id)).toEqual([2, 1]);
  });

  it("preserves first-seen (usage-ranked) order across distinct labels", () => {
    const input = [
      term("liver", 100),
      gene("KRAS", "Mus musculus", "mouse", 2, 16653),
      gene("KRAS", "Homo sapiens", "human", 9, 3845),
      term("brain", 50),
    ];
    const out = orderCandidatesByTaxon(input);
    // liver group first (seen first), then the KRAS cluster (seen
    // second, clustered human→mouse), then brain.
    expect(out.map((c) => c.label)).toEqual([
      "liver",
      "KRAS",
      "KRAS",
      "brain",
    ]);
    expect(out[1].taxon_common_name).toBe("human");
    expect(out[2].taxon_common_name).toBe("mouse");
  });

  it("leaves a list with no repeated labels untouched", () => {
    const input = [term("liver", 100), term("brain", 50), term("lung", 10)];
    const out = orderCandidatesByTaxon(input);
    expect(out.map((c) => c.label)).toEqual(["liver", "brain", "lung"]);
  });
});
