/**
 * Create or update — the one decision in the commit document that can
 * rewrite another dataset's design.
 *
 * 🛑 The editor mints its ids as `max(existing) + 1`
 * (`features/design/mutations.ts::nextFvId` / `nextFactorId`), so a
 * value the curator added a moment ago carries a POSITIVE id that names
 * nothing in Gemma. Read by the sign, that is "update this": on gemma2
 * design 1658 (factor 23079, values 64275 … 77279) the first added
 * value went out as `{gemmaId: 77280, freeTextLabel: …}`, an in-place
 * write over whatever dataset holds FactorValue 77280.
 *
 * Membership in the baseline — the design Gemma last served — is the
 * question that cannot be fooled that way, and it is the same question
 * the tags section has always asked.
 */
import { describe, expect, it } from "vitest";

import { buildCurationDocument, type CommittableDesign } from "./curationCommit";

const SERVED_FACTOR: NonNullable<CommittableDesign["factors"]>[number] = {
  id: 23079,
  gemma_factor_id: 23079,
  name: "treatment",
  factor_values: [
    { id: 64275, free_text_label: "control", is_baseline: true },
    { id: 77279, free_text_label: "hypochlorous acid" },
  ],
};

/** Design 1658 as Gemma serves it. */
const SERVED: CommittableDesign = { factors: [SERVED_FACTOR], tags: [] };

/** The same design after the curator adds one value to the existing
 *  factor and one factor of their own, carrying the ids the editor
 *  would mint for each. */
const EDITED: CommittableDesign = {
  factors: [
    {
      ...SERVED_FACTOR,
      factor_values: [
        ...(SERVED_FACTOR.factor_values ?? []),
        { id: 77280, free_text_label: "vehicle" },
      ],
    },
    {
      id: 23080,
      name: "genotype",
      factor_values: [{ id: 77281, free_text_label: "wild type" }],
    },
  ],
  tags: [],
};

function build(
  design: CommittableDesign,
  baseline: CommittableDesign | undefined = SERVED,
) {
  return buildCurationDocument(design, { mode: "remote", baseline });
}

const factorsOf = (design: CommittableDesign, baseline?: CommittableDesign) =>
  build(design, baseline).design?.factors?.items ?? [];

describe("a row Gemma never issued is a create", () => {
  it("🛑 an added factor value is a clientRef, not `gemmaId: 77280`", () => {
    const values = factorsOf(EDITED)[0].factorValues?.items ?? [];
    const added = values[2];
    expect(added.gemmaId).toBeUndefined();
    expect(added.clientRef).toBe("fv-77280");
    expect(added.freeTextLabel).toBe("vehicle");
  });

  it("🛑 an added factor is a clientRef too", () => {
    const added = factorsOf(EDITED)[1];
    expect(added.gemmaId).toBeUndefined();
    expect(added.clientRef).toBe("factor-23080");
    expect(added.factorValues?.items?.[0].clientRef).toBe("fv-77281");
  });

  it("gives each new row a clientRef of its own", () => {
    // The response's `idMap` keys off these, so a collision loses a
    // creation. Editor ids are unique across the whole design.
    const factors = factorsOf(EDITED);
    const refs = factors.flatMap((f) => [
      f.clientRef,
      ...(f.factorValues?.items ?? []).map((v) => v.clientRef),
    ]);
    const minted = refs.filter((r): r is string => typeof r === "string");
    expect(new Set(minted).size).toBe(minted.length);
  });
});

describe("a row the baseline carries is an update", () => {
  it("names the served factor and its values by gemmaId", () => {
    const factor = factorsOf(EDITED)[0];
    expect(factor.gemmaId).toBe(23079);
    expect(factor.clientRef).toBeUndefined();
    const values = factor.factorValues?.items ?? [];
    expect(values[0].gemmaId).toBe(64275);
    expect(values[1].gemmaId).toBe(77279);
  });

  it("matches the baseline on the id the item carries", () => {
    // A store-shaped factor keeps a local `id` beside Gemma's own
    // `gemma_factor_id`, and the item is named by the latter — so the
    // baseline has to be read the same way or an untouched factor
    // reads as new.
    const served: CommittableDesign = {
      factors: [{ id: 5, gemma_factor_id: 900, factor_values: [] }],
    };
    const factor = factorsOf(served, served)[0];
    expect(factor.gemmaId).toBe(900);
    expect(factor.clientRef).toBeUndefined();
  });

  it("🛑 a value deleted from the baseline is still a create when re-added", () => {
    // Nothing on Gemma's side holds the id any more, so naming it
    // would rewrite a row that no longer means what it did.
    const baseline: CommittableDesign = { factors: [], tags: [] };
    const values = factorsOf(EDITED, baseline)[0].factorValues?.items ?? [];
    expect(values.every((v) => v.gemmaId === undefined)).toBe(true);
  });
});

describe("a proposed row stays a create", () => {
  it("keeps the negative ids `composeCurationDesign` mints as clientRefs", () => {
    const proposed: CommittableDesign = {
      factors: [
        { id: -1, name: "proposed", factor_values: [{ id: -1001 }] },
      ],
      tags: [],
    };
    const factor = factorsOf(proposed)[0];
    expect(factor.clientRef).toBe("factor--1");
    expect(factor.factorValues?.items?.[0].clientRef).toBe("fv--1001");
  });
});

describe("with no baseline design the sign is all there is", () => {
  it("falls back to the sign of the id", () => {
    // Documented fallback, not an endorsement: reading every factor as
    // new would duplicate the whole design, so a caller that passes no
    // `baseline.factors` gets the old test and the hazard above. The
    // commit path always passes the saved design.
    const factors = factorsOf(EDITED, { tags: [] });
    expect(factors[0].gemmaId).toBe(23079);
    expect(factors[1].gemmaId).toBe(23080);
  });

  it("🛑 an EMPTY baseline design is an answer, not an absence", () => {
    // `factors: []` says Gemma holds no factors, so everything in the
    // draft is new — the sign must not take over here.
    const factors = factorsOf(EDITED, { factors: [], tags: [] });
    expect(factors.every((f) => f.gemmaId === undefined)).toBe(true);
  });
});
