/**
 * Contract tests for the per-part factor adoption used by the "Choose
 * what to adopt" dialog.
 *
 * The worked case throughout is GSE96826 (eid 15112), the experiment
 * that produced UI_PARTITION_SWAP_HAS_NO_APPLY_PATH_2026_08_17: Gemma
 * carries a 4-value `disease` factor; the agent proposes a 3-value
 * `genotype` over the same 11 samples, with a better-grounded SCA3
 * term. Every partial combination the curator can tick is a case here,
 * because the failure mode this dialog exists to prevent is silent —
 * a pick that records as accepted and changes nothing.
 */
import { describe, expect, it } from "vitest";
import type {
  Design,
  Factor,
  FactorValue,
} from "@/features/experiment/types";
import type { FactorProposal } from "@/api/types";
import {
  adoptCoverage,
  applyFactorAdoptPlan,
  buildFactorAdoptPlan,
  canApplyFactorAdoptPlan,
  planHasPicks,
  summarizeFactorAdoptPlan,
} from "./adoptFactorPlan";

const MONDO_SCA2 = "http://purl.obolibrary.org/obo/MONDO_0008458";
const MONDO_MJD_SUBTYPE = "http://purl.obolibrary.org/obo/MONDO_0017176";
const MONDO_SCA3 = "http://purl.obolibrary.org/obo/MONDO_0007182";
const OBI_REFERENCE = "http://purl.obolibrary.org/obo/OBI_0000220";
const EFO_DISEASE = "http://www.ebi.ac.uk/efo/EFO_0000408";

function fv(
  id: number,
  label: string,
  bms: string[],
  subjectUri: string | null = null,
): FactorValue {
  return {
    id,
    free_text_label: label,
    is_baseline: false,
    biomaterial_short_names: bms,
    statements: [{ subject: { label, uri: subjectUri } }],
  };
}

function pfv(
  label: string,
  bms: string[],
  subjectUri: string | null = null,
) {
  return {
    free_text_label: label,
    is_baseline: false,
    biomaterial_short_names: bms,
    statements: [{ category: null, subject: { label, uri: subjectUri }, predicate: null, object: null }],
  };
}

/** Gemma's 4-value `disease` factor. */
function goldFactor(): Factor {
  return {
    id: 1,
    name: "disease",
    category: { label: "disease", uri: EFO_DISEASE },
    description: "",
    type: "categorical",
    factor_values: [
      fv(10, "spinocerebellar ataxia type 2 derived from cell fibroblast of dermis", ["S1", "S2"], MONDO_SCA2),
      fv(11, "Machado-Joseph disease derived from cell fibroblast of dermis", ["S3", "S4", "S5", "S6"], MONDO_MJD_SUBTYPE),
      fv(12, "reference subject role", ["S7", "S8", "S9"], OBI_REFERENCE),
      fv(13, "spinocerebellar ataxia type 2 derived from cell peripheral blood mononuclear cell", ["S10", "S11"], MONDO_SCA2),
    ],
  };
}

/** The agent's 3-value `genotype` over the same samples. */
function agentFactor(): FactorProposal {
  return {
    category: { label: "genotype", uri: null },
    name_in_design: "genotype",
    factor_type: "categorical",
    factor_values: [
      pfv("control", ["S7", "S8", "S9"], OBI_REFERENCE),
      pfv("SCA2", ["S1", "S2", "S10", "S11"], MONDO_SCA2),
      pfv("SCA3", ["S3", "S4", "S5", "S6"], MONDO_SCA3),
    ],
  } as FactorProposal;
}

function design(factors: Factor[]): Design {
  return {
    experiment_id: 15112,
    experiment_short_name: "GSE96826",
    factors,
    biomaterials: [],
    tags: [],
  } as unknown as Design;
}

function labelsOf(f: Factor): string[] {
  return f.factor_values.map((v) => v.free_text_label);
}

function only(d: Design): Factor {
  expect(d.factors).toHaveLength(1);
  return d.factors[0];
}

