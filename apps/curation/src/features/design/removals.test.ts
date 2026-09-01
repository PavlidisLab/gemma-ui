/**
 * The tombstone derivation — the only place that can say a row the
 * curator deleted used to exist.
 *
 * Getting it wrong is asymmetric in the same way the commit document
 * is: a missed tombstone leaves a deletion unmade, which a curator can
 * see and redo; a wrong one deletes a real row of someone's design.
 *
 * Fixture ids are verbatim from gemma2 design 1658 (factor 11727,
 * values 64275 / 77276, statement 30045176).
 */
import { describe, expect, it } from "vitest";

import type { Design, FactorValue, Statement } from "@/features/experiment/types";

import type { DesignDiff } from "./diff";
import { removalsFromDiff } from "./removals";

const term = (label: string) => ({ label, uri: null });

const fv = (id: number, statements: Statement[] = []): FactorValue =>
  ({ id, free_text_label: `fv ${id}`, is_baseline: false, statements }) as FactorValue;

const SAVED = {
  factors: [
    {
      id: 3,
      gemma_factor_id: 11727,
      name: "Treatment",
      category: term("treatment"),
      description: "",
      type: "categorical",
      factor_values: [],
    },
    {
      id: 4,
      // No `gemma_factor_id` — the id itself is what Gemma knows it by.
      name: "Genotype",
      category: term("genotype"),
      description: "",
      type: "categorical",
      factor_values: [],
    },
  ],
  tags: [],
} as unknown as Design;

const diffOf = (over: Partial<DesignDiff>): DesignDiff =>
  ({
    factorsRemoved: [],
    factorsChanged: [],
    tags: { added: [], removed: [], modified: [] },
    ...over,
  }) as DesignDiff;

describe("removalsFromDiff", () => {
  it("🛑 keys deleted values on the factor's GEMMA id, not the design's", () => {
    // The document keys its per-factor sections on
    // `gemma_factor_id ?? id`. Handing it the design-side 3 would
    // attach the tombstones to whatever factor 3 is in Gemma.
    const r = removalsFromDiff(
      diffOf({
        factorsChanged: [
          { factorId: 3, removed: [{ fvId: 77276 }], modified: [] },
        ] as unknown as DesignDiff["factorsChanged"],
      }),
      SAVED,
    );
    expect(r.factorValues).toEqual([{ factorId: 11727, valueIds: [77276] }]);
  });

  it("falls back to the design id when Gemma's is absent", () => {
    const r = removalsFromDiff(
      diffOf({
        factorsChanged: [
          { factorId: 4, removed: [{ fvId: 64275 }], modified: [] },
        ] as unknown as DesignDiff["factorsChanged"],
      }),
      SAVED,
    );
    expect(r.factorValues).toEqual([{ factorId: 4, valueIds: [64275] }]);
  });

  it("names a deleted factor by its Gemma id", () => {
    const r = removalsFromDiff(
      diffOf({ factorsRemoved: [SAVED.factors![0]] }),
      SAVED,
    );
    expect(r.factorIds).toEqual([11727]);
  });

  it("🛑 does NOT delete a statement when one of its pairs survives", () => {
    // Two rows sharing `gemma_id` are the two pairs of ONE statement.
    // Removing a pair edits that statement; sending the id as a
    // deletion would take the surviving pair with it.
    const before = fv(77276, [
      { gemma_id: 30045176, subject: term("acid") } as Statement,
      { gemma_id: 30045176, subject: term("acid"), predicate: term("dose") } as Statement,
    ]);
    const after = fv(77276, [
      { gemma_id: 30045176, subject: term("acid") } as Statement,
    ]);
    const r = removalsFromDiff(
      diffOf({
        factorsChanged: [
          { factorId: 3, removed: [], modified: [{ fvId: 77276, before, after }] },
        ] as unknown as DesignDiff["factorsChanged"],
      }),
      SAVED,
    );
    expect(r.statements).toBeUndefined();
  });

  it("deletes a statement when every pair of it is gone", () => {
    const before = fv(77276, [
      { gemma_id: 30045176, subject: term("acid") } as Statement,
    ]);
    const r = removalsFromDiff(
      diffOf({
        factorsChanged: [
          {
            factorId: 3,
            removed: [],
            modified: [{ fvId: 77276, before, after: fv(77276, []) }],
          },
        ] as unknown as DesignDiff["factorsChanged"],
      }),
      SAVED,
    );
    expect(r.statements).toEqual([
      { valueId: 77276, statementIds: [30045176] },
    ]);
  });

  it("names deleted tags", () => {
    const r = removalsFromDiff(
      diffOf({
        tags: {
          added: [],
          removed: [{ id: 42, category: term("organism part"), value: term("liver") }],
          modified: [],
        } as unknown as DesignDiff["tags"],
      }),
      SAVED,
    );
    expect(r.tagIds).toEqual([42]);
  });

  it("is empty for a diff with no deletions in it", () => {
    expect(removalsFromDiff(diffOf({}), SAVED)).toEqual({});
  });
});
