/**
 * The commit document builder — the one place where getting identity
 * wrong duplicates or overwrites a real dataset's design.
 *
 * Every commit item names its target with `gemmaId` (update this) or
 * `clientRef` (create this). Sending a `clientRef` for something that
 * exists creates a duplicate; sending a local id as a `gemmaId`
 * rewrites whatever holds that id in Gemma. So the discriminator gets
 * tests before the builder ever touches a wire.
 *
 * Fixture ids are verbatim from gemma2 design 1658 (factors 8715 /
 * 11727, values 64275 / 77276) beside the negatives
 * `composeCurationDesign` mints for agent-proposed rows.
 */
import { describe, expect, it } from "vitest";

import {
  buildCurationDocument,
  LOCAL_DESIGN_NOT_COMMITTABLE,
  type CommittableDesign,
} from "./curationCommit";

const REMOTE = { mode: "remote" } as const;

/** A Gemma-seeded factor beside an agent-proposed one. */
const DESIGN: CommittableDesign = {
  factors: [
    {
      id: 11727,
      gemma_factor_id: 11727,
      name: "Treatment",
      description: "control, hypochlorous acid",
      type: "categorical",
      category: { label: "treatment", uri: "http://…/EFO_0000727" },
      factor_values: [
        {
          id: 77276,
          free_text_label: "reference substance role",
          is_baseline: true,
          biomaterial_short_names: ["GSM1", "GSM2"],
          statements: [
            {
              gemma_id: 30045176,
              category: { label: "treatment", uri: "http://…/EFO_0000727" },
              subject: { label: "reference substance role", uri: "http://…/OBI_0000025" },
            },
          ],
        },
        // Proposed: negative id, and a statement with no Gemma id.
        {
          id: -1001,
          free_text_label: "hypochlorous acid",
          is_baseline: false,
          statements: [{ subject: { label: "hypochlorous acid" } }],
        },
      ],
    },
    { id: -1, name: "proposed factor", factor_values: [] },
  ],
  tags: [
    { id: 42, category: { label: "organism part" }, value: { label: "liver" } },
    // Inferred: a projection Gemma computes, not a row of its own.
    { id: 43, inferred: true, category: { label: "cell type" }, value: { label: "hepatocyte" } },
  ],
};

describe("buildCurationDocument", () => {
  const doc = buildCurationDocument(DESIGN, REMOTE);
  const factors = doc.design?.factors?.items ?? [];

  it("🛑 refuses a local-mode design outright", () => {
    // The store's ids are small locals AND positive, so no per-row test
    // can tell them from Gemma's. Refusing beats being clever.
    expect(() => buildCurationDocument(DESIGN, { mode: "local" })).toThrow(
      LOCAL_DESIGN_NOT_COMMITTABLE,
    );
  });

  it("names an existing factor by gemmaId, a proposed one by clientRef", () => {
    expect(factors[0].gemmaId).toBe(11727);
    expect(factors[0].clientRef).toBeUndefined();
    expect(factors[1].clientRef).toBe("factor--1");
    expect(factors[1].gemmaId).toBeUndefined();
  });

  it("🛑 splits factor values on the SIGN of the id", () => {
    const vs = factors[0].factorValues?.items ?? [];
    expect(vs[0].gemmaId).toBe(77276);
    expect(vs[0].clientRef).toBeUndefined();
    expect(vs[1].clientRef).toBe("fv--1001");
    expect(vs[1].gemmaId).toBeUndefined();
  });

  it("carries a statement's own gemma_id, and refs one without", () => {
    const sts = factors[0].factorValues?.items?.[0].statements?.items ?? [];
    expect(sts[0].gemmaId).toBe(30045176);
    const proposed =
      factors[0].factorValues?.items?.[1].statements?.items ?? [];
    expect(proposed[0].gemmaId).toBeUndefined();
    expect(proposed[0].clientRef).toBeTruthy();
  });

  it("🛑 never asks Gemma to delete anything", () => {
    // An absent `deletedIds` removes nothing. A missed deletion is
    // visible and fixable; an unintended one is neither.
    expect(doc.design?.factors?.deletedIds).toBeUndefined();
    expect(doc.tags?.deletedIds).toBeUndefined();
  });

  it("🛑 skips inferred tags — Gemma derives those", () => {
    const tags = doc.tags?.items ?? [];
    expect(tags).toHaveLength(1);
    expect(tags[0].gemmaId).toBe(42);
  });

  it("passes terms through as label + uri, dropping empties", () => {
    expect(factors[0].category).toEqual({
      label: "treatment",
      uri: "http://…/EFO_0000727",
    });
    // A proposed factor with no category must not emit `category: {}`.
    expect(factors[1].category).toBeUndefined();
  });

  it("keeps isBaseline explicit on every value", () => {
    // Not `...(x ? {} : {})` — false is meaningful here. Omitting it
    // on a value the curator just UNMARKED would leave the old
    // baseline standing.
    const vs = factors[0].factorValues?.items ?? [];
    expect(vs[0].isBaseline).toBe(true);
    expect(vs[1].isBaseline).toBe(false);
  });

  it("sends the baseline stamp only when given one", () => {
    expect(doc.baseline).toBeUndefined();
    expect(
      buildCurationDocument(DESIGN, {
        mode: "remote",
        baselineLastModified: "2026-08-29T15:49:07Z",
      }).baseline,
    ).toEqual({ lastModified: "2026-08-29T15:49:07Z" });
  });
});
