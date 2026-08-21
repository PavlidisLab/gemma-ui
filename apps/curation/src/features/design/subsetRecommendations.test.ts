import { describe, expect, it } from "vitest";
import type {
  Design,
  Factor,
  SubsetRecommendation,
} from "@/features/experiment/types";
import {
  TIER_META,
  isInEffect,
  namesAnAxis,
  isNotice,
  isSilent,
  liveSubsets,
  resolveSubset,
  sourceChip,
  subsetFactorLabel,
  summariseSplit,
  summariseSubsets,
  tierMetaOf,
  tierTitle,
  countRejectedSubsets,
} from "./subsetRecommendations";

/**
 * The fold's contract. Each block below pins one of the three fields
 * that does not mean what it looks like — the reason this module
 * exists rather than four copies of these conditions across the
 * surfaces that read them.
 */

function factor(over: Partial<Factor> = {}): Factor {
  return {
    id: 1,
    name: "organism part",
    category: { label: "organism part", uri: null },
    description: "",
    type: "categorical",
    factor_values: [
      {
        id: 10,
        free_text_label: "Ammon's horn",
        is_baseline: false,
        statements: [],
        biomaterial_short_names: [],
        numeric_value: null,
      },
      {
        id: 11,
        free_text_label: "frontal cortex",
        is_baseline: false,
        statements: [],
        biomaterial_short_names: [],
        numeric_value: null,
      },
    ],
    ...over,
  };
}

function rec(over: Partial<SubsetRecommendation> = {}): SubsetRecommendation {
  return {
    id: "gemma-subset-organism-part",
    by_factor_id: 1,
    level_labels: [],
    rationale: "",
    status: "agent_recommended",
    source: "gemma",
    ...over,
  };
}

/** A design whose one factor is GROUNDED — needed for any drift test,
 *  since an ungrounded factor abstains entirely. */
function groundedDesign(): Design {
  return design({
    factors: [
      factor({
        factor_values: [
          {
            id: 10,
            free_text_label: "frontal cortex",
            is_baseline: false,
            biomaterial_short_names: [],
            numeric_value: null,
            statements: [
              {
                category: { label: "organism part", uri: null },
                subject: {
                  label: "frontal cortex",
                  uri: "http://purl.obolibrary.org/obo/UBERON_0001870",
                },
              },
            ],
          },
        ],
      }),
    ],
  });
}

function design(over: Partial<Design> = {}): Design {
  return {
    experiment_id: 18392,
    experiment_short_name: "GSE74438",
    factors: [factor()],
    biomaterials: [],
    tags: [],
    ...over,
  };
}

describe("isInEffect — accept is the default", () => {
  it("an arriving recommendation is already in effect", () => {
    // 🛑 The whole point. `agent_recommended` reads as "pending" and
    // is not: Paul, 2026-08-20 — "the default is to accept it unless
    // you disagree".
    expect(isInEffect(rec({ status: "agent_recommended" }))).toBe(true);
  });

  it("an explicitly accepted one is too", () => {
    expect(isInEffect(rec({ status: "accepted" }))).toBe(true);
  });

  it("rejecting is the only thing that turns it off", () => {
    expect(isInEffect(rec({ status: "rejected" }))).toBe(false);
  });
});

describe("tier — absent is unclassified, not tier 1", () => {
  it("no tier means no tier chip, but the row still shows", () => {
    // Every row in the store today is tier-less. Folding that to
    // `none` would hide all 69 of them, which is the bug this change
    // exists to fix.
    const r = rec();
    expect(tierMetaOf(r)).toBeNull();
    expect(isSilent(r)).toBe(false);
    expect(isNotice(r)).toBe(false);
  });

  it("convention is a notice — never something to action", () => {
    const r = rec({ tier: "convention" });
    expect(isNotice(r)).toBe(true);
    expect(tierMetaOf(r)?.loudness).toBe("notice");
  });

  it("qa and two_in_one surface properly", () => {
    expect(tierMetaOf(rec({ tier: "qa" }))?.loudness).toBe("surface");
    expect(tierMetaOf(rec({ tier: "two_in_one" }))?.loudness).toBe("surface");
  });

  it("tier none is the one that renders nothing", () => {
    expect(isSilent(rec({ tier: "none" }))).toBe(true);
  });

  it("an EMPTY STRING is absent, not a tier", () => {
    // 🛑 Both spellings of "absent" are live. Measured across the store
    // 2026-08-20: every `source: "gemma"` row is tiered (135
    // convention / 11 qa / 3 two_in_one), and every `source: "agent"`
    // row is not — 27 as `null` and 8 as `""`, because the server
    // field defaults to the empty string on one path. They must fold
    // the same way or a third of the agent rows vanish.
    const r = rec({ tier: "" as unknown as undefined });
    expect(tierMetaOf(r)).toBeNull();
    expect(isSilent(r)).toBe(false);
  });
});

