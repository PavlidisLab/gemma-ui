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

/**
 * The carry-through regression (2026-08-20, cab's handoff
 * SUBSET_RECOMMENDATIONS_UI_2026_08_20.md).
 *
 * composeCurationDesign rebuilt the Design from a literal of named
 * keys, so any field nobody remembered to list was dropped between the
 * store and every consumer. It ate `publications` (2026-06-11),
 * `gold_data_version` (2026-08-17), and `subset_recommendations` from
 * the day that field existed: 69 of 500 experiments carry a
 * Gemma-seeded recommendation and the design tab said "None recorded"
 * for all of them.
 *
 * These pin the FIX rather than the three symptoms — the return
 * carries the object now, so the assertion that matters is that a
 * field this adapter has never heard of survives the trip.
 */
describe("composeCurationDesign — carries the whole design object", () => {
  const withDownstream = {
    experimental_factors: [],
    bio_material_assignments: [],
    subset_recommendations: [
      {
        id: "gemma-subset-organism-part",
        by_factor_id: 1,
        gemma_factor_id: 23079,
        level_labels: ["Ammon's horn", "frontal cortex"],
        rationale: "Gemma already subsets the DEA on `organism part`.",
        status: "agent_recommended",
        source: "gemma",
      },
    ],
    should_split_on_factor_id: -1,
    should_split_rationale: "one arm",
  } as unknown as G2Design;

  it("keeps subset_recommendations", () => {
    const d = composeCurationDesign(withDownstream, 18392, "GSE74438", null);
    expect(d.subset_recommendations).toHaveLength(1);
    expect(d.subset_recommendations?.[0].source).toBe("gemma");
    expect(d.subset_recommendations?.[0].gemma_factor_id).toBe(23079);
  });

  it("keeps both split fields", () => {
    const d = composeCurationDesign(withDownstream, 18392, "GSE74438", null);
    expect(d.should_split_on_factor_id).toBe(-1);
    expect(d.should_split_rationale).toBe("one arm");
  });

  it("keeps a field this adapter has never been taught about", () => {
    // The actual contract. If someone reintroduces a named-key literal
    // this fails, whatever the field of the week happens to be.
    const g2 = {
      ...withDownstream,
      some_field_added_next_quarter: "survives",
    } as unknown as G2Design;
    const d = composeCurationDesign(g2, 18392, "GSE74438", null);
    expect(
      (d as unknown as Record<string, unknown>).some_field_added_next_quarter,
    ).toBe(
      "survives",
    );
  });

  it("drops the wire-only shapes it re-derives", () => {
    // `experimental_factors` / `bio_material_assignments` are recomposed
    // into `factors` / `biomaterials`; carrying them too would put a
    // stale second copy of the design in every PUT body.
    const d = composeCurationDesign(withDownstream, 18392, "GSE74438", null);
    const raw = d as unknown as Record<string, unknown>;
    expect(raw.experimental_factors).toBeUndefined();
    expect(raw.bio_material_assignments).toBeUndefined();
    expect(raw.id).toBeUndefined();
    expect(raw.name).toBeUndefined();
  });
});

/**
 * Factor identity, the same drop one level down (2026-08-20).
 *
 * `composeFactor` builds from the `experimental_factors[]` projection,
 * which carries only the local row id. `gemmaFactorId` /
 * `localFactorId` live on the server's own `factors[]` array — so every
 * composed factor came back with `gemma_factor_id` undefined and any
 * consumer asking "is this still the factor Gemma meant" had nothing
 * but the per-row sequence number, which is the id that bound one
 * design's organism-part levels to another's genotype factor.
 */
describe("composeCurationDesign — factor identity", () => {
  // GSE74438's real shape: two Gemma-known factors and one
  // curator-added factor with a local id and no Gemma id.
  const g2 = {
    experimental_factors: [
      {
        id: 1,
        name: "organism part",
        category: { category: "organism part", category_uri: null },
        values: [],
      },
      {
        id: 3,
        name: "genetic manipulation",
        category: { category: "genotype", category_uri: null },
        values: [],
      },
    ],
    bio_material_assignments: [],
    factors: [
      { id: 1, gemma_factor_id: 36160, local_factor_id: null },
      { id: 3, gemma_factor_id: null, local_factor_id: "local-8f7f40227569" },
    ],
  } as unknown as G2Design;

  it("carries gemma_factor_id from the factors array onto the composed factor", () => {
    const d = composeCurationDesign(g2, 18392, "GSE74438", null);
    expect(d.factors.map((f) => f.gemma_factor_id)).toEqual([36160, null]);
  });

  it("carries local_factor_id for factors Gemma has never seen", () => {
    const d = composeCurationDesign(g2, 18392, "GSE74438", null);
    expect(d.factors[1].local_factor_id).toBe("local-8f7f40227569");
  });

  it("still composes when the server sends no factors array", () => {
    // Neither shape carries identity here, so the answer is a definite
    // `null` rather than `undefined` — the ladder normalizes, and the
    // fold's "this design knows no Gemma ids" guard reads both the
    // same way.
    const bare = { ...g2, factors: undefined } as unknown as G2Design;
    const d = composeCurationDesign(bare, 18392, "GSE74438", null);
    expect(d.factors).toHaveLength(2);
    expect(d.factors[0].gemma_factor_id).toBeNull();
  });

  it("does not let the identity merge clobber the composed shape", () => {
    const d = composeCurationDesign(g2, 18392, "GSE74438", null);
    expect(d.factors[0].name).toBe("organism part");
    expect(d.factors[0].category.label).toBe("organism part");
  });
});