describe("buildFactorAdoptPlan", () => {
  it("pairs each agent level to the draft level it mostly covers", () => {
    const plan = buildFactorAdoptPlan(goldFactor(), agentFactor());
    const byKey = new Map(plan.pairs.map((p) => [p.key, p]));

    // control ↔ reference subject role (identical sample set).
    expect(byKey.get("fv:0")?.currentFvId).toBe(12);
    // SCA2 absorbs the fibroblast FV (2 of its 4 samples) — the PBMC
    // FV is left over, which is what makes this a repartition.
    expect(byKey.get("fv:1")?.currentFvId).toBe(10);
    expect(byKey.get("fv:2")?.currentFvId).toBe(11);
    expect(byKey.get("cur:13")?.agentFvIndex).toBeNull();
  });

  it("ticks every part that differs, and nothing that doesn't", () => {
    const plan = buildFactorAdoptPlan(goldFactor(), agentFactor());
    expect(plan.categoryDiffers).toBe(true);
    expect(plan.picks.category).toBe(true);
    expect(plan.partitionDiffers).toBe(true);
    expect(plan.picks.partition).toBe(true);
    // `control` vs `reference subject role`: same URI, different
    // label → label pick on, statement pick off.
    expect(plan.picks.fvLabel["fv:0"]).toBe(true);
    expect(plan.picks.fvStatements["fv:0"]).toBe(false);
    // SCA3: the agent grounds it on MONDO_0007182 where gold has the
    // type-3 subtype — a real statement difference.
    expect(plan.picks.fvStatements["fv:2"]).toBe(true);
  });

  it("reports no partition change when only labels moved", () => {
    const gold: Factor = {
      ...goldFactor(),
      factor_values: [
        fv(10, "wild type", ["S1", "S2"]),
        fv(11, "knockout", ["S3"]),
      ],
    };
    const agent = {
      category: { label: "genotype", uri: null },
      name_in_design: "genotype",
      factor_values: [pfv("WT", ["S1", "S2"]), pfv("KO", ["S3"])],
    } as FactorProposal;

    const plan = buildFactorAdoptPlan(gold, agent);
    expect(plan.partitionDiffers).toBe(false);
    expect(plan.picks.partition).toBe(false);
    expect(plan.picks.fvLabel["fv:0"]).toBe(true);
  });
});

describe("applyFactorAdoptPlan — everything ticked", () => {
  it("rewrites the factor in place, rebinding samples", () => {
    const d = design([goldFactor()]);
    const plan = buildFactorAdoptPlan(d.factors[0], agentFactor());
    const next = only(applyFactorAdoptPlan(d, plan));

    expect(next.id).toBe(1);
    expect(next.category.label).toBe("genotype");
    expect(next.name).toBe("genotype");
    expect(labelsOf(next)).toEqual(["control", "SCA2", "SCA3"]);
    // The samples moved with the levels — the half of the operation
    // no existing verb performs.
    expect(
      next.factor_values.find((v) => v.free_text_label === "SCA2")!
        .biomaterial_short_names,
    ).toEqual(["S1", "S2", "S10", "S11"]);
    // Paired levels keep their ids so downstream references survive.
    expect(
      next.factor_values.find((v) => v.free_text_label === "control")!.id,
    ).toBe(12);
    expect(
      next.factor_values.find((v) => v.free_text_label === "SCA3")!.id,
    ).toBe(11);
  });

  it("takes the agent's better SCA3 grounding", () => {
    const d = design([goldFactor()]);
    const plan = buildFactorAdoptPlan(d.factors[0], agentFactor());
    const next = only(applyFactorAdoptPlan(d, plan));
    const sca3 = next.factor_values.find((v) => v.free_text_label === "SCA3")!;
    expect(sca3.statements[0].subject.uri).toBe(MONDO_SCA3);
  });

  it("is idempotent — applying twice neither duplicates nor deletes", () => {
    // The trap the ledger side hit building `replace_factor`: an adopt
    // composed as drop-then-add lands once, then deletes its own
    // result on replay. An in-place rewrite has no second pass to get
    // wrong.
    const d = design([goldFactor()]);
    const plan = buildFactorAdoptPlan(d.factors[0], agentFactor());
    const once = applyFactorAdoptPlan(d, plan);
    const twice = applyFactorAdoptPlan(once, plan);

    expect(twice.factors).toHaveLength(1);
    expect(labelsOf(only(twice))).toEqual(labelsOf(only(once)));
    expect(only(twice).factor_values.map((v) => v.id)).toEqual(
      only(once).factor_values.map((v) => v.id),
    );
  });

  it("leaves sibling factors untouched", () => {
    const sibling: Factor = {
      id: 2,
      name: "organism part",
      category: { label: "organism part", uri: null },
      description: "",
      type: "categorical",
      factor_values: [fv(20, "fibroblast", ["S1", "S2"])],
    };
    const d = design([goldFactor(), sibling]);
    const plan = buildFactorAdoptPlan(d.factors[0], agentFactor());
    const next = applyFactorAdoptPlan(d, plan);

    expect(next.factors).toHaveLength(2);
    expect(next.factors[1]).toEqual(sibling);
  });

  it("does not mutate the design handed in", () => {
    const d = design([goldFactor()]);
    const plan = buildFactorAdoptPlan(d.factors[0], agentFactor());
    applyFactorAdoptPlan(d, plan);
    expect(d.factors[0].category.label).toBe("disease");
    expect(d.factors[0].factor_values).toHaveLength(4);
  });
});

