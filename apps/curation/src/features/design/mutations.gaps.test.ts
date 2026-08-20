/**
 * Tests for three high-stakes mutations in mutations.ts:
 *
 *   1. toggleBaseline — baseline-statement injection via baselineFor,
 *      gated on hasRealStatement / fvHasBaselineStatement.
 *   2. mergeNearMatchAgentFactor — goldStubsReplaced dedup logic
 *      (stub rows replaced, not duplicated, by richer agent S-P-O).
 *   3. adoptNearMatchAgentFactor — category URI lookup first, label
 *      fallback, graceful no-op when neither matches.
 */

import { describe, expect, it } from "vitest";
import {
  toggleBaseline,
  mergeNearMatchAgentFactor,
  adoptNearMatchAgentFactor,
} from "./mutations";
import type { Design, Factor, FactorValue, Statement } from "@/features/experiment/types";
import type { FactorProposal, FactorValueProposal } from "@/api/types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeDesign(factors: Factor[], overrides: Partial<Design> = {}): Design {
  return {
    experiment_id: 1,
    experiment_short_name: "GSE1",
    factors,
    biomaterials: [],
    tags: [],
    ...overrides,
  };
}

function makeFv(
  id: number,
  overrides: Partial<FactorValue> = {},
): FactorValue {
  return {
    id,
    free_text_label: "",
    is_baseline: false,
    biomaterial_short_names: [],
    statements: [],
    ...overrides,
  };
}

function makeFactor(
  id: number,
  categoryLabel: string,
  fvs: FactorValue[],
  categoryUri: string | null = null,
): Factor {
  return {
    id,
    name: categoryLabel,
    category: { label: categoryLabel, uri: categoryUri },
    description: "",
    type: "categorical",
    factor_values: fvs,
  };
}

function realStatement(subjectLabel: string, objectLabel?: string): Statement {
  return {
    subject: { label: subjectLabel },
    predicate: objectLabel ? { label: "has role" } : undefined,
    object: objectLabel ? { label: objectLabel } : undefined,
  };
}

// ---------------------------------------------------------------------------
// 1. toggleBaseline
// ---------------------------------------------------------------------------

describe("toggleBaseline — FV with no statements: toggle adds baseline statement", () => {
  it("injects a baseline statement when the FV has no statements at all (disease category)", () => {
    // disease → baseline term is "control" via has role
    const fv = makeFv(10, { statements: [] });
    const factor = makeFactor(1, "disease", [fv]);
    const design = makeDesign([factor]);

    const next = toggleBaseline(design, 1, 10);
    const nextFv = next.factors[0].factor_values[0];

    expect(nextFv.is_baseline).toBe(true);
    // A baseline statement should have been injected.
    expect(nextFv.statements.length).toBeGreaterThan(0);
    // The object of the injected statement is the canonical baseline term.
    const stmt = nextFv.statements[0];
    expect(stmt.object?.label?.toLowerCase()).toContain("control");
  });

  it("does NOT inject a second baseline statement when FV already carries one (fvHasBaselineStatement)", () => {
    // FV already has a statement whose object is "control" — one of the
    // BASELINE_TERM_LABELS set. toggleBaseline should just flip is_baseline
    // and leave statements alone.
    const existingStmt: Statement = {
      subject: { label: "vehicle" },
      predicate: { label: "has role" },
      object: { label: "control" },
    };
    const fv = makeFv(10, { statements: [existingStmt] });
    const factor = makeFactor(1, "disease", [fv]);
    const design = makeDesign([factor]);

    const next = toggleBaseline(design, 1, 10);
    const nextFv = next.factors[0].factor_values[0];

    expect(nextFv.is_baseline).toBe(true);
    // Statement count unchanged — no extra injection.
    expect(nextFv.statements).toHaveLength(1);
    expect(nextFv.statements[0]).toEqual(existingStmt);
  });
});

