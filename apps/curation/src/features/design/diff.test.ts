import { describe, expect, it } from "vitest";
import { diffDesign, summariseSemanticDiff } from "./diff";
import type {
  Biomaterial,
  Design,
  Publication,
  SubsetRecommendation,
} from "@/features/experiment/types";

/**
 * Regression tests for the diff blind spot identified in the
 * 2026-06-13 continuity sweep.
 *
 * Before the fix, ``diffDesign`` only compared ``factors`` and
 * ``tags``. Curator edits to title / description / short_name /
 * biomaterials / publications all left ``isDirty=false``, which:
 *
 *   - hid the CommitBar (so the curator couldn't commit),
 *   - cleared the localStorage draft cache (so a refresh nuked
 *     the edits),
 *   - allowed background ``/design`` refetch to silently
 *     overwrite the curator's work.
 *
 * Every test here pins one slice of the new diff contract. They
 * fail loud on regression.
 */

const baseBm = (overrides: Partial<Biomaterial> = {}): Biomaterial => ({
  short_name: "S1",
  name: "Sample 1",
  characteristics: { tissue: "kidney" },
  ...overrides,
});

const baseDesign = (overrides: Partial<Design> = {}): Design => ({
  experiment_id: 1,
  experiment_short_name: "GSE-test",
  factors: [],
  biomaterials: [baseBm()],
  tags: [],
  title: "title A",
  description: "desc A",
  publications: [],
  ...overrides,
});