describe("applyFactorAdoptPlan — partial picks", () => {
  it("category only: renames the factor, leaves all four levels alone", () => {
    const d = design([goldFactor()]);
    const plan = buildFactorAdoptPlan(d.factors[0], agentFactor());
    plan.picks.partition = false;
    plan.picks.fvLabel = {};
    plan.picks.fvStatements = {};

    const next = only(applyFactorAdoptPlan(d, plan));
    expect(next.category.label).toBe("genotype");
    expect(next.category.uri).toBeNull();
    expect(next.factor_values).toHaveLength(4);
    expect(labelsOf(next)).toEqual(labelsOf(goldFactor()));
    expect(next.factor_values.map((v) => v.biomaterial_short_names)).toEqual(
      goldFactor().factor_values.map((v) => v.biomaterial_short_names),
    );
  });

  it("one statement only: regrounds that level and nothing else", () => {
    const d = design([goldFactor()]);
    const plan = buildFactorAdoptPlan(d.factors[0], agentFactor());
    plan.picks.category = false;
    plan.picks.partition = false;
    plan.picks.fvLabel = {};
    plan.picks.fvStatements = { "fv:2": true };

    const next = only(applyFactorAdoptPlan(d, plan));
    expect(next.category.label).toBe("disease");
    expect(next.factor_values).toHaveLength(4);
    // The MJD level keeps its label but takes the agent's URI.
    const mjd = next.factor_values.find((v) => v.id === 11)!;
    expect(mjd.free_text_label).toBe(
      "Machado-Joseph disease derived from cell fibroblast of dermis",
    );
    expect(mjd.statements[0].subject.uri).toBe(MONDO_SCA3);
    // Every other level is byte-identical to what it was.
    for (const id of [10, 12, 13]) {
      expect(next.factor_values.find((v) => v.id === id)).toEqual(
        goldFactor().factor_values.find((v) => v.id === id),
      );
    }
  });

  it("one label only: relabels that level, keeping its statement", () => {
    const d = design([goldFactor()]);
    const plan = buildFactorAdoptPlan(d.factors[0], agentFactor());
    plan.picks.category = false;
    plan.picks.partition = false;
    plan.picks.fvLabel = { "fv:0": true };
    plan.picks.fvStatements = {};

    const next = only(applyFactorAdoptPlan(d, plan));
    const level = next.factor_values.find((v) => v.id === 12)!;
    expect(level.free_text_label).toBe("control");
    expect(level.statements[0].subject.uri).toBe(OBI_REFERENCE);
    expect(level.biomaterial_short_names).toEqual(["S7", "S8", "S9"]);
  });

  it("partition without labels: regroups the samples, keeps the curator's names", () => {
    const d = design([goldFactor()]);
    const plan = buildFactorAdoptPlan(d.factors[0], agentFactor());
    plan.picks.category = false;
    plan.picks.fvLabel = {};
    plan.picks.fvStatements = {};

    const next = only(applyFactorAdoptPlan(d, plan));
    expect(next.category.label).toBe("disease");
    expect(next.factor_values).toHaveLength(3);
    expect(labelsOf(next)).toEqual([
      "reference subject role",
      "spinocerebellar ataxia type 2 derived from cell fibroblast of dermis",
      "Machado-Joseph disease derived from cell fibroblast of dermis",
    ]);
    expect(
      next.factor_values.find((v) => v.id === 10)!.biomaterial_short_names,
    ).toEqual(["S1", "S2", "S10", "S11"]);
  });

  it("keeps the curator's baseline flag on a paired level", () => {
    // The curator owns the baseline; adopting a partition must not
    // silently rewrite it from the agent's guess.
    const gold = goldFactor();
    gold.factor_values[2] = { ...gold.factor_values[2], is_baseline: true };
    const agent = agentFactor();
    agent.factor_values[0] = { ...agent.factor_values[0], is_baseline: false };

    const d = design([gold]);
    const plan = buildFactorAdoptPlan(d.factors[0], agent);
    const next = only(applyFactorAdoptPlan(d, plan));

    expect(next.factor_values.find((v) => v.id === 12)!.is_baseline).toBe(true);
  });

  it("does not count a level only the proposal has as a change on its own", () => {
    // Its label and statements are force-ticked (there is no "keep
    // current" alternative for a level that doesn't exist yet), but
    // without the partition it never lands — so on its own it must not
    // enable Apply. GSE96826's leftover PBMC level is the mirror case.
    const gold: Factor = {
      ...goldFactor(),
      category: { label: "genotype", uri: null },
      factor_values: [fv(10, "control", ["S1"])],
    };
    const agent = {
      category: { label: "genotype", uri: null },
      name_in_design: "genotype",
      factor_values: [pfv("control", ["S1"]), pfv("treated", ["S2"])],
    } as FactorProposal;

    const plan = buildFactorAdoptPlan(gold, agent);
    expect(plan.picks.fvLabel["fv:1"]).toBe(true);
    plan.picks.partition = false;

    expect(planHasPicks(plan)).toBe(false);
    expect(applyFactorAdoptPlan(design([gold]), plan)).toEqual(design([gold]));
  });

  it("changes nothing when every box is cleared", () => {
    const d = design([goldFactor()]);
    const plan = buildFactorAdoptPlan(d.factors[0], agentFactor());
    plan.picks = {
      category: false,
      partition: false,
      fvLabel: {},
      fvStatements: {},
    };

    expect(planHasPicks(plan)).toBe(false);
    expect(applyFactorAdoptPlan(d, plan)).toEqual(d);
  });
});

