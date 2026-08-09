/**
 * Tests for design.ts helpers.
 *
 * Covered here: fillStatementCategoriesFromParent, normaliseDesignForSave.
 *
 * ``normaliseDesignForSave`` is the last thing to touch a design before the
 * PUT and exists to stop a 422 on flat-shape tags leaking in from several
 * producers, so its coercions are pinned directly rather than inferred from
 * an end-to-end save.
 */

import { describe, expect, it } from "vitest";
import {
  fillStatementCategoriesFromParent,
  normaliseDesignForSave,
} from "./design";
import type { Design, Factor, Statement } from "@/features/experiment/types";

// ---------------------------------------------------------------------------
// Minimal fixture helpers
// ---------------------------------------------------------------------------

function makeDesign(factors: Factor[]): Design {
  return {
    experiment_id: 1,
    experiment_short_name: "GSE_TEST",
    factors,
    biomaterials: [],
    tags: [],
  };
}

function makeFactor(
  categoryLabel: string,
  statements: Statement[],
): Factor {
  return {
    id: 1,
    name: "test factor",
    category: { label: categoryLabel, uri: null },
    description: "",
    type: "categorical",
    factor_values: [
      {
        id: 10,
        free_text_label: "fv1",
        is_baseline: false,
        statements,
        biomaterial_short_names: [],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// fillStatementCategoriesFromParent
// ---------------------------------------------------------------------------

describe("fillStatementCategoriesFromParent", () => {
  it("inherits parent factor category onto a statement whose category is null", () => {
    const factor = makeFactor("disease", [
      {
        subject: { label: "Alzheimer disease", uri: "http://purl.obolibrary.org/obo/DOID_10652" },
        category: null,
      },
    ]);
    const result = fillStatementCategoriesFromParent(makeDesign([factor]));
    const s = result.factors[0].factor_values[0].statements[0];
    expect(s.category).toEqual({ label: "disease", uri: null });
  });

  it("inherits parent category when statement has no category field at all", () => {
    const factor = makeFactor("treatment", [
      {
        subject: { label: "DMSO", uri: null },
        // category deliberately omitted
      },
    ]);
    const result = fillStatementCategoriesFromParent(makeDesign([factor]));
    const s = result.factors[0].factor_values[0].statements[0];
    expect(s.category).toEqual({ label: "treatment", uri: null });
  });

  it("inherits parent category when statement category has an empty label", () => {
    // composeStatement hands back { label: "", uri: null } when the wire
    // payload carried no category. This test pins the 2026-06-11 fix:
    // an empty-label category must be treated the same as null/absent.
    const factor = makeFactor("genotype", [
      {
        subject: { label: "Abca4 KO", uri: null },
        category: { label: "", uri: null },
      },
    ]);
    const result = fillStatementCategoriesFromParent(makeDesign([factor]));
    const s = result.factors[0].factor_values[0].statements[0];
    expect(s.category).toEqual({ label: "genotype", uri: null });
  });

  it("treats whitespace-only label as empty and inherits the parent category", () => {
    const factor = makeFactor("sex", [
      {
        subject: { label: "female", uri: null },
        category: { label: "   ", uri: null },
      },
    ]);
    const result = fillStatementCategoriesFromParent(makeDesign([factor]));
    const s = result.factors[0].factor_values[0].statements[0];
    expect(s.category).toEqual({ label: "sex", uri: null });
  });

  it("does NOT overwrite a statement that already has an explicit category label", () => {
    const factor = makeFactor("treatment", [
      {
        subject: { label: "UZH2", uri: null },
        category: { label: "already set", uri: "http://example.org/MY_TERM" },
      },
    ]);
    const result = fillStatementCategoriesFromParent(makeDesign([factor]));
    const s = result.factors[0].factor_values[0].statements[0];
    // Must keep the statement's own category — parent category must NOT win.
    expect(s.category).toEqual({
      label: "already set",
      uri: "http://example.org/MY_TERM",
    });
  });

  it("is idempotent: running twice produces the same result", () => {
    const factor = makeFactor("disease", [
      {
        subject: { label: "HAND", uri: null },
        category: null,
      },
    ]);
    const once = fillStatementCategoriesFromParent(makeDesign([factor]));
    const twice = fillStatementCategoriesFromParent(once);
    expect(twice.factors[0].factor_values[0].statements[0].category).toEqual(
      once.factors[0].factor_values[0].statements[0].category,
    );
  });

  it("does not inherit when the parent factor itself has no category label", () => {
    // If neither the statement nor the parent factor has a category,
    // the statement stays as-is — no label to inherit.
    const factor: Factor = {
      id: 2,
      name: "unlabelled factor",
      category: { label: "", uri: null },
      description: "",
      type: "categorical",
      factor_values: [
        {
          id: 20,
          free_text_label: "fv",
          is_baseline: false,
          statements: [
            {
              subject: { label: "value", uri: null },
              category: null,
            },
          ],
          biomaterial_short_names: [],
        },
      ],
    };
    const result = fillStatementCategoriesFromParent(makeDesign([factor]));
    const s = result.factors[0].factor_values[0].statements[0];
    // category remains null — nothing to inherit from.
    expect(s.category).toBeNull();
  });

  it("handles multiple factors independently, each inheriting their own category", () => {
    const diseaseF = makeFactor("disease", [
      { subject: { label: "AD", uri: null }, category: null },
    ]);
    const treatmentF: Factor = {
      id: 3,
      name: "tx",
      category: { label: "treatment", uri: "http://www.ebi.ac.uk/efo/EFO_0000727" },
      description: "",
      type: "categorical",
      factor_values: [
        {
          id: 30,
          free_text_label: "DMSO",
          is_baseline: true,
          statements: [
            { subject: { label: "DMSO", uri: null }, category: { label: "", uri: null } },
          ],
          biomaterial_short_names: [],
        },
      ],
    };
    const result = fillStatementCategoriesFromParent(makeDesign([diseaseF, treatmentF]));
    const s0 = result.factors[0].factor_values[0].statements[0];
    const s1 = result.factors[1].factor_values[0].statements[0];
    expect(s0.category?.label).toBe("disease");
    expect(s1.category?.label).toBe("treatment");
    expect(s1.category?.uri).toBe("http://www.ebi.ac.uk/efo/EFO_0000727");
  });

  it("leaves factors (category / factor_values structure) otherwise untouched", () => {
    const factor = makeFactor("treatment", [
      {
        subject: { label: "drug A", uri: "http://purl.obolibrary.org/obo/CHEBI_1234" },
        predicate: { label: "has role", uri: "http://example.org/RO_0000087" },
        object: { label: "therapeutic role", uri: null },
        category: null,
      },
    ]);
    const result = fillStatementCategoriesFromParent(makeDesign([factor]));
    const s = result.factors[0].factor_values[0].statements[0];
    // Only category was filled; subject/predicate/object are untouched.
    expect(s.subject).toEqual({ label: "drug A", uri: "http://purl.obolibrary.org/obo/CHEBI_1234" });
    expect(s.predicate).toEqual({ label: "has role", uri: "http://example.org/RO_0000087" });
    expect(s.object).toEqual({ label: "therapeutic role", uri: null });
  });

  it("handles a design with no factors gracefully", () => {
    const result = fillStatementCategoriesFromParent(makeDesign([]));
    expect(result.factors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// normaliseDesignForSave — flat-shape tag coercion
//
// local_api validates every tag as ``{id, category: {label, uri}, value:
// {label, uri}}``. Several producers (AgentProposalTag pass-through,
// audit-side proposal-card flows) can drop a FLAT entry into ``design.tags``
// where category/value are plain strings and the URI sits in a sibling
// ``category_uri`` / ``value_uri`` field; the PUT then 422s. These pin the
// coercion so a producer change can't quietly reintroduce the 422.
// ---------------------------------------------------------------------------

/** Build a Design carrying deliberately loose tag rows. */
function designWithTags(tags: unknown[]): Design {
  return {
    experiment_id: 1,
    experiment_short_name: "GSE_TEST",
    factors: [],
    biomaterials: [],
    tags,
  } as unknown as Design;
}

describe("normaliseDesignForSave — flat-shape tags", () => {
  it("lifts flat string category/value plus sibling URIs into canonical terms", () => {
    const out = normaliseDesignForSave(
      designWithTags([
        {
          id: 4,
          category: "disease model",
          category_uri: "http://purl.obolibrary.org/obo/MONDO_0000001",
          value: "ischemic stroke",
          value_uri: "http://purl.obolibrary.org/obo/MONDO_0005098",
        },
      ]),
    );

    expect(out.tags[0].category).toEqual({
      label: "disease model",
      uri: "http://purl.obolibrary.org/obo/MONDO_0000001",
    });
    expect(out.tags[0].value).toEqual({
      label: "ischemic stroke",
      uri: "http://purl.obolibrary.org/obo/MONDO_0005098",
    });
  });

  it("uses a null URI when the flat shape carries no sibling URI", () => {
    const out = normaliseDesignForSave(
      designWithTags([{ id: 1, category: "treatment", value: "vehicle" }]),
    );

    expect(out.tags[0].category.uri).toBeNull();
    expect(out.tags[0].value.uri).toBeNull();
  });

  it("is idempotent — an already-canonical tag passes through unchanged", () => {
    const canonical = {
      id: 2,
      category: { label: "treatment", uri: "http://x/CHEBI_1" },
      value: { label: "cisplatin", uri: "http://x/CHEBI_2" },
      inferred: false,
      inferred_source: "",
      evidence_code: "IC",
    };
    const once = normaliseDesignForSave(designWithTags([canonical]));
    const twice = normaliseDesignForSave(once);

    expect(once.tags[0]).toEqual(twice.tags[0]);
    expect(once.tags[0].category).toEqual(canonical.category);
    expect(once.tags[0].value).toEqual(canonical.value);
  });

  it("coerces a missing/!object category or value to an empty term", () => {
    // Never emit ``undefined`` into the PUT body — local_api rejects it.
    const out = normaliseDesignForSave(designWithTags([{ id: 9 }]));

    expect(out.tags[0].category).toEqual({ label: "", uri: null });
    expect(out.tags[0].value).toEqual({ label: "", uri: null });
  });

  it("defaults evidence_code to IC and inferred to false", () => {
    const out = normaliseDesignForSave(
      designWithTags([{ id: 1, category: "a", value: "b" }]),
    );

    expect(out.tags[0].evidence_code).toBe("IC");
    expect(out.tags[0].inferred).toBe(false);
    expect(out.tags[0].inferred_source).toBe("");
  });

  it("preserves an explicit evidence_code and inferred flag", () => {
    const out = normaliseDesignForSave(
      designWithTags([
        {
          id: 1,
          category: "a",
          value: "b",
          inferred: true,
          inferred_source: "characteristic",
          evidence_code: "IEA",
        },
      ]),
    );

    expect(out.tags[0].evidence_code).toBe("IEA");
    expect(out.tags[0].inferred).toBe(true);
    expect(out.tags[0].inferred_source).toBe("characteristic");
  });
});

describe("normaliseDesignForSave — synthetic ids", () => {
  it("assigns an id to a tag that has none", () => {
    const out = normaliseDesignForSave(
      designWithTags([{ category: "a", value: "b" }]),
    );

    expect(typeof out.tags[0].id).toBe("number");
  });

  it("does not collide a synthetic id with an existing one", () => {
    const out = normaliseDesignForSave(
      designWithTags([
        { id: 1, category: "a", value: "b" },
        { category: "c", value: "d" },
        { id: 2, category: "e", value: "f" },
        { category: "g", value: "h" },
      ]),
    );

    const ids = out.tags.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The pre-existing ids are kept as-is.
    expect(ids).toContain(1);
    expect(ids).toContain(2);
  });
});

describe("normaliseDesignForSave — statements", () => {
  it("passes a populated statements array through verbatim", () => {
    const stmts = [
      {
        subject: { label: "cisplatin", uri: "http://x/CHEBI_2" },
        predicate: { label: "has dose", uri: null },
        object: { label: "10 mg/kg", uri: null },
      },
    ];
    const out = normaliseDesignForSave(
      designWithTags([{ id: 1, category: "a", value: "b", statements: stmts }]),
    );

    expect(out.tags[0].statements).toEqual(stmts);
  });

  it("drops an empty statements array to undefined so the read side rehydrates", () => {
    const out = normaliseDesignForSave(
      designWithTags([{ id: 1, category: "a", value: "b", statements: [] }]),
    );

    expect(out.tags[0].statements).toBeUndefined();
  });
});

describe("normaliseDesignForSave — non-tag fields", () => {
  it("leaves factors and biomaterials untouched", () => {
    const design = {
      experiment_id: 7,
      experiment_short_name: "GSE7",
      factors: [{ id: 1, category: { label: "disease", uri: null }, values: [] }],
      biomaterials: [{ short_name: "GSM1" }],
      tags: [],
    } as unknown as Design;

    const out = normaliseDesignForSave(design);

    expect(out.factors).toBe(design.factors);
    expect(out.biomaterials).toBe(design.biomaterials);
    expect(out.experiment_id).toBe(7);
  });

  it("tolerates a design with no tags array at all", () => {
    const out = normaliseDesignForSave({
      experiment_id: 1,
      experiment_short_name: "GSE1",
      factors: [],
      biomaterials: [],
    } as unknown as Design);

    expect(out.tags).toEqual([]);
  });
});
