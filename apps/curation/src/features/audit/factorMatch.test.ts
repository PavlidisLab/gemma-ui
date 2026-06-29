import { describe, expect, it } from "vitest";
import type { AuditFinding } from "@/api/auditTypes";
import type { FactorProposal, OntologyTerm, Proposal } from "@/api/types";
import {
  factorMatchVariant,
  factorProposalFromApplyAction,
  factorProposalFromRename,
  isCloseFactorMatch,
  isExactFactorMatch,
  isFactorMatchCode,
  isNearMatchFinding,
  resolveAgentFactor,
} from "./factorMatch";
import type { FactorRenamePayload } from "@/api/auditTypes";

/** Minimal ``OntologyTerm`` factory — only ``label`` matters for these
 *  tests; ``uri`` / ``resolver`` / ``score`` are present to satisfy
 *  the type but aren't exercised. */
function term(label: string): OntologyTerm {
  return { label, uri: null, resolver: null, score: null };
}

/** Minimal ``FactorProposal`` factory. Statements / FV detail aren't
 *  load-bearing for the lookup tests — we only need a stable
 *  ``category.label`` for the fallback path. */
function factor(categoryLabel: string): FactorProposal {
  return {
    category: term(categoryLabel),
    name_in_design: categoryLabel,
    factor_values: [],
  };
}

/** Minimal ``Proposal`` factory wrapping a list of factors. */
function proposalWithFactors(factors: FactorProposal[]): Proposal {
  return {
    proposal_id: null,
    experiment_id: 1,
    experiment_short_name: "GSE-test",
    submitted_by: "test",
    submitted_at: "2026-05-18T00:00:00Z",
    model: null,
    status: "pending",
    tags: [],
    factors,
    evidence: {
      preboarding_excerpt: "",
      paper_source: null,
      paper_excerpt: "",
      exemplar_experiment_ids: [],
      extra: {},
    },
  };
}

/** Build a finding with the bits the helpers exercise; everything
 *  else gets safe defaults so the type stays satisfied. */
function finding(partial: Partial<AuditFinding>): AuditFinding {
  return {
    target_kind: "factor",
    target_id: "factor:0",
    severity: "ok",
    issue_code: "calibration_factor_match_exact",
    rationale: "",
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    ...partial,
  };
}

describe("factorMatchVariant", () => {
  it("classifies the factor-match codes", () => {
    expect(factorMatchVariant("calibration_factor_match_exact")).toBe("exact");
    // Both _near (post-2026-05-18) and _close (earlier name) map to
    // the same render path.
    expect(factorMatchVariant("calibration_factor_match_near")).toBe("near");
    expect(factorMatchVariant("calibration_factor_match_close")).toBe("near");
    expect(factorMatchVariant("calibration_factor_match")).toBe("legacy");
  });

  it("returns null for non-match codes", () => {
    expect(factorMatchVariant("calibration_factor_rename")).toBe(null);
    expect(factorMatchVariant("calibration_match")).toBe(null);
    expect(factorMatchVariant("calibration_agent_extra")).toBe(null);
    expect(factorMatchVariant("")).toBe(null);
    expect(factorMatchVariant(null)).toBe(null);
    expect(factorMatchVariant(undefined)).toBe(null);
  });
});

describe("isFactorMatchCode", () => {
  it("is true for any factor-match variant", () => {
    expect(isFactorMatchCode("calibration_factor_match_exact")).toBe(true);
    expect(isFactorMatchCode("calibration_factor_match_close")).toBe(true);
    expect(isFactorMatchCode("calibration_factor_match")).toBe(true);
  });

  it("is false for everything else", () => {
    expect(isFactorMatchCode("calibration_factor_rename")).toBe(false);
    expect(isFactorMatchCode("calibration_match")).toBe(false);
    expect(isFactorMatchCode(undefined)).toBe(false);
  });
});

describe("isExactFactorMatch / isCloseFactorMatch", () => {
  it("``_exact`` is exact only", () => {
    const f = finding({ issue_code: "calibration_factor_match_exact" });
    expect(isExactFactorMatch(f)).toBe(true);
    expect(isCloseFactorMatch(f)).toBe(false);
  });

  it("``_close`` is close only", () => {
    const f = finding({
      issue_code: "calibration_factor_match_close",
      severity: "minor",
    });
    expect(isExactFactorMatch(f)).toBe(false);
    expect(isCloseFactorMatch(f)).toBe(true);
  });

  it("legacy ``calibration_factor_match`` at severity ok is treated as close (conservative default for pre-2026-05-18 builds)", () => {
    const f = finding({
      issue_code: "calibration_factor_match",
      severity: "ok",
    });
    expect(isExactFactorMatch(f)).toBe(false);
    expect(isCloseFactorMatch(f)).toBe(true);
  });

  it("legacy ``calibration_factor_match`` at non-ok severity is a rename — handled elsewhere, not classified as close", () => {
    const f = finding({
      issue_code: "calibration_factor_match",
      severity: "minor",
    });
    expect(isExactFactorMatch(f)).toBe(false);
    expect(isCloseFactorMatch(f)).toBe(false);
  });
});

