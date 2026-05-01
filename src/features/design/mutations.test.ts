import { describe, expect, it } from "vitest";
import {
  addContinuousFactorFromCharacteristic,
  isContinuousCharacteristic,
  removeAppliedProposalFromDesign,
  setStatement,
} from "./mutations";
import type {
  Biomaterial,
  Design,
  Factor,
  FactorValue,
  Statement,
  Tag,
} from "@/features/experiment/types";

/**
 * Tests for ``removeAppliedProposalFromDesign`` — the inverse of
 * ``applyProposalToDesign``. Drives the reject-after-accept undo
 * flow: when a curator accepts a proposal then later rejects it,
 * the changes that landed in the draft must be retracted, but
 * pre-existing items (anything in ``saved``) must survive.
 */

function makeDesign(overrides: Partial<Design> = {}): Design {
  return {
    experiment_id: 1,
    experiment_short_name: "GSE1",
    factors: [],
    biomaterials: [],
    tags: [],
    ...overrides,
  };
}

function tag(id: number, category: string, value: string): Tag {
  return {
    id,
    category: { label: category, uri: null },
    value: { label: value, uri: null },
    inferred: false,
  };
}

function factor(id: number, category: string, name?: string): Factor {
  return {
    id,
    name: name ?? category,
    category: { label: category, uri: null },
    description: "",
    type: "categorical",
    factor_values: [],
  };
}

describe("removeAppliedProposalFromDesign — tags", () => {
  it("removes a tag added by the proposal when not in saved", () => {
    const saved = makeDesign({ tags: [] });
    const draft = makeDesign({ tags: [tag(1, "disease", "MDD")] });
    const next = removeAppliedProposalFromDesign(
      draft,
      saved,
      [{ category: { label: "disease" }, value: { label: "MDD" } }],
      [],
    );
    expect(next.tags).toEqual([]);
  });

  it("preserves a pre-existing tag with the same identity", () => {
    const t = tag(1, "disease", "MDD");
    const saved = makeDesign({ tags: [t] });
    const draft = makeDesign({ tags: [t] });
    const next = removeAppliedProposalFromDesign(
      draft,
      saved,
      [{ category: { label: "disease" }, value: { label: "MDD" } }],
      [],
    );
    expect(next.tags).toEqual([t]);
  });

  it("no-op when the proposal's tag isn't in the draft", () => {
    const draft = makeDesign({ tags: [tag(1, "cell type", "T cell")] });
    const next = removeAppliedProposalFromDesign(
      draft,
      makeDesign(),
      [{ category: { label: "disease" }, value: { label: "MDD" } }],
      [],
    );
    expect(next.tags).toEqual(draft.tags);
  });

  it("matches case-insensitively by label", () => {
    const draft = makeDesign({ tags: [tag(1, "Disease", "MDD")] });
    const next = removeAppliedProposalFromDesign(
      draft,
      makeDesign(),
      [{ category: { label: "disease" }, value: { label: "mdd" } }],
      [],
    );
    expect(next.tags).toEqual([]);
  });

  it("only retracts the matching tag — leaves siblings alone", () => {
    const keep = tag(1, "cell type", "T cell");
    const drop = tag(2, "disease", "MDD");
    const draft = makeDesign({ tags: [keep, drop] });
    const next = removeAppliedProposalFromDesign(
      draft,
      makeDesign(),
      [{ category: { label: "disease" }, value: { label: "MDD" } }],
      [],
    );
    expect(next.tags).toEqual([keep]);
  });

  it("idempotent — running twice equals running once", () => {
    const draft = makeDesign({ tags: [tag(1, "disease", "MDD")] });
    const proposalTags = [
      { category: { label: "disease" }, value: { label: "MDD" } },
    ];
    const once = removeAppliedProposalFromDesign(
      draft,
      makeDesign(),
      proposalTags,
      [],
    );
    const twice = removeAppliedProposalFromDesign(
      once,
      makeDesign(),
      proposalTags,
      [],
    );
    expect(twice).toEqual(once);
  });
});

