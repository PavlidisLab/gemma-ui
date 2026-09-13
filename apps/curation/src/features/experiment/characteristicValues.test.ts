import { describe, expect, it } from "vitest";
import {
  buildCharEvidenceLookup,
  buildCharUriLookup,
  characteristicEvidence,
  characteristicValues,
} from "./characteristicValues";
import type { Biomaterial } from "./types";

/**
 * GSE43526.2 (experiment 8959) is the shape these pin: every one of its
 * 10 samples carries `molecular entity` TWICE — `polyA RNA extract`
 * (OBI_0000869) on all ten, and one of `Topotecan` / `Vehicle`, neither
 * of which has a URI. `characteristics` holds one string per category,
 * so the fold joins them; before the decomposition existed, the Tags row
 * showed two chips of the same truncated text both claiming
 * `OBI:0000869`.
 */
const OBI_POLYA = "http://purl.obolibrary.org/obo/OBI_0000869";
const OBI_CATEGORY = "http://purl.obolibrary.org/obo/OBI_0100026";

/** One 8959 sample: the doubled `molecular entity` plus an ordinary
 *  single-characteristic category beside it. */
function sample8959(shortName: string, treatment: string): Biomaterial {
  return {
    short_name: shortName,
    name: shortName,
    characteristics: {
      "molecular entity": `polyA RNA extract; ${treatment}`,
      "cell line": "MCF7 cell",
    },
    characteristic_uris: {
      // The fold keeps the FIRST characteristic's URIs here — this is
      // exactly the map that made both chips read OBI:0000869.
      "molecular entity": { category_uri: OBI_CATEGORY, value_uri: OBI_POLYA },
      "cell line": {
        category_uri: null,
        value_uri: "http://purl.obolibrary.org/obo/CLO_0007606",
      },
    },
    characteristic_value_uris: {
      "molecular entity": [
        { value: "polyA RNA extract", category_uri: OBI_CATEGORY, value_uri: OBI_POLYA },
        { value: treatment, category_uri: OBI_CATEGORY, value_uri: null },
      ],
      "cell line": [
        {
          value: "MCF7 cell",
          category_uri: null,
          value_uri: "http://purl.obolibrary.org/obo/CLO_0007606",
        },
      ],
    },
  };
}

describe("characteristicValues", () => {
  it("splits a doubled category into one entry per characteristic", () => {
    const vals = characteristicValues(sample8959("GSM1", "Topotecan")).filter(
      (v) => v.category === "molecular entity",
    );
    expect(vals.map((v) => v.label)).toEqual([
      "polyA RNA extract",
      "Topotecan",
    ]);
  });

  it("gives the URI to the value it belongs to, and to no other", () => {
    const vals = characteristicValues(sample8959("GSM1", "Topotecan"));
    const byLabel = new Map(vals.map((v) => [v.label, v]));
    expect(byLabel.get("polyA RNA extract")?.value_uri).toBe(OBI_POLYA);
    // The harm this fixes: `Topotecan` used to render `OBI:0000869`,
    // which names polyA RNA extract. It is free text.
    expect(byLabel.get("Topotecan")?.value_uri).toBeNull();
  });

  it("leaves a single-characteristic category exactly as it was", () => {
    const vals = characteristicValues(sample8959("GSM1", "Vehicle")).filter(
      (v) => v.category === "cell line",
    );
    expect(vals).toEqual([
      {
        category: "cell line",
        label: "MCF7 cell",
        category_uri: null,
        value_uri: "http://purl.obolibrary.org/obo/CLO_0007606",
      },
    ]);
  });

  it("reads a producer with no decomposition as one value per category", () => {
    // The local API's design projection and every fixture predating the
    // field. The joined string is the value; the category's URIs are
    // its URIs.
    const bm: Biomaterial = {
      short_name: "s1",
      name: "s1",
      characteristics: { "organism part": "hypothalamus" },
      characteristic_uris: {
        "organism part": {
          category_uri: null,
          value_uri: "http://purl.obolibrary.org/obo/UBERON_0001898",
        },
      },
    };
    expect(characteristicValues(bm)).toEqual([
      {
        category: "organism part",
        label: "hypothalamus",
        category_uri: null,
        value_uri: "http://purl.obolibrary.org/obo/UBERON_0001898",
      },
    ]);
  });

  it("never splits a submitter's own semicolon", () => {
    // `"; "` is this app's join convention, not the submitter's. With no
    // decomposition beside it, the string stays one annotation.
    const bm: Biomaterial = {
      short_name: "s1",
      name: "s1",
      characteristics: { treatment: "DMSO; 24h" },
    };
    expect(characteristicValues(bm).map((v) => v.label)).toEqual([
      "DMSO; 24h",
    ]);
  });

  it("falls back to the joined string when the decomposition is stale", () => {
    // `setBiomaterialCharacteristic` rewrites the value and updates
    // neither parallel map, so a curator's edit must not be replaced by
    // a decomposition of the text they overwrote.
    const bm: Biomaterial = {
      short_name: "s1",
      name: "s1",
      characteristics: { "molecular entity": "total RNA" },
      characteristic_uris: {
        "molecular entity": { category_uri: null, value_uri: OBI_POLYA },
      },
      characteristic_value_uris: {
        "molecular entity": [
          { value: "polyA RNA extract", category_uri: null, value_uri: OBI_POLYA },
          { value: "Topotecan", category_uri: null, value_uri: null },
        ],
      },
    };
    expect(characteristicValues(bm).map((v) => v.label)).toEqual(["total RNA"]);
  });

  it("skips empty categories and empty values", () => {
    const bm: Biomaterial = {
      short_name: "s1",
      name: "s1",
      characteristics: { "  ": "T cell", "cell type": "   " },
    };
    expect(characteristicValues(bm)).toEqual([]);
  });

  it("reads the decomposition beside a characteristic recorded with no value", () => {
    // The fold keeps a valueless characteristic as its own row and joins
    // nothing for it, so re-joining the rows must skip it too. Before,
    // this fell back to the category map, which holds the EMPTY row's
    // URIs because it came first.
    const CHEBI = "http://purl.obolibrary.org/obo/CHEBI_80630";
    const bm: Biomaterial = {
      short_name: "s1",
      name: "s1",
      characteristics: { treatment: "Topotecan" },
      characteristic_uris: { treatment: { category_uri: null, value_uri: null } },
      characteristic_value_uris: {
        treatment: [
          { value: "", category_uri: null, value_uri: null },
          { value: "Topotecan", category_uri: null, value_uri: CHEBI },
        ],
      },
    };
    expect(characteristicValues(bm)).toEqual([
      { category: "treatment", label: "Topotecan", category_uri: null, value_uri: CHEBI },
    ]);
  });
});