/**
 * Identity from the projection (2026-08-20, later the same day).
 *
 * cab fixed `Design.experimental_factors` at source so the projection
 * carries the id fields too. A design serialized before that has them
 * only on `factors[]`, so both are read — one ladder, projection first.
 */
describe("composeCurationDesign — identity ladder", () => {
  it("reads gemma_factor_id off the projection when it is there", () => {
    const g2 = {
      experimental_factors: [
        {
          id: 1,
          name: "organism part",
          category: { category: "organism part", category_uri: null },
          gemma_factor_id: 36160,
          local_factor_id: null,
          values: [],
        },
      ],
      bio_material_assignments: [],
      // No `factors[]` at all — the projection is the only source.
    } as unknown as G2Design;
    const d = composeCurationDesign(g2, 18392, "GSE74438", null);
    expect(d.factors[0].gemma_factor_id).toBe(36160);
  });

  it("falls back to factors[] for a design serialized before the fix", () => {
    const g2 = {
      experimental_factors: [
        {
          id: 1,
          name: "organism part",
          category: { category: "organism part", category_uri: null },
          values: [],
        },
      ],
      bio_material_assignments: [],
      factors: [{ id: 1, gemma_factor_id: 36160, local_factor_id: null }],
    } as unknown as G2Design;
    const d = composeCurationDesign(g2, 18392, "GSE74438", null);
    expect(d.factors[0].gemma_factor_id).toBe(36160);
  });

  it("is null, not undefined, for a factor Gemma has never seen", () => {
    // The fold reads "no Gemma ids anywhere in this design" as "we
    // learned nothing", so the distinction has to survive: a null here
    // is a real answer, and every factor being null is what makes a
    // UI-authored polished row exempt from the staleness check.
    const g2 = {
      experimental_factors: [
        {
          id: 3,
          name: "genetic manipulation",
          category: { category: "genotype", category_uri: null },
          local_factor_id: "local-8f7f40227569",
          values: [],
        },
      ],
      bio_material_assignments: [],
    } as unknown as G2Design;
    const d = composeCurationDesign(g2, 18392, "GSE74438", null);
    expect(d.factors[0].gemma_factor_id).toBeNull();
    expect(d.factors[0].local_factor_id).toBe("local-8f7f40227569");
  });
});

/**
 * The composed design's taxon, from either producer.
 *
 * 🛑 `meta` here is `/rest/v2/datasets/{id}`, and Gemma sends **no
 * `taxonCommonName`** on it — measured on gemma2 2026-08-28, absent from
 * every key of that payload, with a nested `taxon` object in its place.
 * Reading only the flat name made this `""` on every remote dataset, and
 * an empty taxon is not inert: `PrePublishChecklist` renders an amber
 * "no taxon set" chip from it, so the checklist reported a curation
 * problem on datasets that have a species.
 *
 * Second site of the same defect — the catalogue list was the first, and
 * there it crashed the search box rather than misreporting. One reader
 * (`taxonLabel`) serves both.
 */
describe("composeCurationDesign — taxon from either wire shape", () => {
  const compose = (meta: unknown) =>
    composeCurationDesign(
      G2_NO_FACTORS,
      42,
      "GSE-test",
      null,
      null,
      meta as Parameters<typeof composeCurationDesign>[5],
    );

  it("reads Gemma's nested taxon object", () => {
    expect(
      compose({ taxon: { common_name: "human", scientific_name: "Homo sapiens" } })
        .taxon,
    ).toBe("human");
  });

  it("reads local_api's flat taxon_common_name", () => {
    expect(compose({ taxon_common_name: "mouse" }).taxon).toBe("mouse");
  });

  it("is a string, never undefined, when neither shape carries one", () => {
    expect(compose({}).taxon).toBe("");
    expect(compose(null).taxon).toBe("");
  });
});