/** Tiny rename-payload factory — only the existence of the payload
 *  matters for ``isNearMatchFinding`` (the body shape is checked
 *  elsewhere). ``concept_diff_kind`` left unset so we exercise the
 *  back-compat default. */
function renamePayload(overrides: Partial<FactorRenamePayload> = {}): FactorRenamePayload {
  return {
    agent: { category: term("genotype") },
    gold: { category: term("genotype") },
    fv_pairs: [],
    direction: "equivalent",
    ...overrides,
  };
}

describe("isNearMatchFinding", () => {
  // Two-header-chip redesign (Paul 2026-05-21 — GSE93824 case).
  // The predicate gates whether the strength label gets dropped and
  // whether the Judge: rationale moves to the FV expansion block.
  // True path = near-match (factor-level OK + lower-level diff);
  // false path = whole-factor extras / misses / partition-mismatches
  // where the strength framing is still the right one.

  it("``_match_near`` is a near-match (factor proposal OK, FV-level diff)", () => {
    expect(
      isNearMatchFinding(
        finding({ issue_code: "calibration_factor_match_near" }),
      ),
    ).toBe(true);
  });

  it("``_match_close`` (earlier wire spelling) is also near-match", () => {
    expect(
      isNearMatchFinding(
        finding({
          issue_code: "calibration_factor_match_close",
          severity: "minor",
        }),
      ),
    ).toBe(true);
  });

  it("legacy ``calibration_factor_match`` at ok severity is near-match (back-compat)", () => {
    expect(
      isNearMatchFinding(
        finding({ issue_code: "calibration_factor_match", severity: "ok" }),
      ),
    ).toBe(true);
  });

  it("any finding carrying a rename payload is near-match (concept_diff_kind shapes)", () => {
    expect(
      isNearMatchFinding(
        finding({
          issue_code: "calibration_factor_rename",
          severity: "minor",
          rename: renamePayload(),
        }),
      ),
    ).toBe(true);
  });

  it("``_factor_extra`` is NOT near-match — whole-factor decision, strength label stays", () => {
    expect(
      isNearMatchFinding(
        finding({
          issue_code: "calibration_factor_extra",
          severity: "minor",
        }),
      ),
    ).toBe(false);
  });

  it("``_factor_gold_only_miss`` is NOT near-match — strength label stays", () => {
    expect(
      isNearMatchFinding(
        finding({
          issue_code: "calibration_factor_gold_only_miss",
          severity: "minor",
        }),
      ),
    ).toBe(false);
  });

  it("``_factor_partition_mismatch`` is NOT near-match — strength label stays", () => {
    expect(
      isNearMatchFinding(
        finding({
          issue_code: "calibration_factor_partition_mismatch",
          severity: "minor",
        }),
      ),
    ).toBe(false);
  });

  it("exact-match findings are NOT near-match — they short-circuit before any judge UI", () => {
    expect(
      isNearMatchFinding(
        finding({
          issue_code: "calibration_factor_match_exact",
          severity: "ok",
        }),
      ),
    ).toBe(false);
  });
});

describe("resolveAgentFactor", () => {
  it("uses ``agent_target_index`` when present and in range", () => {
    const factors = [factor("genotype"), factor("treatment"), factor("dose")];
    const cp = proposalWithFactors(factors);
    const f = finding({ agent_target_index: 1 });
    expect(resolveAgentFactor(f, cp, "ignored-label")).toBe(factors[1]);
  });

  it("returns null when ``agent_target_index`` is out of range (malformed wire) — do NOT fall back to a different factor", () => {
    const factors = [factor("genotype"), factor("treatment")];
    const cp = proposalWithFactors(factors);
    expect(resolveAgentFactor({ agent_target_index: 5 }, cp, "genotype")).toBe(
      null,
    );
    expect(resolveAgentFactor({ agent_target_index: -1 }, cp, "genotype")).toBe(
      null,
    );
  });

  it("falls back to label-based lookup when ``agent_target_index`` is null / undefined (older audits)", () => {
    const factors = [factor("genotype"), factor("treatment")];
    const cp = proposalWithFactors(factors);
    expect(
      resolveAgentFactor({ agent_target_index: null }, cp, "treatment"),
    ).toBe(factors[1]);
    expect(resolveAgentFactor({}, cp, "treatment")).toBe(factors[1]);
  });

  it("label fallback is case- and whitespace-insensitive", () => {
    const factors = [factor("Genotype")];
    const cp = proposalWithFactors(factors);
    expect(resolveAgentFactor({}, cp, "  GENOTYPE  ")).toBe(factors[0]);
  });

  it("returns null when neither index nor label produces a hit", () => {
    const factors = [factor("genotype")];
    const cp = proposalWithFactors(factors);
    expect(resolveAgentFactor({}, cp, "treatment")).toBe(null);
    expect(resolveAgentFactor({}, cp, "")).toBe(null);
  });

  it("returns null when the comparison proposal is null / empty", () => {
    expect(resolveAgentFactor({ agent_target_index: 0 }, null, "x")).toBe(null);
    expect(
      resolveAgentFactor(
        { agent_target_index: 0 },
        proposalWithFactors([]),
        "x",
      ),
    ).toBe(null);
  });
});

