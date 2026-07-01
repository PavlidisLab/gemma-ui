import { describe, expect, it } from "vitest";
import type { AuditFinding, AuditReport, FactorRenamePayload } from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";
import type { FactorProposal, Proposal } from "@/api/types";
import { buildFactorRows } from "./FindingDetailsEditor";

/** Regression: GSE306566 genotype card.
 *
 *  The finding is a calibration_factor_match_exact — the UI badges it
 *  "FACTOR MATCH" against an existing gold factor — but the "Current"
 *  (gold) column rendered "(no factor)" / "(no FV)". The gold content
 *  IS available two ways: the live design factor, and the finding's
 *  self-carried ``rename`` payload (``gold`` FactorRef + ``fv_pairs``,
 *  baked in by the calibration builder so the gold side is
 *  self-describing). The card must render the matched gold regardless
 *  of whether the live-design lookup resolves — otherwise it claims a
 *  match it doesn't show.
 *
 *  Real data (from ticket 86, GSE306566, factor:70503): the agent
 *  "wild type genotype" FV and the gold one share the SAME 17
 *  biomaterials; ``rename.fv_pairs`` carries the pairing. */

const WT_BMS = [
  "GSM9203483", "GSM9203484", "GSM9203485", "GSM9203489", "GSM9203490",
  "GSM9203491", "GSM9203492", "GSM9203497", "GSM9203498", "GSM9203499",
  "GSM9203500", "GSM9203505", "GSM9203506", "GSM9203507", "GSM9203514",
  "GSM9203515", "GSM9203516",
];

function agentGenotype(): FactorProposal {
  return {
    category: { label: "genotype", uri: null, resolver: null, score: null },
    name_in_design: "genotype",
    factor_values: [
      {
        free_text_label: "wild type genotype",
        is_baseline: true,
        statements: [
          {
            category: { label: "genotype", uri: "http://www.ebi.ac.uk/efo/EFO_0000513" },
            subject: {
              label: "wild type genotype",
              uri: "http://www.ebi.ac.uk/efo/EFO_0005168",
            },
            predicate: null,
            object: null,
          },
        ],
        biomaterial_short_names: WT_BMS,
      },
    ],
  } as unknown as FactorProposal;
}

function renameWithGold(): FactorRenamePayload {
  return {
    agent: { category: { label: "genotype", uri: null }, factor_type: "categorical" },
    gold: { category: { label: "genotype", uri: null }, factor_type: "" },
    direction: "equivalent",
    concept_diff_kind: "none",
    fv_pairs: [
      {
        agent: { label: "wild type genotype", uri: "http://www.ebi.ac.uk/efo/EFO_0005168" },
        gold: { label: "wild type genotype", uri: "http://www.ebi.ac.uk/efo/EFO_0005168" },
        equivalence: "exact",
        gold_statement: {
          subject: {
            label: "wild type genotype",
            uri: "http://www.ebi.ac.uk/efo/EFO_0005168",
          },
          predicate: null,
          object: null,
        },
        gold_biomaterial_short_names: WT_BMS,
      },
    ],
  } as unknown as FactorRenamePayload;
}

function mkFinding(): AuditFinding {
  return {
    target_kind: "factor",
    target_id: "factor:70503",
    severity: "ok",
    issue_code: "calibration_factor_match_exact",
    rationale: "Is factor `genotype` correctly captured?",
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    gold_target_index: 1,
    rename: renameWithGold(),
  } as unknown as AuditFinding;
}

function mkReport(): AuditReport {
  const proposal = {
    experiment_id: 86321,
    experiment_short_name: "GSE306566",
    factors: [agentGenotype()],
    tags: [],
    publications: [],
    notes: "",
    evidence: { subtask_decisions: [], extra: {} },
  } as unknown as Proposal;
  return {
    audit_id: "a1",
    experiment_id: 86321,
    experiment_short_name: "GSE306566",
    audited_at: "2026-07-01T00:00:00Z",
    model: "claude-sonnet",
    scope: { include: [] },
    findings: [],
    evidence: { comparison_proposal: proposal },
    summary: { overall_verdict: "ok", n_blocker: 0, n_major: 0, n_minor: 0, n_ok: 1 },
    dispositions: [],
  } as unknown as AuditReport;
}

/** Design whose genotype factor at gold_target_index=1 has NO usable
 *  factor_values — the base=preboard / snapshot case that made the
 *  live-design pairing collapse. The self-carried rename must cover it. */
function designNoUsableGoldFvs(): Design {
  return {
    experiment_id: 86321,
    experiment_short_name: "GSE306566",
    factors: [
      { id: 70496, name: "collection of material", category: { label: "collection of material", uri: null }, description: "", type: "categorical", factor_values: [] },
      { id: 70503, name: "genotype", category: { label: "genotype", uri: null }, description: "", type: "categorical", factor_values: [] },
      { id: 70711, name: "block", category: { label: "block", uri: null }, description: "", type: "categorical", factor_values: [] },
    ],
    biomaterials: [],
    tags: [],
  } as unknown as Design;
}

describe("buildFactorRows — exact factor match renders self-carried gold", () => {
  it("Current column shows the matched gold FV when the live design lacks usable FVs", () => {
    const { rows } = buildFactorRows(mkFinding(), mkReport(), designNoUsableGoldFvs());
    const wtRow = rows.find(
      (r) => r.fvIndex !== null && r.proposal.label === "wild type genotype",
    );
    expect(wtRow).toBeDefined();
    // The bug: currently collapses to empty ("(no FV)") even though the
    // finding carries the matched gold FV in rename.fv_pairs.
    expect(wtRow!.currently?.label).toBe("wild type genotype");
  });

  it("Category row shows the matched gold factor (not '(no factor)')", () => {
    const { rows } = buildFactorRows(mkFinding(), mkReport(), designNoUsableGoldFvs());
    const catRow = rows.find((r) => r.rowLabel === "Category");
    expect(catRow).toBeDefined();
    expect(catRow!.currently?.label).toBe("genotype");
  });

  it("Current column resolves with no live design at all (pure self-carry)", () => {
    const { rows } = buildFactorRows(mkFinding(), mkReport(), null);
    const wtRow = rows.find(
      (r) => r.fvIndex !== null && r.proposal.label === "wild type genotype",
    );
    expect(wtRow).toBeDefined();
    expect(wtRow!.currently?.label).toBe("wild type genotype");
  });
});
