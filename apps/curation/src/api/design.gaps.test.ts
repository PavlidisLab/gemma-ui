/**
 * Tests for design.ts helpers.
 *
 * NOTE — normaliseDesignForSave is NOT exported from design.ts (it is a
 * private helper called only inside useUpdateDesign's mutationFn). Per the
 * test-writing ground rules, we do not export it ourselves — that would be a
 * separate source refactor. The normaliseDesignForSave specs in the bucket
 * brief therefore cannot be exercised here without modifying the source.
 * Document the gap rather than silently omitting it:
 *
 *   TODO: export normaliseDesignForSave from design.ts (or move it to a
 *   separate normalise.ts module) so its flat-string-to-canonical coercion
 *   can be unit-tested directly. Until then, coverage comes from the
 *   end-to-end PUT path exercised against the mock server (integration
 *   tests, not yet written).
 *
 * Covered here: fillStatementCategoriesFromParent.
 */

import { describe, expect, it } from "vitest";
import { fillStatementCategoriesFromParent } from "./design";
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