describe("resolveSubset — the Gemma id is the identity", () => {
  it("resolves by gemma_factor_id, ignoring a by_factor_id that disagrees", () => {
    // Cab's measured incident, 2026-08-20: a base-design by_factor_id
    // of 1 carried into the polished row resolved to a GENOTYPE
    // factor. It resolved — a wrong answer that looks right.
    const d = design({
      factors: [
        factor({ id: 1, name: "genotype", gemma_factor_id: 36158 }),
        factor({ id: 2, name: "organism part", gemma_factor_id: 36160 }),
      ],
    });
    const { factor: f, stale } = resolveSubset(
      rec({ by_factor_id: 1, gemma_factor_id: 36160 }),
      d,
    );
    expect(f?.id).toBe(2);
    expect(f?.name).toBe("organism part");
    expect(stale).toBe(false);
  });

  it("falls back to by_factor_id when the row carries no Gemma id", () => {
    const { factor: f, stale } = resolveSubset(rec({ by_factor_id: 1 }), design());
    expect(f?.id).toBe(1);
    expect(stale).toBe(false);
  });

  it("a Gemma id nothing answers to is stale", () => {
    const d = design({
      factors: [factor({ id: 1, gemma_factor_id: 36158 })],
    });
    const { factor: f, stale } = resolveSubset(
      rec({ by_factor_id: 1, gemma_factor_id: 99999 }),
      d,
    );
    // 🛑 Stale wins over the local id even though id 1 exists — that
    // fallback is exactly how the wrong factor got bound.
    expect(f).toBeNull();
    expect(stale).toBe(true);
  });

  it("a design with no Gemma ids at all is not evidence of staleness", () => {
    // A UI-authored polished row carries none. We learned nothing, so
    // fall through to the local id rather than calling every row stale.
    const d = design({ factors: [factor({ id: 1, gemma_factor_id: null })] });
    const { factor: f, stale } = resolveSubset(
      rec({ by_factor_id: 1, gemma_factor_id: 36160 }),
      d,
    );
    expect(f?.id).toBe(1);
    expect(stale).toBe(false);
  });

  it("mixed Gemma ids still detect a miss", () => {
    // GSE74438's real shape: two Gemma-known factors, one curator-added
    // with a local_factor_id and no Gemma id.
    const d = design({
      factors: [
        factor({ id: 1, gemma_factor_id: 36160 }),
        factor({ id: 3, name: "genetic manipulation", gemma_factor_id: null }),
      ],
    });
    expect(resolveSubset(rec({ gemma_factor_id: 36158 }), d).stale).toBe(true);
  });

  // ── Rung 3: the axis's own name, against an unidentified factor ──
  //
  // 🛑 Every fixture here gives the design at least ONE identified
  // factor. cab, 2026-08-20: "rung 2 answers before rung 3 whenever the
  // design carries no Gemma ids anywhere" — without an identified
  // sibling the row never reaches rung 3 and the test passes for the
  // wrong reason. It cost them a test; it would have cost us one too.

  it("rescues a factor gold rebuilt, via category", () => {
    // GSE157138 polished/gold, cab's measured shape: the right factor
    // sits at gemma_factor_id null beside identified siblings because
    // the id backfill never reached it. 8 such rescues over the corpus.
    const d = design({
      factors: [
        factor({ id: 1, name: "cell type", category: { label: "cell type", uri: null }, gemma_factor_id: null }),
        factor({ id: 2, name: "genotype", category: { label: "genotype", uri: null }, gemma_factor_id: 42005 }),
      ],
    });
    const { factor: f, stale, basis } = resolveSubset(
      rec({ by_factor_id: 1, gemma_factor_id: 42004, category: "cell type" }),
      d,
    );
    expect(f?.id).toBe(1);
    expect(basis).toBe("category");
    expect(stale).toBe(false);
  });

  it("🛑 will not take a same-category factor carrying a DIFFERENT Gemma id", () => {
    // cab's rule: that is a different factor, and this really is stale.
    const d = design({
      factors: [
        factor({ id: 1, name: "cell type", category: { label: "cell type", uri: null }, gemma_factor_id: 99999 }),
      ],
    });
    const { factor: f, stale } = resolveSubset(
      rec({ by_factor_id: 1, gemma_factor_id: 42004, category: "cell type" }),
      d,
    );
    expect(f).toBeNull();
    expect(stale).toBe(true);
  });

  it("🛑 refuses to guess between two unidentified factors of one category", () => {
    // Our tightening beyond cab's wording, which they then adopted
    // verbatim: measured 8 rescues / 0 ambiguous, so it is free on real
    // data and strictly safer. A wrong factor that RENDERS is worse
    // than a row that stops being offered.
    const d = design({
      factors: [
        factor({ id: 1, name: "cell type", category: { label: "cell type", uri: null }, gemma_factor_id: null }),
        factor({ id: 2, name: "cell type 2", category: { label: "cell type", uri: null }, gemma_factor_id: null }),
        factor({ id: 3, name: "genotype", category: { label: "genotype", uri: null }, gemma_factor_id: 42005 }),
      ],
    });
    const { factor: f, stale } = resolveSubset(
      rec({ by_factor_id: 1, gemma_factor_id: 42004, category: "cell type" }),
      d,
    );
    expect(f).toBeNull();
    expect(stale).toBe(true);
  });

  it("matches the category against the factor's NAME as well as its category", () => {
    const d = design({
      factors: [
        factor({ id: 1, name: "collection of material", category: { label: "block", uri: null }, gemma_factor_id: null }),
        factor({ id: 2, name: "genotype", category: { label: "genotype", uri: null }, gemma_factor_id: 42005 }),
      ],
    });
    const { factor: f, basis } = resolveSubset(
      rec({ gemma_factor_id: 42004, category: "collection of material" }),
      d,
    );
    expect(f?.id).toBe(1);
    expect(basis).toBe("category");
  });

  it("reports which rung answered", () => {
    const d = design({ factors: [factor({ id: 1, gemma_factor_id: 36160 })] });
    expect(resolveSubset(rec({ gemma_factor_id: 36160 }), d).basis).toBe("gemma_id");
    expect(resolveSubset(rec({ by_factor_id: 1 }), design()).basis).toBe("local_id");
    expect(resolveSubset(rec(), design()).basis).toBe("local_id");
  });

  it("a deleted factor is stale on the local id alone", () => {
    const d = design({ factors: [factor({ id: 7 })] });
    expect(resolveSubset(rec({ by_factor_id: 1 }), d).stale).toBe(true);
  });

  it("🛑 levels CORROBORATE, they never condemn", () => {
    // Reversed 2026-08-20 on cab's measurement. Comparing level LABELS
    // called 3 of 63 rows stale that were not — Gemma renders its own
    // value labels while the curated FV carries free text:
    //   GSE69630   rec `a549 cell`          FV `a549`
    //   GSE20396   rec `ganglionic layer…`  FV `retina ganglion cell layer`
    // Two spellings of one concept are one concept. Factor identity
    // decides staleness; levels are a note at most.
    const { stale, factor } = resolveSubset(
      rec({ level_labels: ["hippocampus proper"] }),
      design(),
    );
    expect(stale).toBe(false);
    expect(factor?.id).toBe(1);
  });

  it("notes URI-grounded level drift without calling it stale", () => {
    const d = design({
      factors: [
        factor({
          factor_values: [
            {
              id: 10,
              free_text_label: "frontal cortex",
              is_baseline: false,
              biomaterial_short_names: [],
              numeric_value: null,
              statements: [
                {
                  category: { label: "organism part", uri: null },
                  subject: {
                    label: "frontal cortex",
                    uri: "http://purl.obolibrary.org/obo/UBERON_0001870",
                  },
                },
              ],
            },
          ],
        }),
      ],
    });
    const { stale, driftedLevels } = resolveSubset(
      rec({
        level_labels: ["Ammon's horn", "frontal cortex"],
        level_uris: [
          "http://purl.obolibrary.org/obo/UBERON_0001954",
          "http://purl.obolibrary.org/obo/UBERON_0001870",
        ],
      }),
      d,
    );
    expect(stale).toBe(false);
    // Names the CURIE, not a label. See below for why.
    expect(driftedLevels).toEqual(["UBERON:0001954"]);
  });

  it("names the drifted LABEL when the row carries paired `levels`", () => {
    // agents `c8fe0cc`: `levels: [{label, uri}]` is the canonical form
    // and cannot desynchronise, so the note can name the level again
    // instead of a bare CURIE.
    const d = groundedDesign();
    const { stale, driftedLevels } = resolveSubset(
      rec({
        levels: [
          { label: "Ammon's horn", uri: "http://purl.obolibrary.org/obo/UBERON_0001954" },
          { label: "frontal cortex", uri: "http://purl.obolibrary.org/obo/UBERON_0001870" },
        ],
      }),
      d,
    );
    expect(stale).toBe(false);
    expect(driftedLevels).toEqual(["Ammon's horn"]);
  });

  it("🛑 an ungrounded pair ABSTAINS — `uri: \"\"` is kept, not dropped", () => {
    // cab keeps the pair with an empty URI so `levels` stays aligned
    // with `level_labels`. Empty means "we cannot say", never "gone".
    const { driftedLevels } = resolveSubset(
      rec({
        levels: [
          { label: "frontal cortex", uri: "http://purl.obolibrary.org/obo/UBERON_0001870" },
          { label: "some ungrounded level", uri: "" },
        ],
      }),
      groundedDesign(),
    );
    expect(driftedLevels).toEqual([]);
  });

  it("prefers `levels` over the flat projections when both are present", () => {
    // The flat lists are independently-sorted projections; where they
    // disagree with the pairs, the pairs win.
    const { driftedLevels } = resolveSubset(
      rec({
        levels: [
          { label: "frontal cortex", uri: "http://purl.obolibrary.org/obo/UBERON_0001870" },
        ],
        level_labels: ["Ammon's horn", "frontal cortex"],
        level_uris: ["http://purl.obolibrary.org/obo/CL_0000210"],
      }),
      groundedDesign(),
    );
    expect(driftedLevels).toEqual([]);
  });

  it("GSE20396 — names the level that actually drifted", () => {
    // The case both sides argued about, with the real data. Gemma's
    // axis carries `photoreceptor cell` (CL_0000210); the curated
    // factor carries `photoreceptor layer of retina` (UBERON_0001787).
    // A cell is not a tissue layer, so that IS a real difference and is
    // worth a note — while the other four levels match exactly.
    //
    // Zipping the flat lists named `ganglionic layer of retina` here
    // (CL sorts before UBERON, so it lands at index 0), which is a
    // level that did NOT drift. With `levels` the note names the right
    // one.
    const uber = (n: string) => `http://purl.obolibrary.org/obo/UBERON_${n}`;
    const fv = (id: number, label: string, uri: string) => ({
      id,
      free_text_label: label,
      is_baseline: false,
      biomaterial_short_names: [],
      numeric_value: null,
      statements: [
        {
          category: { label: "organism part", uri: null },
          subject: { label, uri },
        },
      ],
    });
    const d = design({
      factors: [
        factor({
          id: 2,
          gemma_factor_id: 26256,
          factor_values: [
            fv(1, "retina ganglion cell layer", uber("0001792")),
            fv(2, "retina inner nuclear layer", uber("0001791")),
            fv(3, "retina inner plexiform layer", uber("0001795")),
            fv(4, "retina photoreceptor layer", uber("0001787")),
            fv(5, "retina whole retina", uber("0000966")),
          ],
        }),
      ],
    });
    const { stale, driftedLevels } = resolveSubset(
      rec({
        gemma_factor_id: 26256,
        levels: [
          { label: "ganglionic layer of retina", uri: uber("0001792") },
          { label: "inner nuclear layer of retina", uri: uber("0001791") },
          { label: "inner plexiform layer of retina", uri: uber("0001795") },
          { label: "photoreceptor cell", uri: "http://purl.obolibrary.org/obo/CL_0000210" },
          { label: "retina", uri: uber("0000966") },
        ],
      }),
      d,
    );
    // 🛑 A note, never a verdict — identity decides staleness.
    expect(stale).toBe(false);
    expect(driftedLevels).toEqual(["photoreceptor cell"]);
  });

  it("🛑 treats level_uris as a SET — the two arrays are not parallel", () => {
    // Measured over the 60 grounded rows: 15 differ in LENGTH from
    // `level_labels`, and all 60 have both arrays independently sorted
    // ascending, so index i lines up only by coincidence. On GSE20396
    // zipping puts `CL_0000210` (retinal ganglion cell) on the label
    // `ganglionic layer of retina`. A note that names the wrong level
    // is worse than one that names a CURIE.
    const d = design({
      factors: [
        factor({
          factor_values: [
            {
              id: 10,
              free_text_label: "retina ganglion cell layer",
              is_baseline: false,
              biomaterial_short_names: [],
              numeric_value: null,
              statements: [
                {
                  category: { label: "organism part", uri: null },
                  subject: {
                    label: "ganglionic layer of retina",
                    uri: "http://purl.obolibrary.org/obo/UBERON_0001792",
                  },
                },
              ],
            },
          ],
        }),
      ],
    });
    const { driftedLevels } = resolveSubset(
      rec({
        // One label, two URIs — a shape that cannot be zipped at all.
        level_labels: ["ganglionic layer of retina"],
        level_uris: [
          "http://purl.obolibrary.org/obo/CL_0000210",
          "http://purl.obolibrary.org/obo/UBERON_0001792",
        ],
      }),
      d,
    );
    expect(driftedLevels).toEqual(["CL:0000210"]);
  });

  it("abstains on drift when the factor carries no URIs at all", () => {
    // 9 of 69 axes are ungrounded. An ungrounded level must ABSTAIN,
    // never read as "gone".
    const { driftedLevels } = resolveSubset(
      rec({
        level_labels: ["Ammon's horn"],
        level_uris: ["http://purl.obolibrary.org/obo/UBERON_0001954"],
      }),
      design(),
    );
    expect(driftedLevels).toEqual([]);
  });

  it("empty level_labels is every level, not missing levels", () => {
    // This IS subset-DEA — one analysis per level — and it is the
    // common shape, so it must never read as drift.
    const { stale, matchedLevels } = resolveSubset(
      rec({ level_labels: [] }),
      design(),
    );
    expect(stale).toBe(false);
    expect(matchedLevels).toEqual([]);
  });

  it("matches the levels it does name", () => {
    const { matchedLevels } = resolveSubset(
      rec({ level_labels: ["Ammon's horn", "frontal cortex"] }),
      design(),
    );
    expect(matchedLevels.map((fv) => fv.id)).toEqual([10, 11]);
  });
});