describe("diffDesign — metadata diff (continuity sweep 2026-06-13)", () => {
  it("isDirty=false when nothing changed", () => {
    const d = baseDesign();
    const r = diffDesign(d, d);
    expect(r.isDirty).toBe(false);
    expect(r.metadata.shortNameChanged).toBe(false);
    expect(r.metadata.titleChanged).toBe(false);
    expect(r.metadata.descriptionChanged).toBe(false);
    expect(r.metadata.biomaterialsModified).toBe(0);
    expect(r.metadata.publicationsAdded).toBe(0);
    expect(r.metadata.publicationsRemoved).toBe(0);
  });

  it("flips isDirty when the experiment short_name changes", () => {
    const saved = baseDesign();
    const draft = baseDesign({ experiment_short_name: "GSE-test renamed" });
    const r = diffDesign(saved, draft);
    expect(r.isDirty).toBe(true);
    expect(r.metadata.shortNameChanged).toBe(true);
  });

  it("flips isDirty when the title changes", () => {
    const saved = baseDesign();
    const draft = baseDesign({ title: "title B" });
    const r = diffDesign(saved, draft);
    expect(r.isDirty).toBe(true);
    expect(r.metadata.titleChanged).toBe(true);
  });

  it("flips isDirty when the description changes", () => {
    const saved = baseDesign();
    const draft = baseDesign({ description: "desc B" });
    const r = diffDesign(saved, draft);
    expect(r.isDirty).toBe(true);
    expect(r.metadata.descriptionChanged).toBe(true);
  });

  it("treats missing vs empty title as equivalent (no false positive)", () => {
    const saved = baseDesign({ title: undefined });
    const draft = baseDesign({ title: "" });
    const r = diffDesign(saved, draft);
    expect(r.metadata.titleChanged).toBe(false);
  });

  it("counts a biomaterial name change", () => {
    const saved = baseDesign({ biomaterials: [baseBm({ name: "Sample 1" })] });
    const draft = baseDesign({ biomaterials: [baseBm({ name: "Sample 1-renamed" })] });
    const r = diffDesign(saved, draft);
    expect(r.isDirty).toBe(true);
    expect(r.metadata.biomaterialsModified).toBe(1);
  });

  it("counts a characteristic value change", () => {
    const saved = baseDesign({
      biomaterials: [baseBm({ characteristics: { tissue: "kidney" } })],
    });
    const draft = baseDesign({
      biomaterials: [baseBm({ characteristics: { tissue: "liver" } })],
    });
    const r = diffDesign(saved, draft);
    expect(r.isDirty).toBe(true);
    expect(r.metadata.biomaterialsModified).toBe(1);
  });

  it("counts a characteristic key addition", () => {
    const saved = baseDesign({
      biomaterials: [baseBm({ characteristics: { tissue: "kidney" } })],
    });
    const draft = baseDesign({
      biomaterials: [
        baseBm({ characteristics: { tissue: "kidney", age: "12 weeks" } }),
      ],
    });
    const r = diffDesign(saved, draft);
    expect(r.metadata.biomaterialsModified).toBe(1);
  });

  it("counts a characteristic_uris value change", () => {
    const saved = baseDesign({
      biomaterials: [
        baseBm({
          characteristic_uris: { tissue: { value_uri: "UBERON:001" } },
        }),
      ],
    });
    const draft = baseDesign({
      biomaterials: [
        baseBm({
          characteristic_uris: { tissue: { value_uri: "UBERON:002" } },
        }),
      ],
    });
    const r = diffDesign(saved, draft);
    expect(r.metadata.biomaterialsModified).toBe(1);
  });

  it("ignores property-order in characteristics (no false positive)", () => {
    const saved = baseDesign({
      biomaterials: [
        baseBm({ characteristics: { a: "1", b: "2" } }),
      ],
    });
    const draft = baseDesign({
      biomaterials: [
        baseBm({ characteristics: { b: "2", a: "1" } }),
      ],
    });
    const r = diffDesign(saved, draft);
    expect(r.metadata.biomaterialsModified).toBe(0);
  });

  it("counts each modified biomaterial independently", () => {
    const saved = baseDesign({
      biomaterials: [
        baseBm({ short_name: "S1", name: "A" }),
        baseBm({ short_name: "S2", name: "B" }),
        baseBm({ short_name: "S3", name: "C" }),
      ],
    });
    const draft = baseDesign({
      biomaterials: [
        baseBm({ short_name: "S1", name: "A renamed" }),
        baseBm({ short_name: "S2", name: "B" }),
        baseBm({ short_name: "S3", name: "C renamed" }),
      ],
    });
    const r = diffDesign(saved, draft);
    expect(r.metadata.biomaterialsModified).toBe(2);
  });

  it("counts publication adds", () => {
    const pub: Publication = {
      pubmed_id: "12345",
      doi: "10.0000/x",
      citation: "c",
      title: "t",
    };
    const saved = baseDesign({ publications: [] });
    const draft = baseDesign({ publications: [pub] });
    const r = diffDesign(saved, draft);
    expect(r.isDirty).toBe(true);
    expect(r.metadata.publicationsAdded).toBe(1);
    expect(r.metadata.publicationsRemoved).toBe(0);
  });

  it("counts publication removes", () => {
    const pub: Publication = {
      pubmed_id: "12345",
      doi: "",
      citation: "",
      title: "t",
    };
    const saved = baseDesign({ publications: [pub] });
    const draft = baseDesign({ publications: [] });
    const r = diffDesign(saved, draft);
    expect(r.metadata.publicationsRemoved).toBe(1);
  });

  it("matches publications by pubmed_id (no false add+remove)", () => {
    const a: Publication = {
      pubmed_id: "12345",
      doi: "10.0000/old",
      citation: "c old",
      title: "t",
    };
    const b: Publication = {
      pubmed_id: "12345",
      doi: "10.0000/new",
      citation: "c new",
      title: "t",
    };
    const saved = baseDesign({ publications: [a] });
    const draft = baseDesign({ publications: [b] });
    const r = diffDesign(saved, draft);
    expect(r.metadata.publicationsAdded).toBe(0);
    expect(r.metadata.publicationsRemoved).toBe(0);
  });

  it("matches publications by doi when pubmed_id is empty", () => {
    const a: Publication = {
      pubmed_id: "",
      doi: "10.0000/x",
      citation: "c old",
      title: "t",
    };
    const b: Publication = {
      pubmed_id: "",
      doi: "10.0000/x",
      citation: "c new",
      title: "t",
    };
    const saved = baseDesign({ publications: [a] });
    const draft = baseDesign({ publications: [b] });
    const r = diffDesign(saved, draft);
    expect(r.metadata.publicationsAdded).toBe(0);
    expect(r.metadata.publicationsRemoved).toBe(0);
  });
});

describe("diffDesign — existing factor / tag invariants still hold", () => {
  it("returns the EMPTY_DIFF shape when either side is null", () => {
    const r = diffDesign(null, baseDesign());
    expect(r.isDirty).toBe(false);
    expect(r.metadata).toBeDefined();
    expect(r.metadata.biomaterialsModified).toBe(0);
  });
});

