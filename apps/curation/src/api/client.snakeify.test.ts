import { describe, expect, it } from "vitest";
import { snakeify } from "./client";

describe("snakeify", () => {
  it("converts top-level camelCase keys to snake_case", () => {
    expect(snakeify({ firstName: "Alice", lastName: "Smith" })).toEqual({
      first_name: "Alice",
      last_name: "Smith",
    });
  });

  it("converts nested object camelCase keys recursively", () => {
    expect(
      snakeify({
        outerKey: {
          innerValue: 42,
          deepNested: { anotherKey: true },
        },
      }),
    ).toEqual({
      outer_key: {
        inner_value: 42,
        deep_nested: { another_key: true },
      },
    });
  });

  it("leaves keys that start with an uppercase letter untouched (prose keys)", () => {
    // Biomaterial.characteristics keys like "BioSource" must not be
    // mangled into "_bio_source".
    expect(snakeify({ BioSource: "skin", GeneticModification: "CRISPR" })).toEqual({
      BioSource: "skin",
      GeneticModification: "CRISPR",
    });
  });

  it("leaves keys that contain whitespace untouched (prose keys)", () => {
    // Characteristics keys like "cell type" must not be transformed.
    expect(snakeify({ "cell type": "fibroblast", "GEO Sample characteristic": "tissue" })).toEqual({
      "cell type": "fibroblast",
      "GEO Sample characteristic": "tissue",
    });
  });

  it("is idempotent on already-snake_case keys", () => {
    const input = { experiment_id: 1, target_type: "EXPRESSION_EXPERIMENT" };
    expect(snakeify(input)).toEqual(input);
  });

  it("handles arrays of objects — transforms keys inside each element", () => {
    expect(
      snakeify([
        { myField: "a", otherField: 1 },
        { myField: "b", otherField: 2 },
      ]),
    ).toEqual([
      { my_field: "a", other_field: 1 },
      { my_field: "b", other_field: 2 },
    ]);
  });

  it("handles arrays nested inside objects", () => {
    expect(
      snakeify({
        itemList: [{ displayName: "X" }, { displayName: "Y" }],
      }),
    ).toEqual({
      item_list: [{ display_name: "X" }, { display_name: "Y" }],
    });
  });

  it("passes primitives through unchanged", () => {
    expect(snakeify(42)).toBe(42);
    expect(snakeify("hello")).toBe("hello");
    expect(snakeify(true)).toBe(true);
  });

  it("passes null through unchanged", () => {
    expect(snakeify(null)).toBeNull();
  });

  it("regression: GEO characteristics dict with prose keys stays fully intact", () => {
    // Canonical regression from the CLAUDE.md / code comment:
    // biomaterial.characteristics surfaces user-facing strings as keys.
    // These must round-trip unchanged — no mangling to _bio_source or
    // _g_e_o_sample_characteristic.
    const characteristics = {
      BioSource: "skin",
      "cell type": "fibroblast",
      "tissue type": "dermis",
      "GEO Sample characteristic": "biopsy",
    };
    expect(snakeify(characteristics)).toEqual(characteristics);
  });

  it("regression: characteristics nested inside a biomaterial object", () => {
    // The prose keys live inside a nested value — the recursion must not
    // mangle them even when the parent key itself is camelCase.
    expect(
      snakeify({
        shortName: "GSM001",
        characteristics: {
          BioSource: "skin",
          "cell type": "fibroblast",
        },
      }),
    ).toEqual({
      short_name: "GSM001",
      characteristics: {
        BioSource: "skin",
        "cell type": "fibroblast",
      },
    });
  });
});

// Only VARIABLE names may be rewritten, never literals. The keys of a
// data-keyed map are data: renaming one changes what the curator sees.
// A shape heuristic can't decide this — it guessed wrong on `shRNA` and
// rewrote GSE121949's characteristic to `sh_r_n_a`.
describe("snakeify — keys of data-keyed maps are literals, not names", () => {
  it("leaves acronym characteristic keys alone", () => {
    const out = snakeify({
      characteristics: { shRNA: "shMETTl14", mRNA: "x", cDNA: "y" },
    }) as Record<string, Record<string, string>>;
    expect(Object.keys(out.characteristics).sort()).toEqual([
      "cDNA",
      "mRNA",
      "shRNA",
    ]);
  });

  it("leaves ANY characteristic key alone, whatever its shape", () => {
    const out = snakeify({
      characteristics: {
        shRNA: "a", BioSource: "b", "GEO Sample characteristic": "c",
        timePoint: "d", pH: "e", strain: "f",
      },
    }) as Record<string, Record<string, string>>;
    expect(Object.keys(out.characteristics).sort()).toEqual([
      "BioSource", "GEO Sample characteristic", "pH", "shRNA", "strain", "timePoint",
    ]);
  });

  it("protects the same key space on characteristic_uris, camel or snake", () => {
    const out = snakeify({
      characteristicUris: { shRNA: { categoryUri: "c", valueUri: "v" } },
    }) as Record<string, Record<string, Record<string, string>>>;
    // Outer key is data; INNER keys are field names and must convert.
    expect(Object.keys(out.characteristic_uris)).toEqual(["shRNA"]);
    expect(Object.keys(out.characteristic_uris.shRNA).sort()).toEqual([
      "category_uri",
      "value_uri",
    ]);
  });

  it("leaves geo_fields keys alone too", () => {
    const out = snakeify({
      geoFields: { treatment_protocol: "x", ch2_source_name: "y" },
    }) as Record<string, Record<string, string>>;
    expect(Object.keys(out.geo_fields).sort()).toEqual([
      "ch2_source_name",
      "treatment_protocol",
    ]);
  });

  it("🛑 normalizes a GEO sample's own fields but not the submitter's columns", () => {
    // Gemma's `sourceMetadata` document puts the per-sample GEO fields at
    // the TOP LEVEL of the sample object, where the store nested them
    // under `geo_fields` (whose children were therefore never touched).
    // So these DO convert — and the panels look them up by the snake
    // name because of it. `characteristics` is the only submitter-written
    // namespace in the document and stays verbatim: `shRNA` must not
    // become `sh_r_n_a` on a curator's screen.
    const out = snakeify({
      samples: [
        {
          accession: "GSM1",
          sourceName: "spleen",
          growthProtocol: "grown in RPMI",
          characteristicsUnparsed: ["age: 8w", "sex: F"],
          characteristics: { shRNA: "control", "Units of Amount": "ug" },
        },
      ],
    }) as { samples: Array<Record<string, unknown>> };
    const sample = out.samples[0];
    expect(Object.keys(sample).sort()).toEqual([
      "accession",
      "characteristics",
      "characteristics_unparsed",
      "growth_protocol",
      "source_name",
    ]);
    // The carve-out fires on the normalized key name at ANY depth, not
    // on a root-level path — which is why moving these from under
    // `geo_fields` to the sample object did not lose the protection.
    expect(
      Object.keys(sample.characteristics as Record<string, string>).sort(),
    ).toEqual(["Units of Amount", "shRNA"]);
    // Arrays survive as arrays; the popover renders them as a list
    // rather than a run-together string.
    expect(sample.characteristics_unparsed).toEqual(["age: 8w", "sex: F"]);
  });

  it("still converts real wire fields, which capitalise one letter per word", () => {
    const out = snakeify({
      experimentId: 1,
      bioAssayCount: 2,
      externalDatabaseUri: "u",
      overallDesign: "d",
    }) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual([
      "bio_assay_count",
      "experiment_id",
      "external_database_uri",
      "overall_design",
    ]);
  });
});