describe("factorProposalFromApplyAction", () => {
  /** add_factor payload as it reaches the React tree — the client
   *  deep-snakeifies the camelCase wire payload, so keys are snake. */
  const addFactor = (categoryLabel: string, fvLabel: string, baseN: number) =>
    finding({
      issue_code: "calibration_factor_extra",
      rationale: `Add factor \`${categoryLabel}\`?`,
      apply_action: {
        kind: "add_factor",
        new_category: categoryLabel,
        fv_labels: [fvLabel, `no ${fvLabel}`],
        new_factor_payload: {
          category: term(categoryLabel),
          name_in_design: categoryLabel,
          factor_type: "categorical",
          factor_values: [
            { free_text_label: fvLabel, is_baseline: false, statements: [], biomaterial_short_names: [] },
            { free_text_label: `no ${fvLabel}`, is_baseline: true, statements: [], biomaterial_short_names: new Array(baseN).fill("GSM") },
          ],
        },
      } as unknown as AuditFinding["apply_action"],
    });

  it("returns the finding's OWN add-factor payload (not a comparison-proposal lookup)", () => {
    const f = addFactor("genotype", "KO", 10);
    const p = factorProposalFromApplyAction(f);
    expect(p?.category.label).toBe("genotype");
    expect(p?.factor_values.map((fv) => fv.free_text_label)).toEqual([
      "KO",
      "no KO",
    ]);
  });

  it("GSE225864: each multi-allele genotype card resolves to ITS OWN FVs even though agent_target_index is null and three genotype factors share the category", () => {
    // The bug: resolveAgentFactor's label fallback would return the
    // first ``genotype`` factor (A152T) for BOTH of these. The payload
    // path keeps them distinct.
    const ko = factorProposalFromApplyAction(addFactor("genotype", "KO", 10));
    const p301s = factorProposalFromApplyAction(
      addFactor("genotype", "P301S", 11),
    );
    expect(ko?.factor_values[0].free_text_label).toBe("KO");
    expect(p301s?.factor_values[0].free_text_label).toBe("P301S");
    expect(ko?.factor_values[0].free_text_label).not.toBe(
      p301s?.factor_values[0].free_text_label,
    );
  });

  it("returns null for non-add findings (no apply_action, or a different kind) so callers fall back to resolveAgentFactor", () => {
    expect(factorProposalFromApplyAction(finding({}))).toBe(null);
    expect(
      factorProposalFromApplyAction(
        finding({
          apply_action: { kind: "add_tag", new_category: "x", new_value: "y" },
        }),
      ),
    ).toBe(null);
  });

  it("returns null when the payload is malformed (missing category or factor_values)", () => {
    expect(
      factorProposalFromApplyAction(
        finding({
          apply_action: {
            kind: "add_factor",
            new_factor_payload: { name_in_design: "genotype" },
          } as unknown as AuditFinding["apply_action"],
        }),
      ),
    ).toBe(null);
  });
});

