import { describe, expect, it } from "vitest";
import { buildEditLog, type CurationEdit, type EditBase } from "./editLog";
import type {
  Design,
  Factor,
  FactorValue,
  Tag,
} from "@/features/experiment/types";

/**
 * The three failures this log exists to prevent, each pinned by a
 * test. All three were measured on live landings
 * (`UI_WRITE_THE_EDIT_NOT_THE_DESIGN_2026_08_17`) — none is
 * hypothetical, and each one cost a landing or a revert.
 *
 *   1. a seeded row that carried no edit competing with gold
 *   2. an untouched factor riding along in the snapshot and
 *      deadlocking a rebuild — twice
 *   3. blank-vs-missing: 38 refusals across 24 experiments
 */

const BASE: EditBase = { source_kind: "design", content_hash: "hash-abc" };

const fv = (overrides: Partial<FactorValue> = {}): FactorValue => ({
  id: 1,
  free_text_label: "control",
  is_baseline: true,
  statements: [],
  biomaterial_short_names: ["S1"],
  ...overrides,
});

const factor = (overrides: Partial<Factor> = {}): Factor => ({
  id: 10,
  name: "treatment",
  category: { label: "treatment", uri: "http://purl.obolibrary.org/obo/EFO_0000727" },
  description: "drug vs vehicle",
  type: "categorical",
  gemma_factor_id: 23079,
  factor_values: [fv()],
  ...overrides,
});

const tag = (overrides: Partial<Tag> = {}): Tag => ({
  id: 5,
  category: { label: "organism part", uri: "obo:UBERON_0000955" },
  value: { label: "brain", uri: "obo:UBERON_0000955" },
  ...overrides,
});

const design = (overrides: Partial<Design> = {}): Design => ({
  experiment_id: 42,
  experiment_short_name: "GSE96826",
  factors: [factor()],
  biomaterials: [],
  tags: [tag()],
  title: "a title",
  description: "a description",
  publications: [],
  ...overrides,
});

const build = (saved: Design | null, draft: Design | null) =>
  buildEditLog({
    experimentId: 42,
    saved,
    draft,
    base: BASE,
    reviewer: "paul",
    at: "2026-08-17T20:00:00Z",
  });

/** Every edit touching a given field, whatever the target. */
const withField = (edits: CurationEdit[], field: string) =>
  edits.filter((e) => e.field === field);

describe("buildEditLog — the envelope", () => {
  it("records who, when, and WHICH DOCUMENT the edit was made against", () => {
    const log = build(design(), design({ title: "changed" }));
    expect(log.experiment_id).toBe(42);
    expect(log.at).toBe("2026-08-17T20:00:00Z");
    expect(log.actor).toEqual({ kind: "curator", name: "paul" });
    // The field that retires the ``ui-base → store-gold →
    // pinned-commit`` fallback chain. Without it the reconcile guessed,
    // and on 2026-08-17 guessed "a git commit" 62 times out of 63.
    expect(log.base.content_hash).toBe("hash-abc");
    expect(log.base.source_kind).toBe("design");
  });

  it("says the author is unknown rather than inventing one", () => {
    const log = buildEditLog({
      experimentId: 42,
      saved: design(),
      draft: design({ title: "changed" }),
      base: BASE,
      reviewer: "",
    });
    expect(log.actor.name).toBe("");
  });

  it("is empty, not absent, when there is no design to diff", () => {
    expect(build(null, design()).edits).toEqual([]);
    expect(build(design(), null).edits).toEqual([]);
  });
});

describe("failure 1 — a commit with no edit in it says so", () => {
  it("logs nothing when the curator changed nothing", () => {
    const d = design();
    expect(build(d, d).edits).toEqual([]);
  });

  it("logs nothing for a draft that is a distinct but equal object", () => {
    // The seeded-row case: the buffer was populated from a baseline
    // and committed untouched. A snapshot of that is indistinguishable
    // from a real edit and nearly reverted two factor descriptions and
    // an FV relabel on GSE143419. An empty log cannot compete.
    expect(build(design(), design()).edits).toEqual([]);
  });
});

describe("failure 2 — only what moved is in the log", () => {
  it("omits a factor the curator never touched", () => {
    // GSE96826: the edit was a tag; the snapshot also carried the
    // `disease` factor as it stood, which later disagreed with a 6-arm
    // partition ruled into gold and refused the rebuild twice.
    const disease = factor({
      id: 11,
      name: "disease",
      category: { label: "disease", uri: "obo:MONDO_0000001" },
      factor_values: [fv({ id: 2, free_text_label: "healthy" })],
    });
    const saved = design({ factors: [factor(), disease] });
    const draft = design({
      factors: [factor(), disease],
      tags: [tag(), tag({ id: 6, value: { label: "cortex", uri: "obo:UBERON_0001851" } })],
    });
    const { edits } = build(saved, draft);
    expect(edits).toHaveLength(1);
    expect(edits[0].op).toBe("add");
    expect(edits[0].target.kind).toBe("tag");
    expect(edits.some((e) => e.target.label === "disease")).toBe(false);
  });
});