describe("characteristicEvidence", () => {
  const NOTE = { source: "legacy_note", quote: "likely genetic background" };

  function strainSample(value: string): Biomaterial {
    return {
      short_name: "s1",
      name: "s1",
      characteristics: { strain: value },
      characteristic_value_uris: {
        strain: [
          {
            value: "C57BL/6",
            category_uri: null,
            value_uri: null,
            supporting_evidence: [NOTE],
          },
        ],
      },
    };
  }

  it("returns the characteristic's own evidence", () => {
    expect(characteristicEvidence(strainSample("C57BL/6"), "strain")).toEqual([
      NOTE,
    ]);
  });

  it("returns nothing once a curator has typed over the value", () => {
    expect(characteristicEvidence(strainSample("BALB/c"), "strain")).toBeUndefined();
  });

  it("returns nothing for a category with no decomposition", () => {
    const bm: Biomaterial = {
      short_name: "s1",
      name: "s1",
      characteristics: { strain: "C57BL/6" },
    };
    expect(characteristicEvidence(bm, "strain")).toBeUndefined();
  });

  it("lists both characteristics' evidence under a shared category, each item once", () => {
    const other = { source: "inferred", quote: "treatment arm from the title" };
    const bm = sample8959("GSM1", "Topotecan");
    bm.characteristic_value_uris!["molecular entity"][0].supporting_evidence = [NOTE];
    bm.characteristic_value_uris!["molecular entity"][1].supporting_evidence = [
      NOTE,
      other,
    ];
    expect(characteristicEvidence(bm, "molecular entity")).toEqual([NOTE, other]);
    // And each value still carries only its own.
    expect(
      characteristicValues(bm).find((v) => v.label === "polyA RNA extract")
        ?.supporting_evidence,
    ).toEqual([NOTE]);
  });
});

describe("buildCharUriLookup", () => {
  const cohort = [
    sample8959("GSM1", "Topotecan"),
    sample8959("GSM2", "Vehicle"),
  ];

  it("keys per value, so only the grounded one resolves", () => {
    const lookup = buildCharUriLookup(cohort);
    expect(lookup.get("molecular entity|polya rna extract")).toBe(OBI_POLYA);
    expect(lookup.get("molecular entity|topotecan")).toBeUndefined();
    expect(lookup.get("molecular entity|vehicle")).toBeUndefined();
  });

  it("no longer keys the joined string, which no chip renders", () => {
    const lookup = buildCharUriLookup(cohort);
    expect(
      lookup.get("molecular entity|polya rna extract; topotecan"),
    ).toBeUndefined();
  });

  it("keys a single-characteristic category the way it always did", () => {
    const lookup = buildCharUriLookup(cohort);
    expect(lookup.get("cell line|mcf7 cell")).toBe(
      "http://purl.obolibrary.org/obo/CLO_0007606",
    );
  });
});

describe("buildCharEvidenceLookup", () => {
  const NOTE = { source: "legacy_note", quote: "likely genetic background" };

  it("keys per value and lists an item the cohort shares once", () => {
    const cohort = [
      sample8959("GSM1", "Topotecan"),
      sample8959("GSM2", "Vehicle"),
    ];
    for (const bm of cohort) {
      bm.characteristic_value_uris!["molecular entity"][1].supporting_evidence = [NOTE];
    }
    const lookup = buildCharEvidenceLookup(cohort);
    expect(lookup.get("molecular entity|topotecan")).toEqual([NOTE]);
    expect(lookup.get("molecular entity|vehicle")).toEqual([NOTE]);
    // The grounded value beside them carries none of its own.
    expect(lookup.has("molecular entity|polya rna extract")).toBe(false);
  });
});