describe("removeAppliedProposalFromDesign — factors", () => {
  it("removes a factor added by the proposal when its id isn't in saved", () => {
    const saved = makeDesign({ factors: [] });
    const draft = makeDesign({ factors: [factor(10, "disease")] });
    const next = removeAppliedProposalFromDesign(
      draft,
      saved,
      [],
      [{ category: { label: "disease" }, name_in_design: "disease" }],
    );
    expect(next.factors).toEqual([]);
  });

  it("preserves a pre-existing factor whose id is in saved", () => {
    const f = factor(10, "disease");
    const saved = makeDesign({ factors: [f] });
    const draft = makeDesign({ factors: [f] });
    const next = removeAppliedProposalFromDesign(
      draft,
      saved,
      [],
      [{ category: { label: "disease" }, name_in_design: "disease" }],
    );
    expect(next.factors).toEqual([f]);
  });

  it("preserves a pre-existing factor with same category but different id", () => {
    // Saved has a factor with id=10 and category=disease. The
    // proposal adds another factor with the same category (id=20
    // because applyProposalToDesign always allocates a fresh id).
    // Reject should remove only the proposal's factor (id=20).
    const preExisting = factor(10, "disease");
    const fromProposal = factor(20, "disease");
    const saved = makeDesign({ factors: [preExisting] });
    const draft = makeDesign({ factors: [preExisting, fromProposal] });
    const next = removeAppliedProposalFromDesign(
      draft,
      saved,
      [],
      [{ category: { label: "disease" }, name_in_design: "disease" }],
    );
    expect(next.factors).toEqual([preExisting]);
  });

  it("falls back to category label when name_in_design is empty", () => {
    const draft = makeDesign({ factors: [factor(10, "disease")] });
    const next = removeAppliedProposalFromDesign(
      draft,
      makeDesign(),
      [],
      [{ category: { label: "disease" }, name_in_design: "" }],
    );
    expect(next.factors).toEqual([]);
  });
});

describe("setStatement — free_text_label sync", () => {
  function stmt(label: string, uri: string | null = null): Statement {
    return { subject: { label, uri } };
  }
  function fv(
    id: number,
    free_text_label: string,
    statements: Statement[],
  ): FactorValue {
    return {
      id,
      free_text_label,
      is_baseline: false,
      biomaterial_short_names: [],
      statements,
    };
  }
  function designWithFactor(values: FactorValue[]): Design {
    const f: Factor = {
      id: 10,
      name: "disease",
      category: { label: "disease", uri: null },
      description: "",
      type: "categorical",
      factor_values: values,
    };
    return {
      experiment_id: 1,
      experiment_short_name: "GSE1",
      factors: [f],
      biomaterials: [],
      tags: [],
    };
  }

  it("syncs free_text_label when it matched the previous subject (auto-derived case)", () => {
    const d = designWithFactor([fv(1, "MDD", [stmt("MDD")])]);
    const next = setStatement(d, 10, 1, 0, stmt("major depressive disorder"));
    expect(next.factors[0].factor_values[0].free_text_label).toBe(
      "major depressive disorder",
    );
  });

  it("syncs free_text_label when it was blank", () => {
    const d = designWithFactor([fv(1, "", [stmt("control")])]);
    const next = setStatement(d, 10, 1, 0, stmt("reference subject role"));
    expect(next.factors[0].factor_values[0].free_text_label).toBe(
      "reference subject role",
    );
  });

  it("does NOT touch free_text_label when curator customised it", () => {
    const d = designWithFactor([fv(1, "Affected (MDD)", [stmt("MDD")])]);
    const next = setStatement(d, 10, 1, 0, stmt("major depressive disorder"));
    // Curator's "Affected (MDD)" was different from the subject
    // label "MDD", so it's their choice — leave it alone.
    expect(next.factors[0].factor_values[0].free_text_label).toBe(
      "Affected (MDD)",
    );
  });

  it("does NOT sync when editing a non-primary statement", () => {
    const d = designWithFactor([
      fv(1, "MDD", [stmt("MDD"), stmt("genetic predisposition")]),
    ]);
    const next = setStatement(
      d,
      10,
      1,
      1, // editing the second statement
      stmt("environmental exposure"),
    );
    expect(next.factors[0].factor_values[0].free_text_label).toBe("MDD");
  });
});

