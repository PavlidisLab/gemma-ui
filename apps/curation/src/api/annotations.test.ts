import { describe, expect, it } from "vitest";
import {
  dedupeCandidates,
  isSystematicName,
  normalizeSynonyms,
  orderCandidatesByTaxon,
  parseGemmaChildren,
  parseGemmaTerm,
  parseOlsSynonyms,
  type AnnotationCandidate,
} from "./annotations";

/**
 * Tests for orderCandidatesByTaxon — the in-memory clustering that keeps
 * same-symbol gene hits adjacent (human → mouse → rat → others) without
 * disturbing the backend's usage ranking for everything else.
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

describe("parseGemmaChildren", () => {
  it("maps Gemma's children list (value/valueUri) to {children, total}", () => {
    const payload = {
      data: [
        {
          value: "prefrontal cortex",
          valueUri: "http://purl.obolibrary.org/obo/UBERON_0000451",
        },
        {
          value: "gyrus",
          valueUri: "http://purl.obolibrary.org/obo/UBERON_0000200",
        },
      ],
    };
    const res = parseGemmaChildren(payload);
    expect(res).not.toBeNull();
    expect(res!.total).toBe(2);
    expect(res!.children).toEqual([
      { label: "prefrontal cortex", uri: "http://purl.obolibrary.org/obo/UBERON_0000451" },
      { label: "gyrus", uri: "http://purl.obolibrary.org/obo/UBERON_0000200" },
    ]);
  });

  it("tolerates the snake_case (value_uri) and bare-list shapes", () => {
    expect(
      parseGemmaChildren([
        { value: "gyrus", value_uri: "http://purl.obolibrary.org/obo/UBERON_0000200" },
      ]),
    ).toEqual({
      children: [
        { label: "gyrus", uri: "http://purl.obolibrary.org/obo/UBERON_0000200" },
      ],
      total: 1,
    });
  });

  it("reports a leaf (empty list) so the popover can label it, distinct from a failed lookup", () => {
    expect(parseGemmaChildren({ data: [] })).toEqual({ children: [], total: 0 });
    expect(parseGemmaChildren([])).toEqual({ children: [], total: 0 });
  });

  it("returns null when the payload isn't a list (error / unexpected shape)", () => {
    expect(parseGemmaChildren({ error: "boom" })).toBeNull();
    expect(parseGemmaChildren(null)).toBeNull();
    expect(parseGemmaChildren("nope")).toBeNull();
  });
});

describe("parseOlsSynonyms", () => {
  it("merges plain + obo_synonym, dedupes, and drops the label", () => {
    const syns = parseOlsSynonyms(
      {
        synonyms: ["oxymatrine", "Matrine oxide"],
        obo_synonym: [
          { name: "matrine oxide", scope: "hasExactSynonym" }, // dup of above (case)
          { name: "Sophocarpine N-oxide", scope: "hasRelatedSynonym" },
          { name: "Ammothamnine" }, // repeats the primary label — dropped
        ],
      },
      "Ammothamnine",
    );
    expect(syns.map((s) => s.value)).toEqual([
      "oxymatrine",
      "Matrine oxide",
      "Sophocarpine N-oxide",
    ]);
    expect(syns.find((s) => s.value === "Sophocarpine N-oxide")?.type).toBe(
      "hasRelatedSynonym",
    );
  });

  it("returns an empty list when the term ships no synonyms", () => {
    expect(parseOlsSynonyms({ label: "x" }, "x")).toEqual([]);
  });
});

describe("parseGemmaTerm — Cellosaurus sourceMetadata", () => {
  const URI = "https://www.cellosaurus.org/CVCL_0372";
  // Verbatim gemma2 /annotations/term response for KB (2026-08-12),
  // put through the client's snakeify the way a live call would be:
  // ``sourceMetadata`` → ``source_metadata``, ``cellLineType`` →
  // ``cell_line_type``, ``ncbiTaxonId`` → ``ncbi_taxon_id``.
  const wire = {
    data: {
      uri: URI,
      label: "KB",
      definition: "Part of: Cancer Dependency Map project.",
      obsolete: false,
      usage_count: 0,
      parents: [],
      synonyms: [],
      alternative_ids: [],
      db_xrefs: [],
      ontology_version: "56.0",
      source_metadata: {
        species: [{ ncbi_taxon_id: 9606, label: "Homo sapiens (Human)" }],
        cell_line_type: "Cancer cell line",
        sex: "Female",
        strain_type: null,
        problematic: "Contaminated",
      },
    },
  };

  it("reads the snakeified block the client actually delivers", () => {
    const d = parseGemmaTerm(wire, URI)!;
    expect(d.sourceMetadata).toEqual({
      species: [{ ncbiTaxonId: 9606, label: "Homo sapiens (Human)" }],
      cellLineType: "Cancer cell line",
      sex: "Female",
      strainType: null,
      problematic: "Contaminated",
    });
  });

  it("also tolerates the raw camelCase shape", () => {
    const d = parseGemmaTerm(
      {
        data: {
          uri: URI,
          label: "KB",
          sourceMetadata: {
            species: [{ ncbiTaxonId: 9606, label: "Homo sapiens (Human)" }],
            cellLineType: "Cancer cell line",
          },
        },
      },
      URI,
    )!;
    expect(d.sourceMetadata?.cellLineType).toBe("Cancer cell line");
    expect(d.sourceMetadata?.species?.[0].ncbiTaxonId).toBe(9606);
  });

  it("collapses an all-null block to null rather than an object of nulls", () => {
    const d = parseGemmaTerm(
      {
        data: {
          uri: "http://purl.obolibrary.org/obo/MONDO_0009693",
          label: "plasma cell myeloma",
          definition: "A neoplasm.",
          source_metadata: {
            species: null,
            cell_line_type: null,
            sex: null,
            strain_type: null,
            problematic: null,
          },
        },
      },
      "http://purl.obolibrary.org/obo/MONDO_0009693",
    )!;
    expect(d.sourceMetadata).toBeNull();
  });

  it("is null on an ordinary term that ships no block", () => {
    const d = parseGemmaTerm(wire, URI)!;
    expect(d.sourceMetadata).not.toBeNull();
    const plain = parseGemmaTerm(
      { data: { uri: URI, label: "x", definition: "y" } },
      URI,
    )!;
    expect(plain.sourceMetadata).toBeNull();
  });
});

/**
 * Gemma returns the same free-text value twice for some terms — seen
 * live 2026-08-16 on `129/Ola` under `strain`: one row
 * `{usageCount: 24, valueUri: ""}`, one `{usageCount: null,
 * valueUri: null}`, every other field identical. The picker rendered
 * both, so the dropdown offered a choice between a term and itself,
 * one labelled `×24` and one labelled `new`.
 */