describe("liveSubsets — what a curator is actually offered", () => {
  it("drops rejected, silent and stale ones", () => {
    const d = design({
      factors: [factor({ id: 1, gemma_factor_id: 36160 })],
      subset_recommendations: [
        rec({ id: "live" }),
        rec({ id: "no", status: "rejected" }),
        rec({ id: "tier1", tier: "none" }),
        rec({ id: "gone", gemma_factor_id: 99999 }),
      ],
    });
    expect(liveSubsets(d).map((r) => r.id)).toEqual(["live"]);
  });

  it("a convention-tier notice is still live — quiet is not hidden", () => {
    const d = design({
      subset_recommendations: [rec({ tier: "convention" })],
    });
    expect(liveSubsets(d)).toHaveLength(1);
  });

  it("no design, no recommendations", () => {
    expect(liveSubsets(null)).toEqual([]);
    expect(liveSubsets(design())).toEqual([]);
  });
});

describe("summariseSubsets — the collapsed line", () => {
  it("names the factor rather than counting", () => {
    // "1 subset" tells a reviewer nothing they can act on.
    const d = design({ subset_recommendations: [rec()] });
    expect(summariseSubsets(d)).toBe("subset by organism part");
  });

  it("joins two", () => {
    const d = design({
      factors: [factor({ id: 1 }), factor({ id: 2, name: "cell line" })],
      subset_recommendations: [
        rec({ id: "a", by_factor_id: 1 }),
        rec({ id: "b", by_factor_id: 2 }),
      ],
    });
    expect(summariseSubsets(d)).toBe("subset by organism part and cell line");
  });

  it("counts the tail past two", () => {
    const d = design({
      factors: [
        factor({ id: 1 }),
        factor({ id: 2, name: "cell line" }),
        factor({ id: 3, name: "disease" }),
      ],
      subset_recommendations: [
        rec({ id: "a", by_factor_id: 1 }),
        rec({ id: "b", by_factor_id: 2 }),
        rec({ id: "c", by_factor_id: 3 }),
      ],
    });
    expect(summariseSubsets(d)).toBe("subset by organism part and 2 more");
  });

  it("returns null when there is genuinely nothing — that is the one time 'none recorded' is honest", () => {
    expect(summariseSubsets(design())).toBeNull();
    expect(summariseSubsets(null)).toBeNull();
  });
});