describe("failure 3 — blank and missing are different answers", () => {
  it("records an emptied factor description as an erase, not as absence", () => {
    const saved = design({ factors: [factor({ description: "drug vs vehicle" })] });
    const draft = design({ factors: [factor({ description: "" })] });
    const [edit] = withField(build(saved, draft).edits, "description");
    expect(edit.op).toBe("modify");
    expect(edit.before).toBe("drug vs vehicle");
    // "" — the curator cleared it. NOT null.
    expect(edit.after).toBe("");
  });

  it("records a never-set description as null, not as an empty string", () => {
    const saved = design({
      factors: [factor({ description: undefined as unknown as string })],
    });
    const draft = design({ factors: [factor({ description: "now described" })] });
    const [edit] = withField(build(saved, draft).edits, "description");
    expect(edit.before).toBeNull();
    expect(edit.after).toBe("now described");
  });

  it("does not confuse an absent description with a blank one", () => {
    const saved = design({
      factors: [factor({ description: undefined as unknown as string })],
    });
    const draft = design({ factors: [factor({ description: "" })] });
    const [edit] = withField(build(saved, draft).edits, "description");
    expect(edit.before).toBeNull();
    expect(edit.after).toBe("");
  });
});

describe("buildEditLog — factors", () => {
  it("logs an added factor with its content", () => {
    const added = factor({ id: 99, name: "genotype" });
    const draft = design({ factors: [factor(), added] });
    const [edit] = build(design(), draft).edits;
    expect(edit.op).toBe("add");
    expect(edit.target.kind).toBe("factor");
    expect(edit.field).toBeNull();
    expect(edit.before).toBeNull();
    expect(edit.after).toMatchObject({ name: "genotype" });
  });

  it("logs a removed factor with what was removed", () => {
    const [edit] = build(design(), design({ factors: [] })).edits;
    expect(edit.op).toBe("remove");
    expect(edit.after).toBeNull();
    expect(edit.before).toMatchObject({ name: "treatment" });
  });

  it("names a renamed factor by how it read BEFORE the edit", () => {
    // A rename that identified itself by its new name is unresolvable
    // against the base — the base has never heard of the new name.
    const draft = design({ factors: [factor({ name: "treatment (renamed)" })] });
    const [edit] = build(design(), draft).edits;
    expect(edit.field).toBe("name");
    expect(edit.target.label).toBe("treatment");
    expect(edit.before).toBe("treatment");
    expect(edit.after).toBe("treatment (renamed)");
  });

  it("carries every identity it holds so the reader picks the strongest", () => {
    const draft = design({ factors: [factor({ name: "renamed" })] });
    const [edit] = build(design(), draft).edits;
    expect(edit.target.gemma_factor_id).toBe(23079);
    expect(edit.target.category_uri).toBe(
      "http://purl.obolibrary.org/obo/EFO_0000727",
    );
    expect(edit.target.category_label).toBe("treatment");
  });

  it("logs one edit per field when several move at once", () => {
    const draft = design({
      factors: [
        factor({ name: "renamed", description: "new text", type: "continuous" }),
      ],
    });
    const fields = build(design(), draft).edits.map((e) => e.field);
    expect(new Set(fields)).toEqual(new Set(["name", "description", "type"]));
  });

  it("logs a category change as a term, both readings", () => {
    const draft = design({
      factors: [factor({ category: { label: "dose", uri: "obo:EFO_0000428" } })],
    });
    const [edit] = withField(build(design(), draft).edits, "category");
    expect(edit.before).toEqual({
      label: "treatment",
      uri: "http://purl.obolibrary.org/obo/EFO_0000727",
    });
    expect(edit.after).toEqual({ label: "dose", uri: "obo:EFO_0000428" });
  });
});

describe("buildEditLog — factor values", () => {
  it("names a relabelled FV by its BEFORE label and its parent factor", () => {
    const draft = design({
      factors: [factor({ factor_values: [fv({ free_text_label: "vehicle" })] })],
    });
    const [edit] = build(design(), draft).edits;
    expect(edit.op).toBe("modify");
    expect(edit.field).toBe("label");
    expect(edit.target.kind).toBe("factor_value");
    // An FV has no identity of its own — parent + before-label is how
    // one is found in gold.
    expect(edit.target.label).toBe("control");
    expect(edit.target.parent_ref_id).toBe("factor:10");
    expect(edit.target.gemma_factor_id).toBe(23079);
    expect(edit.before).toBe("control");
    expect(edit.after).toBe("vehicle");
  });

  it("splits a relabel and a repartition into separate claims", () => {
    // A reader has to be able to take one without the other.
    const draft = design({
      factors: [
        factor({
          factor_values: [
            fv({ free_text_label: "vehicle", biomaterial_short_names: ["S1", "S2"] }),
          ],
        }),
      ],
    });
    const fields = build(design(), draft).edits.map((e) => e.field);
    expect(new Set(fields)).toEqual(new Set(["label", "biomaterials"]));
  });

  it("logs a baseline flip with both readings", () => {
    const draft = design({
      factors: [factor({ factor_values: [fv({ is_baseline: false })] })],
    });
    const [edit] = withField(build(design(), draft).edits, "baseline");
    expect(edit.before).toBe(true);
    expect(edit.after).toBe(false);
  });

  it("logs an added FV against its factor", () => {
    const draft = design({
      factors: [
        factor({ factor_values: [fv(), fv({ id: 2, free_text_label: "drug" })] }),
      ],
    });
    const [edit] = build(design(), draft).edits;
    expect(edit.op).toBe("add");
    expect(edit.target.kind).toBe("factor_value");
    expect(edit.after).toMatchObject({ free_text_label: "drug" });
  });

  it("sorts sample sets so a reorder is not an edit", () => {
    const saved = design({
      factors: [factor({ factor_values: [fv({ biomaterial_short_names: ["S1", "S2"] })] })],
    });
    const draft = design({
      factors: [factor({ factor_values: [fv({ biomaterial_short_names: ["S2", "S1"] })] })],
    });
    expect(build(saved, draft).edits).toEqual([]);
  });
});

