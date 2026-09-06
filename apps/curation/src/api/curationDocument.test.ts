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

/** Gemma's own copy of the design. The tag section needs it: a tag is
 *  add/delete only, so "did this change" is answerable only against
 *  what Gemma last served. */
const BASELINE: Pick<CommittableDesign, "tags"> = {
  tags: [
    { id: 42, category: { label: "organism part" }, value: { label: "liver" } },
    { id: 43, inferred: true, category: { label: "cell type" }, value: { label: "hepatocyte" } },
  ],
};

const REMOTE = { mode: "remote", baseline: BASELINE } as const;

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

/**
 * `evidenceCode` survives a commit.
 *
 * 🛑 The `design` section is full-record replacement (2026-09-06), so
 * an omitted key CLEARS the stored value. `supportingEvidence` is
 * guarded — omitting it on a row that has one is a 400 — and
 * `evidenceCode` beside it is NOT. Measured on gemma2/657 statement
 * 30030391: committed without it, `IC` was gone, `200 updated: 1`, no
 * warning. Nothing in the UI edits the code; it is carried from
 * `/design` purely so a commit cannot destroy it.
 */
describe("statement evidenceCode is re-sent, never dropped", () => {
  const withCode = (evidence_code: string | null) => ({
    factors: [
      {
        id: 7,
        gemma_factor_id: 7,
        factor_values: [
          {
            id: 1,
            statements: [
              {
                gemma_id: 900,
                evidence_code,
                subject: { label: "epiblast cell", uri: "CL_0000352" },
              },
            ],
          },
        ],
      },
    ],
  });
  const emitted = (design: ReturnType<typeof withCode>) =>
    buildCurationDocument(design as never, { mode: "remote" }).design?.factors
      ?.items?.[0].factorValues?.items?.[0].statements?.items?.[0];

  it("carries the stored code back unchanged", () => {
    expect(emitted(withCode("IC"))?.evidenceCode).toBe("IC");
  });

  it("carries a backfilled IIA the same way", () => {
    expect(emitted(withCode("IIA"))?.evidenceCode).toBe("IIA");
  });

  it("emits no key when the row has no code", () => {
    // Absent-with-nothing-stored is the one safe omission.
    const st = emitted(withCode(null));
    expect(st && "evidenceCode" in st).toBe(false);
  });
});

