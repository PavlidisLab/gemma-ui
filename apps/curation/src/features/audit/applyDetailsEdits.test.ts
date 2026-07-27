import { describe, expect, it } from "vitest";
import type {
  AppliedFix,
  AuditFinding,
  AuditReport,
} from "@/api/auditTypes";
import type { Design, Factor } from "@/features/experiment/types";
import { applyDetailsEditsToDesign } from "./applyDetailsEdits";

/**
 * Regression tests for ``applyDetailsEditsToDesign``.
 *
 * Motivating bug (the reviewer, 2026-06-12 GSE87700): a near-match finding
 * on the ``treatment`` factor proposed both a predicate
 * (``delivered to``) and an object (``mother``) to layer over gold's
 * subject-only ``ethanol`` statement. The curator clicked Agree, the
 * finding flipped to ``accepted`` and the FV showed a "modified"
 * flag — but the design statement was unchanged.
 *
 * Root cause: the loop over ``appliedFix.edits`` read ``current``
 * from the original ``goldFactor.statements[idx]`` on every
 * iteration, so the second edit's ``next = {...current, object:
 * nextTerm}`` reset the predicate slot back to its pre-edit value.
 * Each setStatement call was based on stale state — the second one
 * silently clobbered the first.
 *
 * Fix: re-resolve the gold FV against the ``mutated`` design (not
 * the original) so prior edits in this same apply pass are visible.
 */

function design(opts: { factors: Factor[]; biomaterials?: never }): Design {
  return {
    experiment_id: 1,
    experiment_short_name: "GSE-test",
    factors: opts.factors,
    biomaterials: [],
    tags: [],
  };
}

function factor(opts: {
  id: number;
  categoryLabel: string;
  fvs: Array<{
    id: number;
    label: string;
    bms: string[];
    statements: Array<{
      subject: { label: string; uri?: string | null };
      predicate?: { label: string; uri?: string | null } | null;
      object?: { label: string; uri?: string | null } | null;
    }>;
  }>;
}): Factor {
  return {
    id: opts.id,
    name: opts.categoryLabel,
    category: { label: opts.categoryLabel, uri: null },
    description: "",
    type: "categorical",
    factor_values: opts.fvs.map((fv) => ({
      id: fv.id,
      free_text_label: fv.label,
      is_baseline: false,
      biomaterial_short_names: fv.bms,
      statements: fv.statements.map((s) => ({
        category: { label: opts.categoryLabel, uri: null },
        subject: { label: s.subject.label, uri: s.subject.uri ?? null },
        predicate: s.predicate
          ? { label: s.predicate.label, uri: s.predicate.uri ?? null }
          : null,
        object: s.object
          ? { label: s.object.label, uri: s.object.uri ?? null }
          : null,
      })),
    })),
  };
}