describe("buildEditLog — tags", () => {
  it("logs an added tag with its category and value", () => {
    const added = tag({ id: 6, value: { label: "cortex", uri: "obo:UBERON_0001851" } });
    const [edit] = build(design(), design({ tags: [tag(), added] })).edits;
    expect(edit.op).toBe("add");
    expect(edit.target.kind).toBe("tag");
    expect(edit.target.value_uri).toBe("obo:UBERON_0001851");
    expect(edit.after).toMatchObject({ value: { label: "cortex" } });
  });

  it("logs a removed tag with what was removed", () => {
    const [edit] = build(design(), design({ tags: [] })).edits;
    expect(edit.op).toBe("remove");
    expect(edit.before).toMatchObject({ value: { label: "brain" } });
  });

  it("logs a URI correction as a value change, named by the before-reading", () => {
    // The other half of the GSE96826 edit: a tag and a URI.
    const draft = design({
      tags: [tag({ value: { label: "brain", uri: "obo:UBERON_0000956" } })],
    });
    const [edit] = build(design(), draft).edits;
    expect(edit.field).toBe("value");
    expect(edit.target.value_uri).toBe("obo:UBERON_0000955");
    expect(edit.before).toEqual({ label: "brain", uri: "obo:UBERON_0000955" });
    expect(edit.after).toEqual({ label: "brain", uri: "obo:UBERON_0000956" });
  });

  it("logs a statement edit that leaves category and value alone", () => {
    const draft = design({
      tags: [
        tag({
          statements: [
            { subject: { label: "Abca4" }, predicate: { label: "has_genotype" }, object: { label: "KO" } },
          ],
        }),
      ],
    });
    const [edit] = build(design(), draft).edits;
    expect(edit.field).toBe("statements");
    expect(edit.before).toEqual([]);
    expect(edit.after).toHaveLength(1);
  });
});

describe("buildEditLog — the experiment itself", () => {
  it("logs a title change with both readings", () => {
    const [edit] = build(design(), design({ title: "a better title" })).edits;
    expect(edit.target.kind).toBe("design");
    expect(edit.field).toBe("title");
    expect(edit.before).toBe("a title");
    expect(edit.after).toBe("a better title");
  });

  it("distinguishes 'do NOT split' from 'no decision made'", () => {
    // -1 is an assertion; null is silence. Same class as blank-vs-missing.
    const draft = design({ should_split_on_factor_id: -1 });
    const [edit] = build(design(), draft).edits;
    expect(edit.field).toBe("should_split_on_factor_id");
    expect(edit.before).toBeNull();
    expect(edit.after).toBe(-1);
  });

  it("logs an added publication", () => {
    const draft = design({
      publications: [
        { pubmed_id: "12345", doi: "10.1/x", title: "T", citation: "C" },
      ],
    });
    const [edit] = build(design(), draft).edits;
    expect(edit.op).toBe("add");
    expect(edit.target.kind).toBe("publication");
    expect(edit.after).toMatchObject({ pubmed_id: "12345" });
  });

  it("logs a characteristic edit per key, keeping the submitter's spelling", () => {
    // 🛑 `Genetic modification` is a name the submitter wrote. It is
    // data, not schema, and must survive verbatim into the field path.
    const saved = design({
      biomaterials: [
        {
          short_name: "S1",
          name: "Sample 1",
          characteristics: { "Genetic modification": "wild type", tissue: "brain" },
        },
      ],
    });
    const draft = design({
      biomaterials: [
        {
          short_name: "S1",
          name: "Sample 1",
          characteristics: { "Genetic modification": "Abca4 KO", tissue: "brain" },
        },
      ],
    });
    const { edits } = build(saved, draft);
    expect(edits).toHaveLength(1);
    expect(edits[0].field).toBe("characteristics.Genetic modification");
    expect(edits[0].before).toMatchObject({ value: "wild type" });
    expect(edits[0].after).toMatchObject({ value: "Abca4 KO" });
  });
});