describe("toggleBaseline — FV with existing real statements but no baseline tag: toggle adds baseline-marker", () => {
  it("skips injection when the FV already carries any non-empty statement (hasRealStatement guards against double-inject)", () => {
    // "female" on biological-sex factor: real statement with no baseline
    // term. hasRealStatement fires → just flip is_baseline, don't append
    // "female has role control".
    const existingStmt: Statement = {
      subject: { label: "female", uri: "http://purl.obolibrary.org/obo/PATO_0000383" },
    };
    const fv = makeFv(10, { statements: [existingStmt] });
    const factor = makeFactor(1, "biological sex", [fv]);
    const design = makeDesign([factor]);

    const next = toggleBaseline(design, 1, 10);
    const nextFv = next.factors[0].factor_values[0];

    expect(nextFv.is_baseline).toBe(true);
    // No new statement added.
    expect(nextFv.statements).toHaveLength(1);
    expect(nextFv.statements[0]).toEqual(existingStmt);
  });
});

describe("toggleBaseline — FV already baseline: toggle removes it", () => {
  it("turns off is_baseline when the FV was already baseline", () => {
    const fv = makeFv(10, {
      is_baseline: true,
      statements: [
        {
          subject: { label: "wild type genotype" },
        },
      ],
    });
    const factor = makeFactor(1, "genotype", [fv]);
    const design = makeDesign([factor]);

    const next = toggleBaseline(design, 1, 10);
    const nextFv = next.factors[0].factor_values[0];

    expect(nextFv.is_baseline).toBe(false);
    // Statements are preserved as-is on turn-off.
    expect(nextFv.statements).toHaveLength(1);
  });
});

