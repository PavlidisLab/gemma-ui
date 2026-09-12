/**
 * @vitest-environment jsdom
 *
 * Render-time regression test for the three-VOICE grouping introduced
 * for ticket 83 ("too hard to tell what the proposer did vs. internal-
 * critic vs. comparison with gold").
 *
 * What this pins:
 *   - ``ThreePhaseFindingBody`` renders exactly three labelled voice
 *     groups — Proposer, Internal critic, Gold comparison — and they are
 *     DISTINCT containers (separate ``phase-group-*`` testids).
 *   - Only the gold-comparison group carries a visible marker ("sees
 *     reference"), and it is flagged ``data-phase-gold="sees-gold"``.
 *   - Reviewer LLMs sort into the correct voice (defender → proposer,
 *     boss → internal critic, arbiter → gold comparison).
 */
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";

import type { AuditFinding } from "@/api/auditTypes";

import { ThreePhaseFindingBody } from "./findingThreePhase";
import { renderWithProviders } from "./testRender";

function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    target_kind: "tag",
    target_id: "tag:cell-type/astrocyte",
    severity: "minor",
    issue_code: "calibration_agent_extra",
    rationale: "",
    rationale_summary: "",
    rationale_bin: "",
    citation: "",
    citation_url: "",
    suggested_fix: "",
    supporting_evidence: [],
    why: {
      brief: "Astrocyte is a real new cell-type property.",
      rationale: "Astrocyte cell-type tag is supported by the samples.",
      evidence: [],
      citation: "",
      citation_url: "",
    },
    reviews: [
      {
        reviewer: "defender",
        verdict: "extra_genuine_new",
        rationale: "Real new property.",
      },
      {
        reviewer: "boss",
        verdict: "kept",
        rationale: "Holistic check passes.",
      },
      {
        reviewer: "arbiter",
        verdict: "agent_correct_per_rule",
        rationale: "The proposal matches the rule.",
      },
    ],
    comparison: {
      comparator_label: "polished gold",
      judge_verdict: "agent_correct_per_rule",
      judge_rationale: "Agent proposal agrees with polished gold.",
    },
    proposer_term: { label: "astrocyte", uri: "http://CL/0000127" },
    ...overrides,
  } as unknown as AuditFinding;
}

describe("ThreePhaseFindingBody — three labelled voice groups", () => {
  it("renders three distinct phase-group containers", () => {
    renderWithProviders(
      <ThreePhaseFindingBody finding={makeFinding()} report={null} />,
    );
    const proposer = screen.getByTestId("phase-group-proposer");
    const critic = screen.getByTestId("phase-group-critic");
    const gold = screen.getByTestId("phase-group-gold");
    // Three separate containers — none nested inside another.
    expect(proposer).toBeInTheDocument();
    expect(critic).toBeInTheDocument();
    expect(gold).toBeInTheDocument();
    expect(proposer).not.toContainElement(critic);
    expect(proposer).not.toContainElement(gold);
    expect(critic).not.toContainElement(gold);
  });

  it("labels each voice with a distinct header", () => {
    renderWithProviders(
      <ThreePhaseFindingBody finding={makeFinding()} report={null} />,
    );
    expect(
      within(screen.getByTestId("phase-group-proposer")).getByText("Proposer"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("phase-group-critic")).getByText(
        "Internal critic",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("phase-group-gold")).getByText(
        "Reference comparison",
      ),
    ).toBeInTheDocument();
  });

  it("marks only the voice that sees the reference", () => {
    renderWithProviders(
      <ThreePhaseFindingBody finding={makeFinding()} report={null} />,
    );
    expect(screen.queryByText("reference-blind")).toBeNull();
    expect(screen.queryByTestId("gold-visibility-gold-blind")).toBeNull();
    expect(screen.getAllByTestId("gold-visibility-sees-gold")).toHaveLength(1);
    expect(
      within(screen.getByTestId("phase-group-gold")).getByTestId(
        "gold-visibility-sees-gold",
      ),
    ).toBeInTheDocument();

    // The container-level flag is unchanged.
    expect(screen.getByTestId("phase-group-proposer")).toHaveAttribute(
      "data-phase-gold",
      "gold-blind",
    );
    expect(screen.getByTestId("phase-group-gold")).toHaveAttribute(
      "data-phase-gold",
      "sees-gold",
    );
  });

  it("routes reviewers into their voice (defender→gold, boss→critic, arbiter→gold)", () => {
    renderWithProviders(
      <ThreePhaseFindingBody finding={makeFinding()} report={null} />,
    );
    // defender is gold-aware (reads gold): relabels to "agent defence"
    // inside the sees-gold group, NOT the gold-blind proposer group.
    expect(
      within(screen.getByTestId("phase-group-gold")).getByText(
        /agent defence/i,
      ),
    ).toBeInTheDocument();
    // boss row lands in the internal-critic group.
    expect(
      within(screen.getByTestId("phase-group-critic")).getByText(/^boss$/i),
    ).toBeInTheDocument();
    // arbiter ruling lands in the gold-comparison group.
    expect(
      within(screen.getByTestId("phase-group-gold")).getByText(/^arbiter$/i),
    ).toBeInTheDocument();
  });
});

describe("ThreePhaseFindingBody — an audit judge's reasoning", () => {
  it("is labelled as the Auditor's, not a proposer's", () => {
    renderWithProviders(
      <ThreePhaseFindingBody
        finding={makeFinding({
          judge: "statement_shape_judge",
          issue_code: "delivery_predicate_on_a_gene",
          reviews: [],
          comparison: null,
        })}
        report={null}
      />,
    );
    const group = within(screen.getByTestId("phase-group-proposer"));
    expect(group.getAllByText("Auditor").length).toBeGreaterThan(0);
    expect(group.getAllByText("Why flagged").length).toBeGreaterThan(0);
    expect(group.queryByText("Proposer")).toBeNull();
    expect(group.queryByText("Why proposed")).toBeNull();
  });

  it("keeps the proposer labels when no judge is named", () => {
    renderWithProviders(
      <ThreePhaseFindingBody finding={makeFinding()} report={null} />,
    );
    const group = within(screen.getByTestId("phase-group-proposer"));
    expect(group.getAllByText("Why proposed").length).toBeGreaterThan(0);
  });
});
