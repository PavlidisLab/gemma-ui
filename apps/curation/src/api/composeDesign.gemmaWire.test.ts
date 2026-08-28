/**
 * The composed design against bytes gemma2 actually sends.
 *
 * Every other test of this adapter feeds it a hand-written fixture, so
 * it can only confirm the adapter agrees with itself. This one takes a
 * verbatim `GET /rest/v2/datasets/1658/design` response — camelCase, as
 * Gemma serializes it — pushes it through `snakeify` (the real client
 * boundary) and composes. A shape drift on Gemma's side shows up here as
 * a failing assertion rather than as a blank panel in remote mode.
 *
 * Captured 2026-08-28 from gemma2 build `c974a98fab`, trimmed to one
 * factor, two of its values and two sample assignments. Nothing is
 * renamed or filled in.
 *
 * 🛑 Two fields the payload does NOT carry are pinned at the bottom.
 * They are the reason this file exists: an absent field arrives as
 * `undefined`, which no type in this repo describes and no typechecker
 * can catch — the same shape as the taxon defect that crashed the
 * catalogue search.
 */
import { describe, expect, it } from "vitest";
import { snakeify } from "./client";
import { composeCurationDesign, type G2Design } from "./composeDesign";

/** Verbatim from the wire. Do not tidy the casing — the point is that
 *  `snakeify` is what converts it, exactly as it does at runtime. */
const GEMMA_DESIGN_WIRE = {
  id: 1928,
  name: "",
  description: " Overall design: Expression profiling by array",
  experimentalFactors: [
    {
      id: 11727,
      name: "Treatment",
      description: "control, hypochlorous acid [0.4 mM, 1 mM, 4 mM]",
      type: "categorical",
      category: {
        id: 7711036,
        category: "treatment",
        categoryUri: "http://www.ebi.ac.uk/efo/EFO_0000727",
        value: "treatment",
        valueUri: "http://www.ebi.ac.uk/efo/EFO_0000727",
      },
      values: [
        {
          id: 77276,
          ontologyId: "http://gemma.msl.ubc.ca/ont/TGFVO/77276",
          value: null,
          summary: "reference substance role",
          isMeasurement: false,
          characteristics: [
            {
              id: 30045176,
              category: "treatment",
              categoryUri: "http://www.ebi.ac.uk/efo/EFO_0000727",
              valueId: "http://gemma.msl.ubc.ca/ont/TGFVO/77276/1",
              value: "reference substance role",
              valueUri: "http://purl.obolibrary.org/obo/OBI_0000025",
            },
          ],
          statements: [],
        },
        {
          id: 77277,
          ontologyId: "http://gemma.msl.ubc.ca/ont/TGFVO/77277",
          value: null,
          summary: "hypochlorous acid delivered at dose 0.4 mM",
          isMeasurement: false,
          characteristics: [
            {
              id: 30133596,
              category: "treatment",
              categoryUri: "http://www.ebi.ac.uk/efo/EFO_0000727",
              valueId: "http://gemma.msl.ubc.ca/ont/TGFVO/77277/1",
              value: "hypochlorous acid",
              valueUri: "http://purl.obolibrary.org/obo/CHEBI_24757",
            },
          ],
          statements: [
            {
              id: 30133596,
              category: "treatment",
              categoryUri: "http://www.ebi.ac.uk/efo/EFO_0000727",
              subjectId: "http://gemma.msl.ubc.ca/ont/TGFVO/77277/1",
              subject: "hypochlorous acid",
              subjectUri: "http://purl.obolibrary.org/obo/CHEBI_24757",
              predicate: "delivered at dose",
              predicateUri: "http://gemma.msl.ubc.ca/ont/TGEMO_00166",
              objectId: "http://gemma.msl.ubc.ca/ont/TGFVO/77277/2",
              object: "0.4 mM",
              objectUri: null,
            },
          ],
        },
      ],
    },
  ],
  bioMaterialAssignments: [
    {
      bioMaterialId: 55687,
      bioMaterialName: "GSE11630_Biomat_12|GSM292815",
      factorValueIds: [77276],
    },
    {
      bioMaterialId: 55688,
      bioMaterialName: "GSE11630_Biomat_13|GSM292816",
      factorValueIds: [77277],
    },
  ],
};

/** The dataset row, also verbatim — the taxon nested, the way Gemma
 *  sends it and no `taxonCommonName` anywhere. */
const GEMMA_DATASET_WIRE = {
  id: 1658,
  shortName: "GSE11630",
  name: "Neutrophil response to hypochlorous acid",
  accession: "GSE11630",
  externalDatabase: "GEO",
  technologyType: "ONECOLOR",
  taxon: {
    id: 1,
    scientificName: "Homo sapiens",
    commonName: "human",
    ncbiId: 9606,
  },
};