describe("toggleBaseline — two FVs in same factor: siblings are never touched", () => {
  // REVERSED 2026-08-19. This used to assert that marking fv2 unmarked
  // fv1. Gemma allows a factor to carry two reference levels (a dataset
  // holding two experiments has one per experiment) and its own apply
  // stopped clearing siblings, so clearing them here made that design
  // unrepresentable: marking B silently unmarked A. Paul: "just allow
  // it but flag it" — the ValidatorBanner does the flagging.
  it("marks the new FV and LEAVES the existing baseline alone", () => {
    const fv1 = makeFv(10, {
      is_baseline: true,
      statements: [realStatement("wild type genotype")],
    });
    const fv2 = makeFv(11, { is_baseline: false, statements: [] });
    const factor = makeFactor(1, "genotype", [fv1, fv2]);
    const design = makeDesign([factor]);

    // Toggle fv2 to baseline.
    const next = toggleBaseline(design, 1, 11);
    const [nextFv1, nextFv2] = next.factors[0].factor_values;

    // The new one is baseline.
    expect(nextFv2.is_baseline).toBe(true);
    // ...and so is the old one. Two references, deliberately.
    expect(nextFv1.is_baseline).toBe(true);
  });

  // Switching the baseline is now two clicks rather than one. That is
  // the trade for never rewriting a value the curator didn't point at.
  it("unmarking one leaves the other marked — switching takes two clicks", () => {
    const fv1 = makeFv(10, { is_baseline: true, statements: [] });
    const fv2 = makeFv(11, { is_baseline: false, statements: [] });
    const design = makeDesign([makeFactor(1, "genotype", [fv1, fv2])]);

    const both = toggleBaseline(design, 1, 11);
    const switched = toggleBaseline(both, 1, 10);
    const [a, b] = switched.factors[0].factor_values;

    expect(a.is_baseline).toBe(false);
    expect(b.is_baseline).toBe(true);
  });

  it("a sibling's statements survive the toggle untouched", () => {
    const fv1 = makeFv(10, {
      is_baseline: true,
      statements: [realStatement("wild type genotype")],
    });
    const fv2 = makeFv(11, { is_baseline: false, statements: [] });
    const design = makeDesign([makeFactor(1, "genotype", [fv1, fv2])]);

    const next = toggleBaseline(design, 1, 11);
    expect(next.factors[0].factor_values[0].statements).toEqual(fv1.statements);
  });

  it("does not touch is_baseline on other factors when toggling within one factor", () => {
    const fv1 = makeFv(10, { is_baseline: true, statements: [] });
    const fv2 = makeFv(11, { is_baseline: false, statements: [] });
    const factor1 = makeFactor(1, "disease", [fv1, fv2]);
    const factor2Fv = makeFv(20, { is_baseline: true, statements: [realStatement("wild type genotype")] });
    const factor2 = makeFactor(2, "genotype", [factor2Fv]);
    const design = makeDesign([factor1, factor2]);

    // Toggle fv2 in factor1
    const next = toggleBaseline(design, 1, 11);
    // factor2's FV should still be baseline (untouched).
    expect(next.factors[1].factor_values[0].is_baseline).toBe(true);
  });

  it("genotype category: injected statement uses standalone wild-type subject (asStandalone=true)", () => {
    const fv = makeFv(10, { free_text_label: "WT", statements: [] });
    const factor = makeFactor(1, "genotype", [fv]);
    const design = makeDesign([factor]);

    const next = toggleBaseline(design, 1, 10);
    const nextFv = next.factors[0].factor_values[0];

    expect(nextFv.is_baseline).toBe(true);
    // Genotype baseline injects the term as the subject directly (no predicate/object).
    const stmt = nextFv.statements[0];
    expect(stmt.subject.label).toBe("wild type genotype");
    expect(stmt.predicate).toBeUndefined();
    expect(stmt.object).toBeUndefined();
  });

  it("treatment category: injected statement uses FV label as subject + reference substance role as object", () => {
    const fv = makeFv(10, { free_text_label: "DMSO", statements: [] });
    const factor = makeFactor(1, "treatment", [fv]);
    const design = makeDesign([factor]);

    const next = toggleBaseline(design, 1, 10);
    const nextFv = next.factors[0].factor_values[0];

    expect(nextFv.is_baseline).toBe(true);
    const stmt = nextFv.statements[0];
    // Subject is the FV label (the actual substance).
    expect(stmt.subject.label).toBe("DMSO");
    // Object is the reference-substance-role term.
    expect(stmt.object?.label).toBe("reference substance role");
    expect(stmt.predicate?.label).toBe("has role");
  });

  it("unknown category: no statement injected (baselineFor returns null), just flag-flip", () => {
    const fv = makeFv(10, { statements: [] });
    const factor = makeFactor(1, "some unknown EFC", [fv]);
    const design = makeDesign([factor]);

    const next = toggleBaseline(design, 1, 10);
    const nextFv = next.factors[0].factor_values[0];

    expect(nextFv.is_baseline).toBe(true);
    // No statement was injected because baselineFor returned null.
    expect(nextFv.statements).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. mergeNearMatchAgentFactor
// ---------------------------------------------------------------------------

function makeAgentFvp(
  biomaterialShortNames: string[],
  statements: FactorValueProposal["statements"],
  overrides: Partial<FactorValueProposal> = {},
): FactorValueProposal {
  return {
    free_text_label: "agent-label",
    is_baseline: false,
    statements,
    biomaterial_short_names: biomaterialShortNames,
    ...overrides,
  };
}

function makeAgentFactor(
  categoryLabel: string,
  fvps: FactorValueProposal[],
  categoryUri: string | null = null,
): FactorProposal {
  return {
    category: { label: categoryLabel, uri: categoryUri, resolver: null, score: null },
    name_in_design: categoryLabel,
    factor_values: fvps,
  };
}

describe("mergeNearMatchAgentFactor — no stubs: agent FVs added cleanly", () => {
  it("adds new agent statements to a gold FV that had none", () => {
    const goldFv = makeFv(10, {
      free_text_label: "vehicle",
      biomaterial_short_names: ["s1", "s2"],
      statements: [],
    });
    const factor = makeFactor(1, "treatment", [goldFv]);
    const design = makeDesign([factor]);

    const agentStmt: FactorValueProposal["statements"][0] = {
      category: { label: "treatment", uri: null, resolver: null, score: null },
      subject: { label: "DMSO", uri: null, resolver: null, score: null },
      predicate: { label: "has role", uri: "http://purl.obolibrary.org/obo/RO_0000087", resolver: null, score: null },
      object: { label: "reference substance role", uri: null, resolver: null, score: null },
    };
    const agentFactor = makeAgentFactor("treatment", [
      makeAgentFvp(["s1", "s2"], [agentStmt]),
    ]);

    const next = mergeNearMatchAgentFactor(design, agentFactor);
    const mergedFv = next.factors[0].factor_values[0];

    // Gold's identity preserved.
    expect(mergedFv.id).toBe(10);
    expect(mergedFv.free_text_label).toBe("vehicle");
    // Agent statements merged in.
    expect(mergedFv.statements).toHaveLength(1);
    expect(mergedFv.statements[0].subject.label).toBe("DMSO");
  });
});

describe("mergeNearMatchAgentFactor — goldStubsReplaced: stubs replaced, not duplicated, by agent S-P-O", () => {
  it("replaces a gold stub (subject-only) with the agent's richer statement sharing the same subject", () => {
    // Gold FV has a stub: subject="kanamycin", no predicate, no object.
    // Agent FV has a full S-P-O for "kanamycin". After merge, there
    // should be ONE statement about kanamycin (the richer one), not two.
    const goldStub: Statement = {
      subject: { label: "kanamycin" },
    };
    const goldFv = makeFv(10, {
      free_text_label: "kanamycin",
      biomaterial_short_names: ["s1"],
      statements: [goldStub],
    });
    const factor = makeFactor(1, "treatment", [goldFv]);
    const design = makeDesign([factor]);

    const agentStmt: FactorValueProposal["statements"][0] = {
      category: { label: "treatment", uri: null, resolver: null, score: null },
      subject: { label: "kanamycin", uri: null, resolver: null, score: null },
      predicate: { label: "has role", uri: null, resolver: null, score: null },
      object: { label: "reference substance role", uri: null, resolver: null, score: null },
    };
    const agentFactor = makeAgentFactor("treatment", [
      makeAgentFvp(["s1"], [agentStmt]),
    ]);

    const next = mergeNearMatchAgentFactor(design, agentFactor);
    const mergedFv = next.factors[0].factor_values[0];

    // Stub replaced, not duplicated — exactly one statement.
    expect(mergedFv.statements).toHaveLength(1);
    // The surviving statement is the richer one from the agent.
    expect(mergedFv.statements[0].predicate?.label).toBe("has role");
    expect(mergedFv.statements[0].object?.label).toBe("reference substance role");
  });

  it("keeps a gold stub when the agent has no richer statement for that subject", () => {
    // Gold stub for "kanamycin". Agent's statement is about a DIFFERENT
    // subject ("amoxicillin"). Stub should survive.
    const goldStub: Statement = {
      subject: { label: "kanamycin" },
    };
    const goldFv = makeFv(10, {
      free_text_label: "kanamycin",
      biomaterial_short_names: ["s1"],
      statements: [goldStub],
    });
    const factor = makeFactor(1, "treatment", [goldFv]);
    const design = makeDesign([factor]);

    const agentStmt: FactorValueProposal["statements"][0] = {
      category: { label: "treatment", uri: null, resolver: null, score: null },
      subject: { label: "amoxicillin", uri: null, resolver: null, score: null },
      predicate: { label: "has role", uri: null, resolver: null, score: null },
      object: { label: "reference substance role", uri: null, resolver: null, score: null },
    };
    const agentFactor = makeAgentFactor("treatment", [
      makeAgentFvp(["s1"], [agentStmt]),
    ]);

    const next = mergeNearMatchAgentFactor(design, agentFactor);
    const mergedFv = next.factors[0].factor_values[0];

    // Both survive: the gold stub (different subject) + agent's statement.
    expect(mergedFv.statements).toHaveLength(2);
    const subjects = mergedFv.statements.map((s) => s.subject.label);
    expect(subjects).toContain("kanamycin");
    expect(subjects).toContain("amoxicillin");
  });

  it("stubs replaced AND real gold rows preserved in a mixed FV", () => {
    // Gold FV has two statements:
    //   1. stub: "drug · (no predicate, no object)"  ← should be replaced
    //   2. real: "drug · delivered at dose · 50mg"   ← should be preserved
    // Agent adds: "drug · has role · reference substance role"
    // After merge: the stub is gone, the real row stays, the agent's
    // statement is appended. Total = 2 (not 3).
    const goldStub: Statement = {
      subject: { label: "drug A" },
    };
    const goldReal: Statement = {
      subject: { label: "drug A" },
      predicate: { label: "delivered at dose" },
      object: { label: "50 mg" },
    };
    const goldFv = makeFv(10, {
      free_text_label: "drug A",
      biomaterial_short_names: ["s1"],
      statements: [goldStub, goldReal],
    });
    const factor = makeFactor(1, "treatment", [goldFv]);
    const design = makeDesign([factor]);

    const agentStmt: FactorValueProposal["statements"][0] = {
      category: { label: "treatment", uri: null, resolver: null, score: null },
      subject: { label: "drug A", uri: null, resolver: null, score: null },
      predicate: { label: "has role", uri: null, resolver: null, score: null },
      object: { label: "reference substance role", uri: null, resolver: null, score: null },
    };
    const agentFactor = makeAgentFactor("treatment", [
      makeAgentFvp(["s1"], [agentStmt]),
    ]);

    const next = mergeNearMatchAgentFactor(design, agentFactor);
    const mergedFv = next.factors[0].factor_values[0];

    // Stub gone, real row preserved, agent statement added = 2 total.
    expect(mergedFv.statements).toHaveLength(2);
    const predicates = mergedFv.statements.map((s) => s.predicate?.label ?? "(none)");
    expect(predicates).toContain("delivered at dose");
    expect(predicates).toContain("has role");
    // The bare-stub signature should not appear.
    expect(predicates).not.toContain("(none)");
  });

  it("deduplicates identical S-P-O from gold and agent", () => {
    // Both gold and agent have the same statement. After merge, only one copy.
    const sharedStmt: Statement = {
      subject: { label: "vehicle" },
      predicate: { label: "has role" },
      object: { label: "reference substance role" },
    };
    const goldFv = makeFv(10, {
      free_text_label: "vehicle",
      biomaterial_short_names: ["s1"],
      statements: [sharedStmt],
    });
    const factor = makeFactor(1, "treatment", [goldFv]);
    const design = makeDesign([factor]);

    const agentStmt: FactorValueProposal["statements"][0] = {
      category: { label: "treatment", uri: null, resolver: null, score: null },
      subject: { label: "vehicle", uri: null, resolver: null, score: null },
      predicate: { label: "has role", uri: null, resolver: null, score: null },
      object: { label: "reference substance role", uri: null, resolver: null, score: null },
    };
    const agentFactor = makeAgentFactor("treatment", [
      makeAgentFvp(["s1"], [agentStmt]),
    ]);

    const next = mergeNearMatchAgentFactor(design, agentFactor);
    const mergedFv = next.factors[0].factor_values[0];

    expect(mergedFv.statements).toHaveLength(1);
  });

  it("no-ops gracefully when no gold factor matches the agent category", () => {
    const goldFv = makeFv(10, { biomaterial_short_names: ["s1"], statements: [] });
    const factor = makeFactor(1, "treatment", [goldFv]);
    const design = makeDesign([factor]);

    const agentFactor = makeAgentFactor("genotype", [
      makeAgentFvp(["s1"], []),
    ]);

    const next = mergeNearMatchAgentFactor(design, agentFactor);
    // Design unchanged — category didn't match.
    expect(next.factors).toHaveLength(1);
    expect(next.factors[0].category.label).toBe("treatment");
    expect(next.factors[0].factor_values[0].statements).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. adoptNearMatchAgentFactor
// ---------------------------------------------------------------------------

describe("adoptNearMatchAgentFactor — category URI lookup", () => {
  it("locates the gold factor by category URI and replaces its content", () => {
    const URI = "http://www.ebi.ac.uk/efo/EFO_0000408";
    const goldFv = makeFv(10, {
      free_text_label: "old label",
      biomaterial_short_names: ["s1"],
      statements: [],
    });
    const factor = makeFactor(1, "disease", [goldFv], URI);
    const design = makeDesign([factor]);

    const agentFvp: FactorValueProposal = {
      free_text_label: "control",
      is_baseline: true,
      biomaterial_short_names: ["s1"],
      statements: [
        {
          category: { label: "disease", uri: URI, resolver: null, score: null },
          subject: { label: "control", uri: null, resolver: null, score: null },
          predicate: { label: "has role", uri: null, resolver: null, score: null },
          object: { label: "control", uri: null, resolver: null, score: null },
        },
      ],
    };
    const agentFactor: FactorProposal = {
      category: { label: "disease", uri: URI, resolver: null, score: null },
      name_in_design: "disease status",
      factor_values: [agentFvp],
    };

    const next = adoptNearMatchAgentFactor(design, agentFactor);
    const adopted = next.factors[0];

    // Factor id unchanged.
    expect(adopted.id).toBe(1);
    // Category from agent.
    expect(adopted.category.uri).toBe(URI);
    // Name updated to agent's human-readable label.
    expect(adopted.name).toBe("disease status");
    // FV content replaced.
    const nextFv = adopted.factor_values[0];
    expect(nextFv.free_text_label).toBe("control");
    expect(nextFv.is_baseline).toBe(true);
    // Biomaterial assignment preserved (partition is kept from agent's FV).
    expect(nextFv.biomaterial_short_names).toEqual(["s1"]);
    // Statement from agent adopted.
    expect(nextFv.statements).toHaveLength(1);
    expect(nextFv.statements[0].subject.label).toBe("control");
  });
});

describe("adoptNearMatchAgentFactor — label fallback", () => {
  it("falls back to case-insensitive label match when the agent factor has no URI", () => {
    // Gold factor has no URI, agent factor has no URI — must match by label.
    const goldFv = makeFv(10, {
      free_text_label: "old-vehicle",
      biomaterial_short_names: ["s1"],
      statements: [],
    });
    const factor = makeFactor(1, "Treatment", [goldFv]); // capital T
    const design = makeDesign([factor]);

    const agentFvp: FactorValueProposal = {
      free_text_label: "DMSO",
      is_baseline: true,
      biomaterial_short_names: ["s1"],
      statements: [],
    };
    const agentFactor: FactorProposal = {
      // Note: lowercase label, no URI — must match gold's "Treatment" case-insensitively.
      category: { label: "treatment", uri: null, resolver: null, score: null },
      name_in_design: "treatment",
      factor_values: [agentFvp],
    };

    const next = adoptNearMatchAgentFactor(design, agentFactor);
    const adopted = next.factors[0];

    // Factor located and updated.
    expect(adopted.id).toBe(1);
    expect(adopted.factor_values[0].free_text_label).toBe("DMSO");
  });

  it("matches by URI even when labels differ", () => {
    // Gold label: "Treatment"; agent label: "drug treatment"
    // But they share the same URI → URI match wins.
    const URI = "http://example.org/treatment";
    const goldFv = makeFv(10, {
      biomaterial_short_names: ["s1"],
      statements: [],
    });
    const factor = makeFactor(1, "Treatment", [goldFv], URI);
    const design = makeDesign([factor]);

    const agentFvp: FactorValueProposal = {
      free_text_label: "saline",
      is_baseline: true,
      biomaterial_short_names: ["s1"],
      statements: [],
    };
    const agentFactor: FactorProposal = {
      category: { label: "drug treatment", uri: URI, resolver: null, score: null },
      name_in_design: "drug treatment",
      factor_values: [agentFvp],
    };

    const next = adoptNearMatchAgentFactor(design, agentFactor);
    const adopted = next.factors[0];

    // Adopted via URI match despite label mismatch.
    expect(adopted.id).toBe(1);
    expect(adopted.factor_values[0].free_text_label).toBe("saline");
  });
});

describe("adoptNearMatchAgentFactor — no match: lookup fails gracefully", () => {
  it("returns the design unchanged when neither URI nor label matches any gold factor", () => {
    const goldFv = makeFv(10, { biomaterial_short_names: ["s1"], statements: [] });
    const factor = makeFactor(1, "disease", [goldFv]);
    const design = makeDesign([factor]);

    const agentFvp: FactorValueProposal = {
      free_text_label: "control",
      is_baseline: false,
      biomaterial_short_names: ["s1"],
      statements: [],
    };
    const agentFactor: FactorProposal = {
      category: { label: "genotype", uri: "http://example.org/genotype", resolver: null, score: null },
      name_in_design: "genotype",
      factor_values: [agentFvp],
    };

    const next = adoptNearMatchAgentFactor(design, agentFactor);

    // Design returned unchanged — no mutation.
    expect(next).toBe(design);
    expect(next.factors[0].category.label).toBe("disease");
    expect(next.factors[0].factor_values[0].free_text_label).toBe("");
  });

  it("is a no-op when the design has no factors at all", () => {
    const design = makeDesign([]);
    const agentFactor: FactorProposal = {
      category: { label: "treatment", uri: null, resolver: null, score: null },
      name_in_design: "treatment",
      factor_values: [],
    };

    const next = adoptNearMatchAgentFactor(design, agentFactor);
    expect(next).toBe(design);
  });
});
