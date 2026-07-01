import { describe, expect, it } from "vitest";
import type {
  AuditFinding,
  AuditReport,
  FactorRenamePayload,
} from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";
import type { FactorProposal, Proposal } from "@/api/types";
import { buildFactorRows } from "./FindingDetailsEditor";

/** ID-hardening: when the finding's ``rename.fv_pairs`` carries the
 *  paired gold ``FactorValue``'s stable Gemma id (``gold_id``), the
 *  FV pairing resolves the current/gold FV by an id join — even when
 *  the biomaterial sets are ambiguous / reordered / non-equal so the
 *  legacy exact-set-equality fallback would miss. Falls back to
 *  biomaterial overlap when no id is present (no regression). */

function agentGenotype(bms: string[]): FactorProposal {
  return {
    category: { label: "genotype", uri: null, resolver: null, score: null },
    name_in_design: "genotype",
    factor_values: [
      {
        free_text_label: "wild type genotype",
        is_baseline: true,
        statements: [
          {
            category: { label: "genotype", uri: null },
            subject: { label: "wild type genotype", uri: "efo:wt" },
            predicate: null,
            object: null,
          },
        ],
        biomaterial_short_names: bms,
      },
    ],
  } as unknown as FactorProposal;
}

function rename(goldId: number | null): FactorRenamePayload {
  return {
    agent: { category: { label: "genotype", uri: null }, factor_type: "categorical" },
    gold: { category: { label: "genotype", uri: null }, factor_type: "" },
    direction: "equivalent",
    concept_diff_kind: "none",
    fv_pairs: [
      {
        agent: { label: "wild type genotype", uri: "efo:wt" },
        gold: { label: "wild type genotype", uri: "efo:wt" },
        equivalence: "exact",
        ...(goldId != null ? { gold_id: goldId } : {}),
      },
    ],
  } as unknown as FactorRenamePayload;
}

function mkFinding(goldId: number | null): AuditFinding {
  return {
    target_kind: "factor",
    target_id: "factor:70503",
    severity: "minor",
    issue_code: "calibration_factor_match_near",
    rationale: "Is factor `genotype` correctly captured?",
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    gold_target_index: 0,
    rename: rename(goldId),
  } as unknown as AuditFinding;
}

function mkReport(agentBms: string[]): AuditReport {
  const proposal = {
    experiment_id: 1,
    experiment_short_name: "GSE-test",
    factors: [agentGenotype(agentBms)],
    tags: [],
    publications: [],
    notes: "",
    evidence: { subtask_decisions: [], extra: {} },
  } as unknown as Proposal;
  return {
    audit_id: "a1",
    experiment_id: 1,
    experiment_short_name: "GSE-test",
    audited_at: "2026-07-01T00:00:00Z",
    model: "claude-sonnet",
    scope: { include: [] },
    findings: [],
    evidence: { comparison_proposal: proposal },
    summary: { overall_verdict: "ok", n_blocker: 0, n_major: 0, n_minor: 0, n_ok: 1 },
    dispositions: [],
  } as unknown as AuditReport;
}

/** Live design whose genotype factor (gold_target_index=0) has TWO
 *  FVs. The correct paired gold FV (id 555) carries EXTRA biomaterials
 *  vs the agent's set, so the set-equality biomaterial fallback cannot
 *  match it — only the id join can. */
function designAmbiguousBms(): Design {
  return {
    experiment_id: 1,
    experiment_short_name: "GSE-test",
    factors: [
      {
        id: 70503,
        name: "genotype",
        category: { label: "genotype", uri: null },
        description: "",
        type: "categorical",
        factor_values: [
          {
            id: 555,
            free_text_label: "wild type genotype",
            is_baseline: true,
            statements: [
              {
                category: { label: "genotype", uri: null },
                subject: { label: "wild type genotype", uri: "efo:wt" },
                predicate: null,
                object: null,
              },
            ],
            // Superset of the agent set → set-equality would reject.
            biomaterial_short_names: ["G1", "G2", "G3"],
          },
          {
            id: 556,
            free_text_label: "mutant",
            is_baseline: false,
            statements: [],
            biomaterial_short_names: ["G4"],
          },
        ],
      },
    ],
    biomaterials: [],
    tags: [],
  } as unknown as Design;
}

describe("buildFactorRows — gold FV id join (rename.fv_pairs[].gold_id)", () => {
  it("resolves the Current FV by gold_id even when biomaterial sets are non-equal", () => {
    // Agent FV has [G1,G2]; correct gold FV (id 555) has [G1,G2,G3].
    // Set-equality fails, so only the id join can pair them.
    const { rows } = buildFactorRows(
      mkFinding(555),
      mkReport(["G1", "G2"]),
      designAmbiguousBms(),
    );
    const subjectRow = rows.find(
      (r) => r.fvIndex === 0 && r.rowLabel === "Subject",
    );
    expect(subjectRow).toBeDefined();
    expect(subjectRow!.currently?.label).toBe("wild type genotype");
  });

  it("falls back to biomaterial overlap when no gold_id is present", () => {
    // No gold_id on the pair → the biomaterial-set path must still
    // resolve when the sets ARE equal.
    const design = designAmbiguousBms();
    // Make the agent set equal to gold FV 555's set so the fallback
    // pairs it.
    const { rows } = buildFactorRows(
      mkFinding(null),
      mkReport(["G1", "G2", "G3"]),
      design,
    );
    const subjectRow = rows.find(
      (r) => r.fvIndex === 0 && r.rowLabel === "Subject",
    );
    expect(subjectRow).toBeDefined();
    expect(subjectRow!.currently?.label).toBe("wild type genotype");
  });

  it("without gold_id AND non-equal biomaterials, the Current FV does not resolve", () => {
    // Contrast case that proves the first test's success is due to the
    // id join, not incidental: same non-equal sets, but no gold_id.
    const { rows } = buildFactorRows(
      mkFinding(null),
      mkReport(["G1", "G2"]),
      designAmbiguousBms(),
    );
    const subjectRow = rows.find(
      (r) => r.fvIndex === 0 && r.rowLabel === "Subject",
    );
    expect(subjectRow).toBeDefined();
    // Biomaterial set-equality can't pair [G1,G2] to [G1,G2,G3];
    // currently resolves to null (no gold counterpart shown).
    expect(subjectRow!.currently).toBeNull();
  });
});