describe("factorProposalFromRename", () => {
  const renamePayload = (
    agentCat: string,
    goldCat: string,
    fvPairs: { agent: string; gold: string; equivalence?: string }[],
  ): FactorRenamePayload => ({
    agent: { category: term(agentCat) },
    gold: { category: term(goldCat) },
    fv_pairs: fvPairs.map((p) => ({
      agent: term(p.agent),
      gold: term(p.gold),
      equivalence: p.equivalence ?? "synonym",
    })),
    direction: "agent_correct",
  });

  it("synthesizes a proposal from the rename payload (the inert-near-match fix, B1)", () => {
    // This is the case that was inert: comparison_proposal absent on a
    // replayed static batch, so resolveAgentFactor → null. The rename
    // payload ships on the finding and must drive the apply.
    const f = finding({
      issue_code: "calibration_factor_match_near",
      rename: renamePayload("treatment", "treatment", [
        { agent: "LPS", gold: "lipopolysaccharide" },
        { agent: "vehicle", gold: "control" },
      ]),
    });
    const p = factorProposalFromRename(f);
    expect(p?.category.label).toBe("treatment");
    expect(p?.name_in_design).toBe("treatment");
    // FVs carry the AGENT label (what Agree adopts) with the gold side
    // as gemma_ref so the idempotency check can pair + detect drift.
    expect(p?.factor_values.map((fv) => fv.free_text_label)).toEqual([
      "LPS",
      "vehicle",
    ]);
    expect(p?.factor_values[0].gemma_ref?.label).toBe("lipopolysaccharide");
    expect(p?.factor_values[0].match_type).toBe("close");
  });

  it("marks a pair exact when agent and gold labels coincide (idempotency-safe)", () => {
    const f = finding({
      rename: renamePayload("sex", "sex", [{ agent: "male", gold: "male" }]),
    });
    const p = factorProposalFromRename(f);
    expect(p?.factor_values[0].match_type).toBe("exact");
  });

  it("returns null when there is no rename payload (callers fall back to resolveAgentFactor)", () => {
    expect(factorProposalFromRename(finding({}))).toBe(null);
  });

  it("returns null when the rename payload has no agent category label", () => {
    expect(
      factorProposalFromRename(
        finding({
          rename: {
            agent: { category: term("") },
            gold: { category: term("treatment") },
            fv_pairs: [],
            direction: "agent_correct",
          } as FactorRenamePayload,
        }),
      ),
    ).toBe(null);
  });
});

describe("GSE224970 multi-factor-same-category scenario", () => {
  /** The motivating case from the 2026-05-18 handoff. Gold has 2
   *  genotype factors; agent emits 3 genotype-shaped factors. Pre-fix,
   *  the UI used best-FV-overlap re-derivation and showed the same
   *  agent factor (the 4-FV siRNA shape) on both gold cards because
   *  it had the strongest overlap with each gold's ``wild type`` FV.
   *  Post-fix, the builder commits to a one-to-one pairing via
   *  ``agent_target_index``, so each gold card resolves to a
   *  different agent factor. */
  const agentGenotype0 = factor("genotype"); // 6-FV cross-product
  const agentGenotype1 = factor("genotype"); // 4-FV siRNA shape
  const agentGenotype2 = factor("genotype"); // the "extra" agent factor
  const cp = proposalWithFactors([
    agentGenotype0,
    agentGenotype1,
    agentGenotype2,
  ]);

  const goldCard0 = finding({
    issue_code: "calibration_factor_match_close",
    severity: "minor",
    target_id: "factor:gold-0",
    rationale: "Factor `genotype`: close match against agent factor 0.",
    agent_target_index: 0,
  });
  const goldCard1 = finding({
    issue_code: "calibration_factor_match_close",
    severity: "minor",
    target_id: "factor:gold-1",
    rationale: "Factor `genotype`: close match against agent factor 1.",
    agent_target_index: 1,
  });

  it("each gold match card resolves to a DIFFERENT agent factor", () => {
    const a0 = resolveAgentFactor(goldCard0, cp, "genotype");
    const a1 = resolveAgentFactor(goldCard1, cp, "genotype");
    expect(a0).toBe(agentGenotype0);
    expect(a1).toBe(agentGenotype1);
    expect(a0).not.toBe(a1);
  });

  it("without ``agent_target_index`` (pre-v12 audit), the label fallback collapses both cards onto the FIRST matching agent factor — the bug ``agent_target_index`` was introduced to close", () => {
    const legacyCard0 = finding({
      issue_code: "calibration_factor_match",
      severity: "ok",
      target_id: "factor:gold-0",
      rationale: "Factor `genotype`: match.",
      // agent_target_index intentionally absent
    });
    const legacyCard1 = finding({
      issue_code: "calibration_factor_match",
      severity: "ok",
      target_id: "factor:gold-1",
      rationale: "Factor `genotype`: match.",
    });
    const a0 = resolveAgentFactor(legacyCard0, cp, "genotype");
    const a1 = resolveAgentFactor(legacyCard1, cp, "genotype");
    // Both collapse to the same factor — the duplicate-display bug.
    // Documented here so a future change can't accidentally start
    // hiding it; the real fix is at the wire (``agent_target_index``),
    // not in the fallback.
    expect(a0).toBe(agentGenotype0);
    expect(a1).toBe(agentGenotype0);
  });

  it("classifies both gold cards as close matches (so the UI shows the amber chip)", () => {
    expect(isCloseFactorMatch(goldCard0)).toBe(true);
    expect(isCloseFactorMatch(goldCard1)).toBe(true);
    expect(isExactFactorMatch(goldCard0)).toBe(false);
  });
});