describe("diffDesign — statement-shaped tag edits dirty the draft (2026-07-21)", () => {
  const term = (label: string, uri: string | null = null) => ({ label, uri });
  const genotypeTag = (objectLabel: string) => ({
    id: 5,
    category: term("genotype", "http://www.ebi.ac.uk/efo/EFO_0000513"),
    value: term("Abca4", "http://purl.org/commons/record/ncbi_gene/11304"),
    statements: [
      {
        category: term("genotype", "http://www.ebi.ac.uk/efo/EFO_0000513"),
        subject: term("Abca4", "http://purl.org/commons/record/ncbi_gene/11304"),
        predicate: term("has_genotype", "http://purl.obolibrary.org/obo/GENO_0000222"),
        object: term(objectLabel),
      },
    ],
  });

  it("flips isDirty when only a tag's statement OBJECT changes", () => {
    const saved = baseDesign({ tags: [genotypeTag("Homozygous negative")] });
    const draft = baseDesign({ tags: [genotypeTag("Overexpression")] });
    const r = diffDesign(saved, draft);
    expect(r.isDirty).toBe(true);
    expect(r.tags.modified).toHaveLength(1);
  });

  it("stays clean when the tag (incl. statements) is unchanged", () => {
    const saved = baseDesign({ tags: [genotypeTag("Homozygous negative")] });
    const draft = baseDesign({ tags: [genotypeTag("Homozygous negative")] });
    const r = diffDesign(saved, draft);
    expect(r.isDirty).toBe(false);
    expect(r.tags.modified).toHaveLength(0);
  });
});

describe("summariseSemanticDiff — inherited rows are not tags (2026-08-09)", () => {
  // GSE102352's gold polished row holds one real tag plus two
  // projections of constant biomaterial characteristics. Against the
  // agent's proposal the readout said "TAGS -3" — the agent dropped
  // one thing, not three. An `inferred` row is Gemma's display of a
  // sample characteristic; neither curation lineage asserted it, so
  // neither can add or remove it. Handoff
  // AGENTS_ASK_2026_08_09_TICKET_SHOULD_PIN_ITS_BASELINE, addendum.
  const term = (label: string, uri: string | null = null) => ({ label, uri });
  const tag = (
    id: number,
    cat: string,
    val: string,
    inferred = false,
  ) => ({ id, category: term(cat), value: term(val), inferred });

  const GOLD = baseDesign({
    tags: [
      tag(1, "assay", "bulk RNA-seq assay"),
      tag(2, "biological sex", "female", true),
      tag(3, "cell type", "induced pluripotent stem cell line cell", true),
    ],
  });

  it("counts only the real tag as removed", () => {
    const proposal = baseDesign({ tags: [] });
    const s = summariseSemanticDiff(GOLD, proposal);
    expect(s.removedTags).toBe(1);
    expect(s.addedTags).toBe(0);
  });

  it("calls two designs equal when they differ only in inherited rows", () => {
    const noProjections = baseDesign({
      tags: [tag(1, "assay", "bulk RNA-seq assay")],
    });
    const s = summariseSemanticDiff(GOLD, noProjections);
    expect(s.empty).toBe(true);
  });

  it("reads a curated projection as an ADDED tag", () => {
    // The reviewer turning an inherited row into a real EE-tag is a
    // genuine curation act, and now says so.
    const curated = baseDesign({
      tags: [
        tag(1, "assay", "bulk RNA-seq assay"),
        tag(3, "cell type", "induced pluripotent stem cell line cell"),
      ],
    });
    const s = summariseSemanticDiff(GOLD, curated);
    expect(s.addedTags).toBe(1);
    expect(s.removedTags).toBe(0);
  });

  it("leaves an all-real tag comparison untouched", () => {
    const a = baseDesign({ tags: [tag(1, "assay", "bulk RNA-seq assay")] });
    const b = baseDesign({ tags: [tag(9, "disease", "melanoma")] });
    const s = summariseSemanticDiff(a, b);
    expect(s.addedTags).toBe(1);
    expect(s.removedTags).toBe(1);
  });
});

