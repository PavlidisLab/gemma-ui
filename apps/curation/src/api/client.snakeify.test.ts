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