describe("summariseSplit", () => {
  it("null is no decision", () => {
    expect(summariseSplit(design())).toBeNull();
  });

  it("-1 is the curator's explicit no", () => {
    expect(summariseSplit(design({ should_split_on_factor_id: -1 }))).toBe(
      "no-split asserted",
    );
  });

  it("a positive id names the axis", () => {
    expect(summariseSplit(design({ should_split_on_factor_id: 1 }))).toBe(
      "split on organism part",
    );
  });

  it("survives an id pointing at a factor that is gone", () => {
    expect(summariseSplit(design({ should_split_on_factor_id: 9 }))).toBe(
      "split on factor 9",
    );
  });
});

describe("labels", () => {
  it("Gemma states a fact; the agent makes a recommendation", () => {
    expect(sourceChip(rec({ source: "gemma" }))).toBe("from Gemma");
    expect(sourceChip(rec({ source: "agent" }))).toBe("from agent");
    expect(sourceChip(rec({ source: "curator" }))).toBe("yours");
  });

  it("prefers the producer's own axis name over a bare id", () => {
    // `category` survives a rename and a rebuild, which neither id
    // does — so it is the label of last resort, not the id.
    expect(
      subsetFactorLabel(
        rec({ by_factor_id: 9, category: "cell line" }),
        design(),
      ),
    ).toBe("cell line");
  });

  it("names an unresolved factor by id when there is nothing better", () => {
    expect(subsetFactorLabel(rec({ by_factor_id: 9 }), design())).toBe(
      "factor 9",
    );
  });

  it("🛑 returns null for a row that names no axis — never '(no factor)'", () => {
    // That string is what put "SUBSET BY (NO FACTOR) AND CELL TYPE" in
    // the collapsed summary. A row with no axis is a note; callers
    // render it as one.
    const note = rec({ by_factor_id: null, gemma_factor_id: null, category: "" });
    expect(subsetFactorLabel(note, design())).toBeNull();
    expect(namesAnAxis(note)).toBe(false);
    // ...and it is NOT stale. There is nothing for it to have drifted
    // from.
    expect(resolveSubset(note, design()).stale).toBe(false);
  });
});