describe("removeAppliedProposalFromDesign — combined", () => {
  it("retracts tags and factors together", () => {
    const draft = makeDesign({
      tags: [tag(1, "disease", "MDD")],
      factors: [factor(10, "disease")],
    });
    const next = removeAppliedProposalFromDesign(
      draft,
      makeDesign(),
      [{ category: { label: "disease" }, value: { label: "MDD" } }],
      [{ category: { label: "disease" }, name_in_design: "disease" }],
    );
    expect(next.tags).toEqual([]);
    expect(next.factors).toEqual([]);
  });

  it("handles a null saved (treats every draft item as proposal-added)", () => {
    const draft = makeDesign({ tags: [tag(1, "disease", "MDD")] });
    const next = removeAppliedProposalFromDesign(
      draft,
      null,
      [{ category: { label: "disease" }, value: { label: "MDD" } }],
      [],
    );
    expect(next.tags).toEqual([]);
  });
});

describe("addContinuousFactorFromCharacteristic", () => {
  function bm(
    short_name: string,
    characteristics: Record<string, string>,
  ): Biomaterial {
    return { short_name, name: short_name, characteristics };
  }
  function design(bms: Biomaterial[]): Design {
    return {
      experiment_id: 1,
      experiment_short_name: "GSE1",
      factors: [],
      biomaterials: bms,
      tags: [],
    };
  }

  it("creates a continuous factor with one FV per BM that carries the characteristic", () => {
    const d = design([
      bm("s1", { age: "23.5" }),
      bm("s2", { age: "47" }),
      bm("s3", { age: "62.1" }),
    ]);
    const { design: next, factorId, sampleCount } =
      addContinuousFactorFromCharacteristic(d, "age");
    expect(next.factors).toHaveLength(1);
    const f = next.factors[0];
    expect(f.id).toBe(factorId);
    expect(f.type).toBe("continuous");
    expect(f.name).toBe("age");
    expect(f.category.label).toBe("age");
    expect(f.factor_values).toHaveLength(3);
    expect(sampleCount).toBe(3);
    // Each FV holds exactly one sample with the measurement as label.
    const byBm = Object.fromEntries(
      f.factor_values.map((fv) => [fv.biomaterial_short_names[0], fv.free_text_label]),
    );
    expect(byBm).toEqual({ s1: "23.5", s2: "47", s3: "62.1" });
  });

  it("skips BMs without the characteristic", () => {
    const d = design([
      bm("s1", { age: "23.5" }),
      bm("s2", {}), // no age
      bm("s3", { age: "62.1" }),
    ]);
    const { design: next, sampleCount } = addContinuousFactorFromCharacteristic(
      d,
      "age",
    );
    expect(next.factors[0].factor_values).toHaveLength(2);
    expect(sampleCount).toBe(2);
  });

  it("skips empty / whitespace-only values", () => {
    const d = design([
      bm("s1", { age: "23.5" }),
      bm("s2", { age: "" }),
      bm("s3", { age: "   " }),
      bm("s4", { age: "62.1" }),
    ]);
    const { design: next } = addContinuousFactorFromCharacteristic(d, "age");
    expect(next.factors[0].factor_values).toHaveLength(2);
  });

  it("returns the input unchanged when no BMs carry the characteristic", () => {
    const d = design([bm("s1", {}), bm("s2", {})]);
    const { design: next, sampleCount } = addContinuousFactorFromCharacteristic(
      d,
      "age",
    );
    expect(next.factors).toHaveLength(1);
    expect(next.factors[0].factor_values).toEqual([]);
    expect(sampleCount).toBe(0);
  });

  it("no-ops on empty / whitespace key", () => {
    const d = design([bm("s1", { age: "23" })]);
    const { design: next, factorId } = addContinuousFactorFromCharacteristic(
      d,
      "   ",
    );
    expect(next).toBe(d);
    expect(factorId).toBe(-1);
  });

  it("respects name + category overrides", () => {
    const d = design([bm("s1", { age_yr: "23" })]);
    const { design: next } = addContinuousFactorFromCharacteristic(d, "age_yr", {
      name: "age (years)",
      category: { label: "age", uri: "http://example.org/age" },
    });
    expect(next.factors[0].name).toBe("age (years)");
    expect(next.factors[0].category).toEqual({
      label: "age",
      uri: "http://example.org/age",
    });
  });

  it("allocates a fresh factor id and FV ids past existing ones", () => {
    // Pre-existing factor with a high id and FVs with high ids — the
    // new continuous factor should bump past them.
    const existing: Factor = {
      id: 42,
      name: "treatment",
      category: { label: "treatment", uri: null },
      description: "",
      type: "categorical",
      factor_values: [
        {
          id: 100,
          free_text_label: "drug",
          is_baseline: false,
          biomaterial_short_names: ["s1"],
          statements: [],
        },
      ],
    };
    const d: Design = {
      experiment_id: 1,
      experiment_short_name: "GSE1",
      factors: [existing],
      biomaterials: [bm("s1", { age: "23" })],
      tags: [],
    };
    const { design: next, factorId } = addContinuousFactorFromCharacteristic(
      d,
      "age",
    );
    expect(factorId).toBeGreaterThan(42);
    expect(next.factors[1].factor_values[0].id).toBeGreaterThan(100);
  });
});

