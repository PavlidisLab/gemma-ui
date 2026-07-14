import { describe, expect, it } from "vitest";
import {
  composeCurationDesign,
  type CurationProposalOverlay,
  type G2Design,
} from "./composeDesign";

/**
 * Regression for the sample-details factor bug (2026-06-03):
 *
 * When the canonical /design endpoint returns a dataset with zero
 * experimental_factors (the common case for an experiment that has a
 * pending agent proposal but hasn't had it committed yet),
 * composeCurationDesign used to drop the proposal's factors on the
 * floor because the overlay type only described per-FV metadata.
 * Sample-details rendered with no factor columns; design-setup tab
 * got factors via a separate adapter path → divergent views.
 *
 * After the fix, composeCurationDesign materialises factors from
 * ``overlay.design.proposed_factors`` whenever the canonical design
 * has none. Synthesised ids are negative so they don't collide with
 * real Gemma ids that arrive after the proposal is accepted.
 */

const G2_NO_FACTORS = {
  bio_material_assignments: [
    { bio_material_name: "GSEXX_bioMaterial_1|GSM001", factor_value_ids: null },
    { bio_material_name: "GSEXX_bioMaterial_2|GSM002", factor_value_ids: null },
    { bio_material_name: "GSEXX_bioMaterial_3|GSM003", factor_value_ids: null },
  ],
  biomaterials: [
    { short_name: "GSM001", characteristics: { treatment: "DMSO" } },
    { short_name: "GSM002", characteristics: { treatment: "UZH2" } },
    { short_name: "GSM003", characteristics: { treatment: "UZH2" } },
  ],
  experimental_factors: [],
  tags: [],
  // Mirrors the real /design wire payload (nullable factor_value_ids,
  // no bio_material_id on the assignment rows). Cast through unknown
  // so the fixture keeps that shape without the strict G2Design type
  // rejecting the wire-realistic nulls.
} as unknown as G2Design;

const OVERLAY_WITH_PROPOSED: CurationProposalOverlay = {
  design: {
    proposed_factors: [
      {
        category: "treatment",
        category_uri: "http://www.ebi.ac.uk/efo/EFO_0000727",
        factor_type: "categorical",
        factor_values: [
          {
            label: "Dimethyl sulfoxide",
            is_baseline: true,
            samples: ["GSM001"],
            statements: [
              {
                subject_label: "Dimethyl sulfoxide",
                subject_uri: "http://purl.obolibrary.org/obo/CHEBI_28262",
                object_label: "reference substance role",
                object_uri: "http://purl.obolibrary.org/obo/OBI_0000025",
              },
            ],
          },
          {
            label: "UZH2",
            is_baseline: false,
            samples: ["GSM002", "GSM003"],
            statements: [{ subject_label: "UZH2" }],
          },
        ],
      },
    ],
  },
};

describe("composeCurationDesign — materialise factors from proposal payload", () => {
  it("synthesises factors when the canonical design has none", () => {
    const design = composeCurationDesign(
      G2_NO_FACTORS,
      42,
      "GSE-test",
      OVERLAY_WITH_PROPOSED,
    );
    expect(design.factors).toHaveLength(1);
    const f = design.factors[0];
    expect(f.category.label).toBe("treatment");
    expect(f.type).toBe("categorical");
    expect(f.factor_values).toHaveLength(2);

    // Sample assignments survive — these drive the sample-details
    // factor columns + the design-setup "X samples assigned" count.
    const baseline = f.factor_values.find((fv) => fv.is_baseline);
    const compound = f.factor_values.find((fv) => !fv.is_baseline);
    expect(baseline?.biomaterial_short_names).toEqual(["GSM001"]);
    expect(compound?.biomaterial_short_names).toEqual(["GSM002", "GSM003"]);

    // Synthesised ids are negative so a later real-Gemma id (always
    // positive) on the same factor doesn't collide.
    expect(f.id).toBeLessThan(0);
    for (const fv of f.factor_values) {
      expect(fv.id).toBeLessThan(0);
    }
  });

  it("preserves statement grounding (CHEBI URI, reference-substance role)", () => {
    const design = composeCurationDesign(
      G2_NO_FACTORS,
      42,
      "GSE-test",
      OVERLAY_WITH_PROPOSED,
    );
    const baseline = design.factors[0].factor_values.find((fv) => fv.is_baseline);
    expect(baseline?.statements).toHaveLength(1);
    const s = baseline!.statements[0];
    expect(s.subject.label).toBe("Dimethyl sulfoxide");
    expect(s.subject.uri).toBe("http://purl.obolibrary.org/obo/CHEBI_28262");
    expect(s.object?.label).toBe("reference substance role");
  });

  it("does not synthesise when the canonical design already has factors", () => {
    const g2WithFactor = {
      ...G2_NO_FACTORS,
      experimental_factors: [
        {
          id: 999,
          name: "real-factor",
          category: { category: "treatment", category_uri: null },
          values: [{ id: 7777, value: "foo", summary: "foo", statements: [] }],
        },
      ],
      bio_material_assignments: [
        { bio_material_name: "GSEXX_bioMaterial_1|GSM001", factor_value_ids: [7777] },
      ],
    } as unknown as G2Design;
    const design = composeCurationDesign(
      g2WithFactor,
      42,
      "GSE-test",
      OVERLAY_WITH_PROPOSED,
    );
    expect(design.factors).toHaveLength(1);
    expect(design.factors[0].id).toBe(999);
    // The overlay's proposed_factors did NOT clobber the canonical
    // factor — overlay-materialise only fires when the canonical
    // side is empty.
  });

  it("returns empty factors when neither side has any", () => {
    const design = composeCurationDesign(G2_NO_FACTORS, 42, "GSE-test", null);
    expect(design.factors).toEqual([]);
  });
});