function mkReport(): AuditReport {
  return {
    audit_id: "test-audit",
    audited_at: "2026-06-12T00:00:00Z",
    experiment_id: 1,
    experiment_short_name: "GSE-test",
    model: "test",
    scope: { include: ["factors"] },
    kind: "audit",
    summary: { n_blocker: 0, n_major: 0, n_minor: 0, n_ok: 0, overall_verdict: "clean" },
    findings: [],
    evidence: {
      preboarding_excerpt: "",
      paper_source: null,
      paper_excerpt: "",
      comparison_proposal: {
        proposal_id: null,
        experiment_id: 1,
        experiment_short_name: "GSE-test",
        submitted_by: "agent",
        submitted_at: "2026-06-12T00:00:00Z",
        model: "agent",
        status: "pending",
        evidence: {
          preboarding_excerpt: "",
          paper_source: null,
          paper_excerpt: "",
          exemplar_experiment_ids: [],
          extra: {},
        },
        tags: [],
        factors: [
          {
            category: { label: "treatment", uri: null, resolver: null, score: null },
            name_in_design: "treatment",
            factor_values: [
              {
                free_text_label: "ethanol",
                is_baseline: false,
                biomaterial_short_names: ["GSM1", "GSM2", "GSM3"],
                statements: [
                  {
                    category: { label: "treatment", uri: null, resolver: null, score: null },
                    subject: {
                      label: "ethanol",
                      uri: "http://purl.obolibrary.org/obo/CHEBI_16236",
                      resolver: null,
                      score: null,
                    },
                    predicate: {
                      label: "delivered to",
                      uri: "http://purl.obolibrary.org/obo/RO_0002488",
                      resolver: null,
                      score: null,
                    },
                    object: {
                      label: "mother",
                      uri: null,
                      resolver: null,
                      score: null,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    dispositions: [],
    finalized_at: null,
    finalized_by: null,
    finalized_notes: null,
  };
}

function mkFinding(rationale: string): AuditFinding {
  return {
    target_kind: "factor",
    target_id: "factor:treatment",
    severity: "ok",
    issue_code: "calibration_factor_match_exact",
    rationale,
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    // Both indexes point at index 0 in their respective lists
    // (design.factors / comparison_proposal.factors). Required for
    // ``resolveGoldFactor`` / ``resolveAgentFactor`` to find the
    // factor in the test fixture.
    gold_target_index: 0,
    agent_target_index: 0,
  };
}

describe("applyDetailsEditsToDesign — multi-slot edits on the same statement", () => {
  it("applies predicate + object edits in a single pass without one clobbering the other (GSE87700 case)", () => {
    // Gold: subject-only ``ethanol`` statement (no predicate, no
    // object). Agent proposed layering predicate ``delivered to`` +
    // object ``mother`` over it. Curator confirms both rows.
    const d = design({
      factors: [
        factor({
          id: 100,
          categoryLabel: "treatment",
          fvs: [
            {
              id: 1000,
              label: "ethanol",
              bms: ["GSM1", "GSM2", "GSM3"],
              statements: [{ subject: { label: "ethanol", uri: "http://purl.obolibrary.org/obo/CHEBI_16236" } }],
            },
          ],
        }),
      ],
    });
    const finding = mkFinding("Treatment factor matches; layer extras on FV 1.");
    const report = mkReport();
    const appliedFix: AppliedFix = {
      kind: "details_edit",
      note: null,
      edits: [
        {
          path: "fv[0].statements[0].predicate",
          ok: true,
          to_label: "delivered to",
          to_uri: "http://purl.obolibrary.org/obo/RO_0002488",
          from_label: "delivered to",
          from_uri: "http://purl.obolibrary.org/obo/RO_0002488",
          note: "pick=proposal",
        },
        {
          path: "fv[0].statements[0].object",
          ok: true,
          to_label: "mother",
          to_uri: null,
          from_label: "mother",
          from_uri: null,
          note: "pick=proposal",
        },
      ],
    };
    const next = applyDetailsEditsToDesign(d, finding, report, appliedFix);
    const ethanolFv = next.factors[0].factor_values[0];
    const stmt = ethanolFv.statements[0];
    // BOTH the predicate AND the object must survive — pre-fix, the
    // second iteration overwrote the first because ``current`` was
    // read from the original goldFactor, not from ``mutated``.
    expect(stmt.subject?.label).toBe("ethanol");
    expect(stmt.predicate?.label).toBe("delivered to");
    expect(stmt.predicate?.uri).toBe(
      "http://purl.obolibrary.org/obo/RO_0002488",
    );
    expect(stmt.object?.label).toBe("mother");
  });

  it("applies edits in reverse order without losing the earlier slot either", () => {
    // Order shouldn't matter: same predicate + object, but the
    // edits[] array starts with object then predicate. Tests the
    // symmetric pre-fix failure mode.
    const d = design({
      factors: [
        factor({
          id: 100,
          categoryLabel: "treatment",
          fvs: [
            {
              id: 1000,
              label: "ethanol",
              bms: ["GSM1", "GSM2", "GSM3"],
              statements: [{ subject: { label: "ethanol", uri: "http://purl.obolibrary.org/obo/CHEBI_16236" } }],
            },
          ],
        }),
      ],
    });
    const appliedFix: AppliedFix = {
      kind: "details_edit",
      note: null,
      edits: [
        {
          path: "fv[0].statements[0].object",
          ok: true,
          to_label: "mother",
          to_uri: null,
          from_label: "mother",
          from_uri: null,
          note: "pick=proposal",
        },
        {
          path: "fv[0].statements[0].predicate",
          ok: true,
          to_label: "delivered to",
          to_uri: "http://purl.obolibrary.org/obo/RO_0002488",
          from_label: "delivered to",
          from_uri: "http://purl.obolibrary.org/obo/RO_0002488",
          note: "pick=proposal",
        },
      ],
    };
    const next = applyDetailsEditsToDesign(d, mkFinding("ok"), mkReport(), appliedFix);
    const stmt = next.factors[0].factor_values[0].statements[0];
    expect(stmt.subject?.label).toBe("ethanol");
    expect(stmt.predicate?.label).toBe("delivered to");
    expect(stmt.object?.label).toBe("mother");
  });

  it("preserves the original subject when only patching predicate + object", () => {
    const d = design({
      factors: [
        factor({
          id: 100,
          categoryLabel: "treatment",
          fvs: [
            {
              id: 1000,
              label: "ethanol",
              bms: ["GSM1", "GSM2", "GSM3"],
              statements: [
                {
                  subject: { label: "ethanol", uri: "http://purl.obolibrary.org/obo/CHEBI_16236" },
                },
              ],
            },
          ],
        }),
      ],
    });
    const appliedFix: AppliedFix = {
      kind: "details_edit",
      note: null,
      edits: [
        {
          path: "fv[0].statements[0].predicate",
          ok: true,
          to_label: "delivered to",
          to_uri: null,
          from_label: "delivered to",
          from_uri: null,
          note: "pick=proposal",
        },
      ],
    };
    const next = applyDetailsEditsToDesign(d, mkFinding("ok"), mkReport(), appliedFix);
    const stmt = next.factors[0].factor_values[0].statements[0];
    expect(stmt.subject?.label).toBe("ethanol");
    expect(stmt.subject?.uri).toBe(
      "http://purl.obolibrary.org/obo/CHEBI_16236",
    );
    expect(stmt.predicate?.label).toBe("delivered to");
  });
});
