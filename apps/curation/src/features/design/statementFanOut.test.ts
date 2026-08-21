import { describe, expect, it } from "vitest";
import type { Design, Statement } from "@/features/experiment/types";
import { setStatement } from "./mutations";

/**
 * Editing a statement's subject fans the change out to every pair under
 * that subject. Two chained writes have to COMPOSE.
 *
 * The bug (GSE152448, 2026-08-20): grounding a free-text subject on a
 * subject carrying two predicate/object pairs split the group in two —
 * the first pair kept the ungrounded subject, the second got the
 * grounded one, and the card rendered them as two statements with the
 * new one "inheriting" the second clause. Paul: *"it forces a new
 * statement to be added to the fv, instead of upgrading the free
 * text."*
 *
 * 🛑 The cause was not in the mutator or in the fan-out loop, both of
 * which were correct. It was the call site:
 *
 *     apply(setStatement(draft, ...))        // ← captured draft
 *
 * `setSharedSubject` fires one of these per pair in a single tick, and
 * every one of them was computed from the SAME captured `draft`, so the
 * last write won and the earlier ones were discarded. Seventeen call
 * sites across four files had the shape; they pass a function now:
 *
 *     apply((d) => setStatement(d, ...))     // ← composes
 *
 * These tests pin the composition property the call sites depend on.
 * The comment above `setSharedSubject` had asserted it for months.
 */

const CAT = { label: "genotype", uri: null };

function stmt(subjectLabel: string, subjectUri: string | null, predicate: string, object: string): Statement {
  return {
    category: CAT,
    subject: { label: subjectLabel, uri: subjectUri },
    predicate: { label: predicate, uri: null },
    object: { label: object, uri: null },
  };
}

/** GSE152448's shape: one subject, two pairs. */
function design(): Design {
  return {
    experiment_id: 17401,
    experiment_short_name: "GSE152448",
    biomaterials: [],
    tags: [],
    factors: [
      {
        id: 1,
        name: "genotype",
        category: CAT,
        description: "",
        type: "categorical",
        factor_values: [
          {
            id: 2,
            free_text_label: "Homozygous negative KDM6A clone 1",
            is_baseline: false,
            biomaterial_short_names: [],
            numeric_value: null,
            statements: [
              stmt("KDM6A", null, "has_genotype", "Homozygous negative"),
              stmt("KDM6A", null, "has modifier", "clone 1"),
            ],
          },
        ],
      },
    ],
  };
}

const GROUNDED = {
  label: "KDM6A",
  uri: "http://purl.org/commons/record/ncbi_gene/7403",
};

function subjectsOf(d: Design): Array<string | null> {
  return d.factors[0].factor_values[0].statements.map(
    (s) => s.subject.uri ?? null,
  );
}

describe("grounding a subject fans out to every pair under it", () => {
  it("composes when each write is computed from the PREVIOUS result", () => {
    // What the fixed call sites do.
    let d = design();
    d.factors[0].factor_values[0].statements.forEach((s, i) => {
      d = setStatement(d, 1, 2, i, { ...s, subject: GROUNDED });
    });
    expect(subjectsOf(d)).toEqual([GROUNDED.uri, GROUNDED.uri]);
  });

  it("🛑 and is LOST when each is computed from the same captured draft", () => {
    // What the call sites used to do. Pinned so the shape is
    // recognisable if it ever comes back: the last write wins, the
    // first pair keeps the free-text subject, and the card splits.
    const captured = design();
    let last = captured;
    captured.factors[0].factor_values[0].statements.forEach((s, i) => {
      last = setStatement(captured, 1, 2, i, { ...s, subject: GROUNDED });
    });
    expect(subjectsOf(last)).toEqual([null, GROUNDED.uri]);
  });

  it("leaves each pair's own predicate and object alone", () => {
    let d = design();
    d.factors[0].factor_values[0].statements.forEach((s, i) => {
      d = setStatement(d, 1, 2, i, { ...s, subject: GROUNDED });
    });
    const out = d.factors[0].factor_values[0].statements;
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.predicate?.label)).toEqual([
      "has_genotype",
      "has modifier",
    ]);
    expect(out.map((s) => s.object?.label)).toEqual([
      "Homozygous negative",
      "clone 1",
    ]);
  });
});