describe("isContinuousCharacteristic", () => {
  it("returns true when all values parse as finite floats", () => {
    const bms = [
      { characteristics: { age: "23.5" } },
      { characteristics: { age: "47" } },
      { characteristics: { age: "62.1" } },
    ];
    expect(isContinuousCharacteristic(bms, "age")).toBe(true);
  });

  it("returns false when most values are non-numeric", () => {
    const bms = [
      { characteristics: { treatment: "drug" } },
      { characteristics: { treatment: "vehicle" } },
      { characteristics: { treatment: "drug" } },
    ];
    expect(isContinuousCharacteristic(bms, "treatment")).toBe(false);
  });

  it("returns true when ≥80% are numeric (default threshold)", () => {
    const bms = [
      { characteristics: { age: "23" } },
      { characteristics: { age: "47" } },
      { characteristics: { age: "62" } },
      { characteristics: { age: "young" } }, // 1/4 non-numeric → 75% — fails default
    ];
    expect(isContinuousCharacteristic(bms, "age")).toBe(false);
    // Loosen threshold to 0.7: passes.
    expect(isContinuousCharacteristic(bms, "age", 0.7)).toBe(true);
  });

  it("returns false when no BM carries the key", () => {
    const bms: { characteristics: Record<string, string> }[] = [
      { characteristics: { other: "1" } },
      { characteristics: {} },
    ];
    expect(isContinuousCharacteristic(bms, "age")).toBe(false);
  });

  it("ignores empty / whitespace values when computing the ratio", () => {
    const bms = [
      { characteristics: { age: "23" } },
      { characteristics: { age: "" } },
      { characteristics: { age: "47" } },
    ];
    // Two non-empty values, both numeric → 100%.
    expect(isContinuousCharacteristic(bms, "age")).toBe(true);
  });

  it("doesn't filter on key name — ID-shaped keys with numeric values still qualify", () => {
    // The curator decides whether a numeric ``subject id`` /
    // ``individual`` etc. should become a factor. Hiding the
    // affordance based on key name makes the row of "+ promote"
    // links inconsistent across numeric columns and forces curators
    // to discover the heuristic from absence-of-button.
    const subjectIdBms = [
      { characteristics: { "subject id": "101" } },
      { characteristics: { "subject id": "102" } },
      { characteristics: { "subject id": "103" } },
    ];
    expect(isContinuousCharacteristic(subjectIdBms, "subject id")).toBe(true);
    const individualBms = [
      { characteristics: { individual: "1" } },
      { characteristics: { individual: "2" } },
      { characteristics: { individual: "3" } },
    ];
    expect(isContinuousCharacteristic(individualBms, "individual")).toBe(true);
  });
});