/**
 * The same blind spot the 2026-06-13 sweep closed, one section over:
 * the experiment-wide decisions.
 *
 * ``should_split_on_factor_id`` / ``should_split_rationale`` and
 * ``subset_recommendations`` live on the Design and serialize with
 * it, but the diff never looked at them. A curator who accepted a
 * subset recommendation, or recorded "do NOT split", left the draft
 * reading clean — commit bar dark, cached draft CLEARED rather than
 * written, decision gone on the next refresh. The decision surface
 * that produces them is the only place they can be made, so nothing
 * else would have caught it.
 */
describe("diffDesign — experiment-wide decisions dirty the draft", () => {
  const rec = (
    over: Partial<SubsetRecommendation> = {},
  ): SubsetRecommendation => ({
    id: "agent:run-1:subset:rec",
    by_factor_id: 7,
    level_labels: [],
    rationale: "possible subset on axis: cell type",
    status: "agent_recommended",
    source: "agent",
    ...over,
  });

  it("recording a split axis flips isDirty", () => {
    const saved = baseDesign();
    const draft = baseDesign({ should_split_on_factor_id: 4 });
    const r = diffDesign(saved, draft);
    expect(r.metadata.splitDecisionChanged).toBe(true);
    expect(r.isDirty).toBe(true);
  });

  // ``-1`` is an assertion ("do NOT split"), not the absence of one.
  // Folding it into ``null`` would make the strongest decision on this
  // panel the one edit that can't be saved.
  it("asserting do-NOT-split flips isDirty", () => {
    const r = diffDesign(
      baseDesign(),
      baseDesign({ should_split_on_factor_id: -1 }),
    );
    expect(r.metadata.splitDecisionChanged).toBe(true);
    expect(r.isDirty).toBe(true);
  });

  it("editing only the split rationale flips isDirty", () => {
    const saved = baseDesign({ should_split_on_factor_id: 4 });
    const draft = baseDesign({
      should_split_on_factor_id: 4,
      should_split_rationale: "two arms shipped as one series",
    });
    const r = diffDesign(saved, draft);
    expect(r.metadata.splitDecisionChanged).toBe(true);
    expect(r.isDirty).toBe(true);
  });

  it("accepting an agent subset recommendation flips isDirty", () => {
    const saved = baseDesign({ subset_recommendations: [rec()] });
    const draft = baseDesign({
      subset_recommendations: [rec({ status: "accepted" })],
    });
    const r = diffDesign(saved, draft);
    expect(r.metadata.subsetRecommendationsChanged).toBe(1);
    expect(r.isDirty).toBe(true);
  });

  it("a curator-added subset counts as one change", () => {
    const saved = baseDesign({ subset_recommendations: [] });
    const draft = baseDesign({
      subset_recommendations: [
        rec({
          id: "curator:subset:7:1",
          source: "curator",
          status: "accepted",
          rationale: "",
        }),
      ],
    });
    const r = diffDesign(saved, draft);
    expect(r.metadata.subsetRecommendationsChanged).toBe(1);
    expect(r.isDirty).toBe(true);
  });

  it("removing one counts too — an undo is an edit", () => {
    const saved = baseDesign({ subset_recommendations: [rec()] });
    const draft = baseDesign({ subset_recommendations: [] });
    const r = diffDesign(saved, draft);
    expect(r.metadata.subsetRecommendationsChanged).toBe(1);
    expect(r.isDirty).toBe(true);
  });

  it("rationale and levels are edits, not decoration", () => {
    const saved = baseDesign({ subset_recommendations: [rec()] });
    expect(
      diffDesign(
        saved,
        baseDesign({ subset_recommendations: [rec({ rationale: "why" })] }),
      ).isDirty,
    ).toBe(true);
    expect(
      diffDesign(
        saved,
        baseDesign({
          subset_recommendations: [rec({ level_labels: ["tumour"] })],
        }),
      ).isDirty,
    ).toBe(true);
  });

  it("an untouched decision set stays clean", () => {
    const d = baseDesign({
      should_split_on_factor_id: -1,
      should_split_rationale: "one arm",
      subset_recommendations: [rec({ status: "accepted" })],
    });
    const r = diffDesign(d, structuredClone(d));
    expect(r.metadata.splitDecisionChanged).toBe(false);
    expect(r.metadata.subsetRecommendationsChanged).toBe(0);
    expect(r.isDirty).toBe(false);
  });
});
