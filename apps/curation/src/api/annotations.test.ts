import { describe, expect, it } from "vitest";
import {
  orderCandidatesByTaxon,
  parseGemmaTerm,
  type AnnotationCandidate,
} from "./annotations";

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

describe("parseGemmaTerm", () => {
  const URI = "http://purl.obolibrary.org/obo/MONDO_0002679";
  // Post-client-snakeify shape of GemBro's /annotations/term response
  // (camelCase ``ontologyVersion`` / ``alternativeIds`` arrive as
  // snake_case). Wrapped in ``{data}`` to also exercise the envelope.
  const wire = {
    data: {
      uri: URI,
      label: "cerebral infarction",
      definition: "An ischemic condition of the brain.",
      obsolete: false,
      usage_count: 4,
      parents: [
        { uri: "http://purl.obolibrary.org/obo/MONDO_1060198", label: "ischemic stroke" },
        { uri: "http://purl.obolibrary.org/obo/MONDO_0005394", label: "brain infarction" },
      ],
      synonyms: [
        { value: "cerebral ischemia", type: "exact_synonym" },
        { value: "cerebral infarct", type: "exact_synonym" },
        // The primary label repeated as a synonym — should be dropped.
        { value: "cerebral infarction", type: "exact_synonym" },
      ],
      // Alternate/obsolete IDs of the SAME concept (same ontology).
      alternative_ids: ["MONDO:0001234"],
      // Cross-references to OTHER vocabularies (GemBro's dbXrefs field,
      // snakeified to db_xrefs).
      db_xrefs: ["DOID:3526", "ICD10CM:I63", "UMLS:C0007785"],
      ontology_version:
        "http://purl.obolibrary.org/obo/mondo/releases/2026-06-02/mondo.owl",
    },
  };

  it("maps parents to {uri,label} refs so they can be navigated", () => {
    const d = parseGemmaTerm(wire, URI)!;
    expect(d.parents).toEqual([
      { uri: "http://purl.obolibrary.org/obo/MONDO_1060198", label: "ischemic stroke" },
      { uri: "http://purl.obolibrary.org/obo/MONDO_0005394", label: "brain infarction" },
    ]);
  });

  it("keeps synonyms with scope but drops the one repeating the label", () => {
    const d = parseGemmaTerm(wire, URI)!;
    expect(d.synonyms).toEqual([
      { value: "cerebral ischemia", type: "exact_synonym" },
      { value: "cerebral infarct", type: "exact_synonym" },
    ]);
  });

  it("surfaces alternativeIds, dbXrefs (as xrefs), and ontologyVersion", () => {
    const d = parseGemmaTerm(wire, URI)!;
    expect(d.alternativeIds).toEqual(["MONDO:0001234"]);
    expect(d.xrefs).toEqual(["DOID:3526", "ICD10CM:I63", "UMLS:C0007785"]);
    expect(d.ontologyVersion).toBe(
      "http://purl.obolibrary.org/obo/mondo/releases/2026-06-02/mondo.owl",
    );
  });

  it("tolerates legacy bare-string parents + absent synonyms/version", () => {
    const d = parseGemmaTerm(
      { uri: URI, label: "x", definition: "d", parents: ["alpha", "beta"] },
      URI,
    )!;
    expect(d.parents).toEqual([
      { uri: null, label: "alpha" },
      { uri: null, label: "beta" },
    ]);
    expect(d.synonyms).toEqual([]);
    expect(d.alternativeIds).toEqual([]);
    expect(d.xrefs).toEqual([]);
    expect(d.ontologyVersion).toBeNull();
  });
});