describe("buildCurationDocument", () => {
  const doc = buildCurationDocument(DESIGN, REMOTE);
  const factors = doc.design?.factors?.items ?? [];

  it("🛑 refuses a local-mode design outright", () => {
    // The store's ids are small locals AND positive, so no per-row test
    // can tell them from Gemma's. Refusing beats being clever.
    expect(() =>
      buildCurationDocument(DESIGN, { mode: "local", baseline: BASELINE }),
    ).toThrow(
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

  it("🛑 asks Gemma to delete nothing when handed no removals", () => {
    // An absent `deletedIds` removes nothing. A missed deletion is
    // visible and fixable; an unintended one is neither — so a caller
    // with no tombstones in hand still gets the safe document.
    expect(doc.design?.factors?.deletedIds).toBeUndefined();
    expect(doc.tags?.deletedIds).toBeUndefined();
    expect(
      doc.design?.factors?.items?.[0].factorValues?.deletedIds,
    ).toBeUndefined();
  });

  it("🛑 skips inferred tags — Gemma derives those", () => {
    const tags = doc.tags?.items ?? [];
    expect(tags).toHaveLength(1);
    expect(tags[0].gemmaId).toBe(42);
  });

  it("🛑 an unchanged tag is the id ALONE — anything beside it is a 400", () => {
    // Gemma reads a `gemmaId` in `tags` as a KEEP-MARKER and rejects
    // any other field on that item, "because accepting it would report
    // success for an edit that never happened". This builder used to
    // send `{gemmaId, category, value}`.
    expect(doc.tags?.items?.[0]).toEqual({ gemmaId: 42 });
  });

  it("passes terms through as label + uri, dropping empties", () => {
    expect(factors[0].category).toEqual({
      label: "treatment",
      uri: "http://…/EFO_0000727",
    });
    // A proposed factor with no category must not emit `category: {}`.
    expect(factors[1].category).toBeUndefined();
  });

  it("forces true, and says nothing where the stored flag was null", () => {
    // 🛑 This test used to assert `isBaseline: false` on every
    // unmarked value, reasoning that omitting it "on a value the
    // curator just UNMARKED would leave the old baseline standing".
    // That reasoning holds only where a flag was SET; against a null
    // it writes a forced non-baseline over Gemma's inference, which is
    // the destructive case — see the tri-state block below.
    const vs = factors[0].factorValues?.items ?? [];
    expect(vs[0].isBaseline).toBe(true);
    expect("isBaseline" in vs[1]).toBe(false);
  });

  it("sends the baseline stamp only when given one", () => {
    expect(doc.baseline).toBeUndefined();
    expect(
      buildCurationDocument(DESIGN, {
        ...REMOTE,
        baselineLastModified: "2026-08-29T15:49:07Z",
      }).baseline,
    ).toEqual({ lastModified: "2026-08-29T15:49:07Z" });
  });
});

describe("buildCurationDocument, handed removals", () => {
  const doc = buildCurationDocument(DESIGN, REMOTE, {
    factorIds: [8715],
    factorValues: [{ factorId: 11727, valueIds: [77276, -1001] }],
    statements: [{ valueId: 77276, statementIds: [30045176] }],
    tagIds: [42],
  });
  const factor = doc.design?.factors?.items?.[0];

  it("names deleted factors at the design level", () => {
    expect(doc.design?.factors?.deletedIds).toEqual([8715]);
  });

  it("names deleted values under the factor that keeps them", () => {
    // Keyed on `gemma_factor_id ?? id` — the same id the item carries.
    expect(factor?.gemmaId).toBe(11727);
    expect(factor?.factorValues?.deletedIds).toEqual([77276]);
  });

  it("🛑 drops the id Gemma never issued", () => {
    // -1001 is an agent-proposed value: it was never sent, so there is
    // nothing on the far side to delete and naming it is a guess.
    expect(factor?.factorValues?.deletedIds).not.toContain(-1001);
  });

  it("names deleted statements under the value that keeps them", () => {
    const fv = factor?.factorValues?.items?.[0];
    expect(fv?.gemmaId).toBe(77276);
    expect(fv?.statements?.deletedIds).toEqual([30045176]);
  });

  it("names deleted tags", () => {
    expect(doc.tags?.deletedIds).toEqual([42]);
  });

  it("🛑 emits no key at all for a section with nothing to delete", () => {
    // An empty array is the same instruction spelled louder. Emitting
    // one would put a delete section on every commit.
    const none = buildCurationDocument(DESIGN, REMOTE, {
      factorIds: [-5],
      tagIds: [],
    });
    expect(none.design?.factors?.deletedIds).toBeUndefined();
    expect(none.tags?.deletedIds).toBeUndefined();
  });
});

/**
 * The tag section, which is add/delete only on Gemma's side.
 *
 * Verbatim from `PUT /datasets/{id}/curation`'s own description: an
 * item carrying a `gemmaId` is a KEEP-MARKER, the id is the only field
 * read, and any other field on such an item is a 400 naming every
 * offending one, "because accepting it would report success for an
 * edit that never happened". To change one: drop the `gemmaId`, send
 * the content under a `clientRef`, and name the old id in `deletedIds`.
 */
describe("buildCurationDocument — tags are add/delete only", () => {
  const baseline = {
    tags: [
      { id: 9018, category: { label: "organism part" }, value: { label: "liver" } },
      { id: 9019, category: { label: "disease" }, value: { label: "cirrhosis" } },
    ],
  };

  it("re-terms as delete + create, naming the old id", () => {
    const doc = buildCurationDocument(
      {
        tags: [
          // Same id, different value: a re-term.
          { id: 9018, category: { label: "organism part" }, value: { label: "hepatocyte" } },
          { id: 9019, category: { label: "disease" }, value: { label: "cirrhosis" } },
        ],
      },
      { mode: "remote", baseline },
    );
    const items = doc.tags?.items ?? [];
    // The re-termed one carries content under a clientRef…
    expect(items[0]).toEqual({
      clientRef: "tag-9018",
      category: { label: "organism part" },
      value: { label: "hepatocyte" },
    });
    // …its old id is named for deletion…
    expect(doc.tags?.deletedIds).toEqual([9018]);
    // …and the untouched one stays a bare keep-marker.
    expect(items[1]).toEqual({ gemmaId: 9019 });
  });

  it("a curator's new tag is a create, even with a positive id", () => {
    // 🛑 `mutations.ts::nextTagId` gives a new tag `max(id) + 1`, so it
    // carries a positive id one past a real Gemma id. The SIGN would
    // read that as "update this"; membership in the baseline cannot be
    // fooled that way.
    const doc = buildCurationDocument(
      { tags: [{ id: 9020, category: { label: "sex" }, value: { label: "female" } }] },
      { mode: "remote", baseline },
    );
    expect(doc.tags?.items?.[0]).toEqual({
      clientRef: "tag-9020",
      category: { label: "sex" },
      value: { label: "female" },
    });
    expect(doc.tags?.deletedIds).toBeUndefined();
  });

  it("a re-term's old id rides beside the curator's own deletions", () => {
    const doc = buildCurationDocument(
      { tags: [{ id: 9018, category: { label: "organism part" }, value: { label: "hepatocyte" } }] },
      { mode: "remote", baseline },
      { tagIds: [9019] },
    );
    expect(doc.tags?.deletedIds).toEqual([9019, 9018]);
  });

  it("🛑 refuses rather than guess when no baseline came with it", () => {
    // Both wrong answers are bad: a keep-marker silently discards the
    // curator's edit, and content beside the id is a 400. The caller
    // holds the saved design.
    expect(() =>
      buildCurationDocument(
        { tags: [{ id: 9018, category: { label: "organism part" }, value: { label: "liver" } }] },
        { mode: "remote" },
      ),
    ).toThrow(/without the baseline design/);
  });

  it("needs no baseline when nothing carries a Gemma id", () => {
    const doc = buildCurationDocument(
      { tags: [{ id: 0, category: { label: "sex" }, value: { label: "male" } }] },
      { mode: "remote" },
    );
    expect(doc.tags?.items?.[0].clientRef).toBe("tag-0");
  });
});

/**
 * `isBaseline` has THREE states and `false` is not the empty one.
 *
 * Gemma's `BaselineSelection.isBaselineCondition` short-circuits on an
 * explicit flag and otherwise infers from the terms: null is
 * "unforced, infer", true is "forced baseline", false is "forced NOT
 * baseline" — which turns the inference off permanently. So writing
 * `false` over a null on a control-labelled factor value changes which
 * group differential expression treats as the reference.
 *
 * Measured 2026-09-04 on sandbox factor value 9005: no flag before a
 * probe commit, `false` after, from a client that coerced absent to
 * false. This builder was that client.
 */
describe("buildCurationDocument — the baseline flag is tri-state", () => {
  const fv = (id: number, is_baseline?: boolean) => ({ id, is_baseline });
  const design = (values: ReturnType<typeof fv>[]): CommittableDesign => ({
    factors: [{ id: 7, gemma_factor_id: 7, factor_values: values }],
  });
  const emitted = (doc: ReturnType<typeof buildCurationDocument>) =>
    doc.design?.factors?.items?.[0].factorValues?.items ?? [];

  it("🛑 says NOTHING when the stored flag was null and nothing was forced", () => {
    // The destructive case. `false` here would switch off baseline
    // detection for a factor value whose terms imply a control.
    const doc = buildCurationDocument(design([fv(1, false)]), {
      mode: "remote",
      baseline: design([fv(1, undefined)]),
    });
    expect("isBaseline" in emitted(doc)[0]).toBe(false);
  });

  it("forces true when the curator picked a baseline", () => {
    const doc = buildCurationDocument(design([fv(1, true)]), {
      mode: "remote",
      baseline: design([fv(1, undefined)]),
    });
    expect(emitted(doc)[0].isBaseline).toBe(true);
  });

  it("writes false only over a flag that was already explicit", () => {
    // Un-setting a forced baseline IS what the curator asked for.
    const doc = buildCurationDocument(design([fv(1, false)]), {
      mode: "remote",
      baseline: design([fv(1, true)]),
    });
    expect(emitted(doc)[0].isBaseline).toBe(false);
  });

  it("🛑 says nothing when the stored flag COLLAPSED to false from a null", () => {
    // The regression. `composeDesign` writes `is_baseline: false` for a
    // null, so `prior.is_baseline !== undefined` was true for every
    // value and forced the flag off on all of them. Measured on
    // gemma2/657: a description-only edit went out as three updates,
    // and Gemma refused the commit as deleting a DE analysis.
    const doc = buildCurationDocument(design([fv(1, false)]), {
      mode: "remote",
      baseline: {
        factors: [
          {
            id: 7,
            gemma_factor_id: 7,
            factor_values: [
              { id: 1, is_baseline: false, is_baseline_explicit: false },
            ],
          },
        ],
      },
    });
    expect("isBaseline" in emitted(doc)[0]).toBe(false);
  });

  it("still writes false when the witness says the flag was explicit", () => {
    const doc = buildCurationDocument(design([fv(1, false)]), {
      mode: "remote",
      baseline: {
        factors: [
          {
            id: 7,
            gemma_factor_id: 7,
            factor_values: [
              { id: 1, is_baseline: false, is_baseline_explicit: true },
            ],
          },
        ],
      },
    });
    expect(emitted(doc)[0].isBaseline).toBe(false);
  });

  it("says nothing when there is no baseline design to compare against", () => {
    // A caller with no baseline cannot know whether the stored flag was
    // null, and a default written into that gap is the bug above.
    const doc = buildCurationDocument(design([fv(1, false)]), { mode: "remote" });
    expect("isBaseline" in emitted(doc)[0]).toBe(false);
  });
});