describe("countRejectedSubsets — the no-vote still counts as recorded", () => {
  it("counts what the curator turned off", () => {
    const d = design({
      subset_recommendations: [
        rec({ id: "a", status: "rejected" }),
        rec({ id: "b" }),
      ],
    });
    expect(countRejectedSubsets(d)).toBe(1);
    // ...and it contributes nothing to what applies.
    expect(liveSubsets(d).map((r) => r.id)).toEqual(["b"]);
  });

  it("ignores a tier-1 row — there was nothing to reject", () => {
    const d = design({
      subset_recommendations: [rec({ status: "rejected", tier: "none" })],
    });
    expect(countRejectedSubsets(d)).toBe(0);
  });

  it("is zero on a design with nothing", () => {
    expect(countRejectedSubsets(design())).toBe(0);
    expect(countRejectedSubsets(null)).toBe(0);
  });
});

describe("tierTitle — the classifier's sentence beats the generic blurb", () => {
  it("prefers tier_evidence when the wire sent one", () => {
    // Live shape on GSE43825 (eid 8528), the corpus's only tier-4 row.
    const evidence =
      "the framing pass flags this series as packing more than one study " +
      "along this axis, so the subset is necessary rather than conventional";
    expect(tierTitle(rec({ tier: "two_in_one", tier_evidence: evidence }))).toBe(
      evidence,
    );
  });

  it("falls back to what the tier means in general", () => {
    expect(tierTitle(rec({ tier: "qa" }))).toBe(TIER_META.qa.blurb);
  });

  it("treats whitespace-only evidence as absent", () => {
    expect(tierTitle(rec({ tier: "qa", tier_evidence: "   " }))).toBe(
      TIER_META.qa.blurb,
    );
  });

  it("has nothing to say about an unclassified row", () => {
    expect(tierTitle(rec())).toBeUndefined();
  });
});

describe("two_in_one is an AXIS claim, not an experiment claim", () => {
  it("names the axis as the seam", () => {
    // cab, 2026-08-20: "a flagged experiment is not a flagged axis".
    // 4 of 50 audited experiments carry should_split; exactly 1 has a
    // Gemma subset axis that is the seam. If a "may be two studies"
    // banner is ever built it is experiment-level and must not read
    // this chip.
    expect(TIER_META.two_in_one.blurb).toMatch(/this axis is the seam/i);
  });
});