describe("dedupeCandidates", () => {
  const row = (over: Partial<AnnotationCandidate> = {}): AnnotationCandidate => ({
    label: "129/Ola",
    uri: null,
    category_label: "strain",
    category_uri: "http://www.ebi.ac.uk/efo/EFO_0005135",
    usage_count: 0,
    taxon_id: null,
    taxon_common_name: null,
    taxon_scientific_name: null,
    example_usage: null,
    ...over,
  });

  it("collapses the empty-string and null URI spellings of one free-text value", () => {
    const out = dedupeCandidates([
      row({ uri: "", usage_count: 24 }),
      row({ uri: null }),
    ]);
    expect(out).toHaveLength(1);
    // The used row survives — its count is the signal the curator picks on.
    expect(out[0].usage_count).toBe(24);
  });

  it("keeps the richer row whichever order it arrives in", () => {
    const out = dedupeCandidates([row({ uri: null }), row({ uri: "", usage_count: 24 })]);
    expect(out).toHaveLength(1);
    expect(out[0].usage_count).toBe(24);
  });

  // 🛑 Two URIs is two terms, however alike the labels read.
  it("never merges rows that resolve to different URIs", () => {
    const out = dedupeCandidates([
      row({ uri: "http://www.ebi.ac.uk/efo/EFO_0000599" }),
      row({ uri: "http://purl.obolibrary.org/obo/CLO_0000021" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("preserves order and leaves a clean list alone", () => {
    const list = [row({ label: "a" }), row({ label: "b" }), row({ label: "c" })];
    expect(dedupeCandidates(list).map((c) => c.label)).toEqual(["a", "b", "c"]);
  });

  it("prefers the enriched row when usage counts tie", () => {
    const bare = row({ uri: null });
    const enriched = row({
      uri: null,
      example_usage: { experiment_short_name: "GSE1", kind: "factor_value" } as never,
    });
    expect(dedupeCandidates([bare, enriched])[0].example_usage).not.toBeNull();
  });
});

/**
 * Synonym ordering — the recognisable name has to survive the card's
 * character budget.
 *
 * The payloads here are verbatim from
 * ``gemma2/rest/v2/annotations/term`` and OLS4, fetched 2026-08-23.
 */
const PEVONEDISTAT_IUPAC =
  "[(1S,2S,4R)-4-{4-[(1S)-2,3-dihydro-1H-inden-1-ylamino]-7H-pyrrolo" +
  "[2,3-d]pyrimidin-7-yl}-2-hydroxycyclopentyl]methyl sulfamate";
const PEVONEDISTAT_IUPAC_ALT =
  "[(1S,2S,4R)-4-[4-[[(1S)-2,3-dihydro-1H-inden-1-yl]amino]pyrrolo" +
  "[2,3-d]pyrimidin-7-yl]-2-hydroxy-cyclopentyl]methyl sulfamate";

describe("normalizeSynonyms", () => {
  it("floats the recognisable names ahead of the nomenclature", () => {
    // Gemma's own order: the IUPAC name leads, MLN4924 is sixth.
    const out = normalizeSynonyms(
      [
        { value: PEVONEDISTAT_IUPAC, type: "exact_synonym" },
        { value: "pevonedistatum", type: "related_synonym" },
        { value: "pevonedistat", type: "related_synonym" },
        { value: "MLN-4924", type: "related_synonym" },
        { value: PEVONEDISTAT_IUPAC, type: "related_synonym" },
        { value: "MLN4924", type: "related_synonym" },
        { value: PEVONEDISTAT_IUPAC_ALT, type: "related_synonym" },
        { value: "MLN 4924", type: "related_synonym" },
      ],
      "pevonedistat",
    );
    expect(out.map((s) => s.value)).toEqual([
      // Source order inside the group — only the grouping is ours.
      "pevonedistatum",
      "MLN-4924",
      "MLN4924",
      "MLN 4924",
      PEVONEDISTAT_IUPAC,
      PEVONEDISTAT_IUPAC_ALT,
    ]);
    // The label repeat is gone, and so is the IUPAC name Gemma shipped
    // twice under two scopes — it was counted twice in the "(+N more)".
    expect(out).toHaveLength(6);
  });

  it("leaves a list with no systematic names in source order", () => {
    const out = normalizeSynonyms(
      [
        { value: "cerebral ischemia", type: "exact_synonym" },
        { value: "brain infarction", type: "exact_synonym" },
        { value: "cerebral infarct", type: "related_synonym" },
      ],
      "cerebral infarction",
    );
    expect(out.map((s) => s.value)).toEqual([
      "cerebral ischemia",
      "brain infarction",
      "cerebral infarct",
    ]);
  });

  it("keeps the scope of each surviving synonym", () => {
    const out = normalizeSynonyms(
      [
        { value: PEVONEDISTAT_IUPAC, type: "exact_synonym" },
        { value: "MLN4924", type: "related_synonym" },
      ],
      "pevonedistat",
    );
    expect(out.map((s) => s.type)).toEqual(["related_synonym", "exact_synonym"]);
  });
});

describe("isSystematicName", () => {
  it("catches substituent nomenclature", () => {
    expect(isSystematicName(PEVONEDISTAT_IUPAC)).toBe(true);
    expect(
      isSystematicName(
        "4-[(4-methylpiperazin-1-yl)methyl]-N-[4-methyl-3-[(4-pyridin-3-" +
          "ylpyrimidin-2-yl)amino]phenyl]benzamide",
      ),
    ).toBe(true);
    expect(
      isSystematicName("N-(2-chloroethyl)-N'-cyclohexyl-N-nitrosourea"),
    ).toBe(true);
  });

  it("leaves short names alone even when they carry the same shape", () => {
    // Length AND shape: these read fine and are what a curator says.
    expect(isSystematicName("MLN4924")).toBe(false);
    expect(isSystematicName("5-HT")).toBe(false);
    expect(isSystematicName("1,25-dihydroxyvitamin D3")).toBe(false);
    expect(isSystematicName("interleukin-1, beta")).toBe(false);
  });

  it("leaves a long ordinary name alone", () => {
    expect(
      isSystematicName("chronic obstructive pulmonary disease exacerbation"),
    ).toBe(false);
    expect(
      isSystematicName("acute myeloid leukemia with maturation (AML M2)"),
    ).toBe(false);
  });
});

describe("parseGemmaTerm / parseOlsSynonyms — both paths order alike", () => {
  const CHEBI = "http://purl.obolibrary.org/obo/CHEBI_145535";
  const gemma = parseGemmaTerm(
    {
      uri: CHEBI,
      label: "pevonedistat",
      definition: "A pyrrolopyrimidine …",
      parents: [],
      synonyms: [
        { value: PEVONEDISTAT_IUPAC, type: "exact_synonym" },
        { value: "MLN4924", type: "related_synonym" },
      ],
    },
    CHEBI,
  );
  const ols = parseOlsSynonyms(
    {
      synonyms: [PEVONEDISTAT_IUPAC, "MLN4924"],
      obo_synonym: [
        { name: PEVONEDISTAT_IUPAC, scope: "hasExactSynonym" },
        { name: "MLN4924", scope: "hasRelatedSynonym" },
      ],
    },
    "pevonedistat",
  );

  it("puts MLN4924 first from the Gemma payload", () => {
    expect(gemma?.synonyms.map((s) => s.value)).toEqual([
      "MLN4924",
      PEVONEDISTAT_IUPAC,
    ]);
  });

  it("puts MLN4924 first from the OLS side-fetch", () => {
    expect(ols.map((s) => s.value)).toEqual(["MLN4924", PEVONEDISTAT_IUPAC]);
  });
});
