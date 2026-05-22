import { describe, expect, it } from "vitest";
import type { AuditFinding, AuditReport } from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";
import type { FactorProposal, Proposal } from "@/api/types";
import { buildFactorRows } from "./FindingDetailsEditor";

/** Tests covering the Issue 1 + Issue 2 fixes from
 *  HANDOFF_2026-05-20_DEMOTED_MATCH_SPLIT_FACTOR_UI.md. Both
 *  regressions surfaced on the GSE28300 case where the agent's
 *  ``treatment`` factor is a finer partition of gold's
 *  ``treatment × timepoint``; the builder demotes that into a
 *  ``_factor_extra`` + ``_factor_gold_only_miss`` pair instead of
 *  emitting one ``_factor_partition_mismatch`` finding (Issue 3 —
 *  builder work). Until that ships, the UI must at least render
 *  the two halves honestly. */

function mkFinding(partial: Partial<AuditFinding> = {}): AuditFinding {
  return {
    target_kind: "factor",
    target_id: "calibration:factor_extra:treatment",
    severity: "minor",
    issue_code: "calibration_factor_extra",
    rationale: "Add factor `treatment`?",
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    ...partial,
  };
}

function mkAgentFactor(
  label: string,
  fvs: { label: string; bms: string[]; subject?: string }[],
): FactorProposal {
  return {
    category: { label, uri: null, resolver: null, score: null },
    name_in_design: label,
    factor_values: fvs.map((fv) => ({
      free_text_label: fv.label,
      is_baseline: false,
      // Populate the primary statement's subject so the per-FV
      // rows have real data to compare. Without this every row
      // collapses to empty-vs-empty and trivially "agrees".
      statements: [
        {
          category: { label, uri: null, resolver: null, score: null },
          subject: {
            label: fv.subject ?? fv.label,
            uri: null,
            resolver: null,
            score: null,
          },
          predicate: null,
          object: null,
        },
      ],
      biomaterial_short_names: fv.bms,
    })),
  };
}

function mkReport(agentFactors: FactorProposal[]): AuditReport {
  const proposal = {
    experiment_id: 1,
    experiment_short_name: "GSE28300",
    factors: agentFactors,
    tags: [],
    publications: [],
    notes: "",
    evidence: {
      subtask_decisions: [],
      preboarding_excerpt: "",
      paper_source: "",
      paper_excerpt: "",
      exemplar_experiment_ids: [],
      extra: {},
    },
  } as unknown as Proposal;
  return {
    audit_id: "a1",
    experiment_id: 1,
    experiment_short_name: "GSE28300",
    audited_at: "2026-05-20T00:00:00Z",
    model: "claude-opus",
    scope: { include: [] },
    findings: [],
    evidence: {
      comparison_proposal: proposal,
      preboarding_excerpt: "",
      paper_source: "",
      paper_excerpt: "",
    },
    summary: {
      overall_verdict: "minor_issues",
      n_blocker: 0,
      n_major: 0,
      n_minor: 1,
      n_ok: 0,
    },
    dispositions: [],
  } as unknown as AuditReport;
}

function mkDesign(
  factors: { label: string; fvs: { label: string; bms: string[] }[] }[],
): Design {
  return {
    experiment_id: 1,
    experiment_short_name: "GSE28300",
    factors: factors.map((f, idx) => ({
      id: 9000 + idx,
      name: f.label,
      category: { label: f.label, uri: null },
      description: "",
      type: "categorical",
      factor_values: f.fvs.map((fv, jdx) => ({
        id: 1000 * (idx + 1) + jdx,
        free_text_label: fv.label,
        is_baseline: false,
        statements: [],
        biomaterial_short_names: fv.bms,
      })),
    })),
    biomaterials: [],
    tags: [],
  };
}

describe("buildFactorRows — _factor_extra with same-label gold", () => {
  // The GSE28300 bug: agent emitted a finer `treatment` factor;
  // gold has a coarser `treatment` factor. Same category label,
  // different partitions. The builder demoted to `_factor_extra`
  // (agent-only). The pre-fix UI re-derived a gold pair via slug
  // lookup, hit the same-label gold factor, and rendered "everyone
  // agrees ✓". Post-fix: gold is explicit-empty and the row reports
  // disagreement.

  const agent = mkAgentFactor("treatment", [
    { label: "reference", bms: ["s1", "s2", "s3"] },
    { label: "rotenone 3h", bms: ["s4", "s5", "s6"] },
    { label: "rotenone 3d", bms: ["s7", "s8", "s9"] },
  ]);

  const designWithSameLabel = mkDesign([
    {
      label: "treatment",
      fvs: [
        { label: "rotenone", bms: ["s4", "s5", "s6", "s7", "s8", "s9"] },
        { label: "reference", bms: ["s1", "s2", "s3"] },
      ],
    },
  ]);

  it("Category row reports disagreement (gold is explicit-empty)", () => {
    const finding = mkFinding({ issue_code: "calibration_factor_extra" });
    const report = mkReport([agent]);
    const { rows } = buildFactorRows(finding, report, designWithSameLabel);
    const catRow = rows.find((r) => r.rowLabel === "Category");
    expect(catRow).toBeDefined();
    expect(catRow!.allAgree).toBe(false);
    expect(catRow!.proposal.label).toBe("treatment");
    // The fix is that currently is explicit-empty (not the gold
    // category's `treatment`) — that's what makes the agreement
    // check report disagreement.
    expect(catRow!.currently).toEqual({ label: "", uri: null });
  });

  it("every FV-level row reports disagreement", () => {
    const finding = mkFinding({ issue_code: "calibration_factor_extra" });
    const report = mkReport([agent]);
    const { rows } = buildFactorRows(finding, report, designWithSameLabel);
    const fvRows = rows.filter((r) => r.fvIndex !== null);
    expect(fvRows.length).toBeGreaterThan(0);
    for (const r of fvRows) {
      expect(r.allAgree).toBe(false);
    }
  });

  it("no rows claim agreement → card title would NOT say 'everyone agrees'", () => {
    const finding = mkFinding({ issue_code: "calibration_factor_extra" });
    const report = mkReport([agent]);
    const { rows } = buildFactorRows(finding, report, designWithSameLabel);
    const anyAgree = rows.some((r) => r.allAgree);
    expect(anyAgree).toBe(false);
  });
});

describe("buildFactorRows — non-extra finding still pairs via gold lookup", () => {
  // Control: when the finding is NOT `_factor_extra`, the gold
  // lookup proceeds as before. A match_near finding with a paired
  // gold factor produces rows where currently is populated from
  // gold (and agreement depends on values matching).

  it("Category agrees when both sides have matching label", () => {
    const agent = mkAgentFactor("disease", [
      { label: "control", bms: ["s1"] },
    ]);
    const design = mkDesign([
      { label: "disease", fvs: [{ label: "control", bms: ["s1"] }] },
    ]);
    const finding = mkFinding({
      issue_code: "calibration_factor_match_near",
      target_id: "factor:9000",
      // labelHint comes from the first backticked token —
      // resolveAgentFactor uses it to find the agent factor by
      // category label when ``agent_target_index`` isn't set.
      rationale: "Match `disease`",
    });
    const report = mkReport([agent]);
    const { rows } = buildFactorRows(finding, report, design);
    const catRow = rows.find((r) => r.rowLabel === "Category");
    expect(catRow).toBeDefined();
    expect(catRow!.allAgree).toBe(true);
    expect(catRow!.currently).not.toBeNull();
    expect(catRow!.currently?.label).toBe("disease");
  });
});