function compose() {
  return composeCurationDesign(
    snakeify(GEMMA_DESIGN_WIRE) as G2Design,
    1658,
    "GSE11630",
    null,
    null,
    snakeify(GEMMA_DATASET_WIRE) as Parameters<typeof composeCurationDesign>[5],
  );
}

describe("composeCurationDesign — real gemma2 bytes", () => {
  it("composes the factor with its name, type and grounded category", () => {
    const [f] = compose().factors;
    expect(f.name).toBe("Treatment");
    expect(f.type).toBe("categorical");
    expect(f.category.label).toBe("treatment");
    expect(f.category.uri).toBe("http://www.ebi.ac.uk/efo/EFO_0000727");
  });

  it("composes both factor values, labelled from the summary", () => {
    const [f] = compose().factors;
    expect(f.factor_values.map((v) => v.id)).toEqual([77276, 77277]);
    expect(f.factor_values.map((v) => v.free_text_label)).toEqual([
      "reference substance role",
      "hypochlorous acid delivered at dose 0.4 mM",
    ]);
  });

  it("composes the S-P-O statement with its URIs intact", () => {
    const [f] = compose().factors;
    const [s] = f.factor_values[1].statements;
    expect(s.subject?.label).toBe("hypochlorous acid");
    expect(s.subject?.uri).toBe("http://purl.obolibrary.org/obo/CHEBI_24757");
    expect(s.predicate?.label).toBe("delivered at dose");
    expect(s.predicate?.uri).toBe("http://gemma.msl.ubc.ca/ont/TGEMO_00166");
    expect(s.object?.label).toBe("0.4 mM");
    // Free text on the object side — a dose is not an ontology term.
    expect(s.object?.uri).toBeNull();
  });

  it("binds samples to values, GEO short name split off the biomaterial", () => {
    const [f] = compose().factors;
    expect(f.factor_values[0].biomaterial_short_names).toEqual(["GSM292815"]);
    expect(f.factor_values[1].biomaterial_short_names).toEqual(["GSM292816"]);
  });

  it("reads the taxon out of the nested object", () => {
    // The flat `taxonCommonName` this used to read is not on the wire.
    expect("taxonCommonName" in GEMMA_DATASET_WIRE).toBe(false);
    expect(compose().taxon).toBe("human");
  });
});

describe("what gemma2's design read does NOT carry", () => {
  /**
   * Measured across 26 datasets (ee 1658, 3333, 19536, 24976, 50540,
   * 91442 plus 20 sampled at offset 400): `isBaseline` appears on
   * **0 of 309 factor values**. The key is absent, not false.
   *
   * 🛑 This is SETTLED, not a wire question — do not re-file it. The
   * field is mapped and serialized (`AbstractFactorValueValueObject`,
   * `@JsonInclude(NON_NULL)`); the key is missing because the value is
   * null, and it is null because no writer in Gemma has ever set true —
   * production measured 153,448 null, 41,556 zero, 0 ones. A serialization
   * gap was diagnosed here twice and was wrong both times.
   *
   * ⇒ **An absent key means "nobody has said", never "not the
   * baseline"**, and it will mean that for most factor values for a long
   * time. The card still shows Gemma's own detection (hollow, via
   * `gemmaAutoDetectsBaseline`) rather than nothing. Pinned so the day
   * real flags start arriving, this test says so — the store's
   * substring guess has to stop firing at that moment or it ORs itself
   * onto the real flag.
   */
  it("no isBaseline on any factor value", () => {
    const wireFvs = GEMMA_DESIGN_WIRE.experimentalFactors.flatMap(
      (f) => f.values,
    );
    expect(wireFvs.every((v) => !("isBaseline" in v))).toBe(true);
    const composed = compose().factors.flatMap((f) => f.factor_values);
    expect(composed.every((v) => v.is_baseline === false)).toBe(true);
  });

  /**
   * 🛑 No `gemmaFactorId` either, and this one must NOT be papered over.
   * On Gemma the `id` beside it IS the factor's real identity; in the
   * curation store the same `id` is a per-row sequence number, and
   * trusting it there bound one design's levels to another's factor —
   * it resolved, which is worse than dangling. So the correct value
   * depends on which producer sent the payload, and the adapter cannot
   * tell from the payload alone. It stays null rather than guessing.
   *
   * This is the same identity gap that blocks retiring `PUT /design`.
   * Nothing to file: the id IS on the wire, and which producer sent the
   * payload is the thing the adapter lacks, not a missing Gemma field.
   */
  it("no gemmaFactorId — identity stays null rather than guessed from id", () => {
    const [wf] = GEMMA_DESIGN_WIRE.experimentalFactors;
    expect("gemmaFactorId" in wf).toBe(false);
    const [f] = compose().factors;
    expect(f.gemma_factor_id).toBeNull();
    // The row id is present and is NOT copied into the identity slot.
    expect(f.id).toBe(11727);
  });
});