describe("landing pad", () => {
  it("re-resolves by category when the factor id has gone", () => {
    const d = design([goldFactor()]);
    const plan = buildFactorAdoptPlan(d.factors[0], agentFactor());
    // The draft got rebuilt between building the plan and applying it
    // — same factor, new id.
    const rebuilt = design([{ ...goldFactor(), id: 99 }]);

    expect(canApplyFactorAdoptPlan(rebuilt, plan)).toBe(true);
    expect(only(applyFactorAdoptPlan(rebuilt, plan)).category.label).toBe(
      "genotype",
    );
  });

  it("refuses to land when the factor is gone entirely", () => {
    const d = design([goldFactor()]);
    const plan = buildFactorAdoptPlan(d.factors[0], agentFactor());
    const empty = design([]);

    expect(canApplyFactorAdoptPlan(empty, plan)).toBe(false);
    expect(applyFactorAdoptPlan(empty, plan)).toEqual(empty);
  });
});

describe("adoptCoverage", () => {
  it("names the samples that change level", () => {
    const plan = buildFactorAdoptPlan(goldFactor(), agentFactor());
    const cov = adoptCoverage(plan);
    expect(cov.dropped).toEqual([]);
    expect(cov.added).toEqual([]);
    expect(cov.moved).toEqual(["S10", "S11"]);
  });

  it("names samples the agent's partition would leave uncovered", () => {
    const gold = goldFactor();
    const agent = agentFactor();
    // Agent forgot the PBMC pair entirely.
    agent.factor_values[1] = {
      ...agent.factor_values[1],
      biomaterial_short_names: ["S1", "S2"],
    };

    const cov = adoptCoverage(buildFactorAdoptPlan(gold, agent));
    expect(cov.dropped).toEqual(["S10", "S11"]);
  });
});

describe("summarizeFactorAdoptPlan", () => {
  it("names each part taken so a partial adopt is legible on the record", () => {
    const plan = buildFactorAdoptPlan(goldFactor(), agentFactor());
    plan.picks.partition = false;
    plan.picks.fvLabel = {};
    plan.picks.fvStatements = { "fv:2": true };

    const s = summarizeFactorAdoptPlan(plan);
    expect(s).toContain("factor disease");
    expect(s).toContain("category disease → genotype");
    expect(s).toContain("statements on SCA3");
    expect(s).not.toContain("partition");
  });

  it("reports the level counts on a partition adopt", () => {
    const plan = buildFactorAdoptPlan(goldFactor(), agentFactor());
    expect(summarizeFactorAdoptPlan(plan)).toContain(
      "partition (4 → 3 values)",
    );
  });
});
