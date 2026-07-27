/**
 * @vitest-environment jsdom
 *
 * End-to-end render test for the tag near-match statement DELTA.
 *
 * Design review 2026-07-13: a tag near-match must show the Current-vs-Proposed
 * delta the way factors / FVs do — not just the proposed statement on
 * the card header. The delta lives in ``TagDetailBlock`` (inside
 * ``FindingDetailsEditor``): the "<proposer> says" line renders the
 * proposed subject·predicate·object, the "Current" line renders the
 * existing (bare) tag. This test mounts the real editor and asserts
 * both sides render, so a regression in the row builder OR the
 * TagDetailBlock render surfaces immediately.
 *
 * See TAG_STATEMENT_APPLY_AND_RENDER_UI_2026_07_13.md.
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

import type { AuditFinding } from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";

import { FindingDetailsEditor } from "./FindingDetailsEditor";
import { renderWithProviders, makeAuditCtx, makeDraftCtx } from "./testRender";

const utrnStmt = {
  category: { label: "genotype", uri: null },
  subject: { label: "Utrn", uri: "http://gene/Utrn" },
  predicate: { label: "has_genotype", uri: "http://TGEMO/00166" },
  object: { label: "Heterozygous", uri: "http://TGEMO/00003" },
};

function nearMatchFinding(): AuditFinding {
  return {
    target_kind: "tag",
    target_id: "tag:genotype/utrn-[mouse]-utrophin",
    severity: "minor",
    issue_code: "calibration_tag_match_near",
    rationale: "Adds the zygosity statement to the existing bare Utrn tag.",
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    proposer_term: { label: "Utrn", uri: "http://gene/Utrn" },
    proposer_statements: [utrnStmt],
    apply_action: { kind: "replace_tag", statements: [utrnStmt] },
  } as unknown as AuditFinding;
}

function designWithBareUtrn(): Design {
  return {
    experimentId: 1,
    experimentShortName: "GSE84876",
    factors: [],
    biomaterials: [],
    tags: [
      {
        id: 3,
        category: { label: "genotype", uri: "http://EFO/0000513" },
        value: { label: "Utrn [mouse] utrophin", uri: "http://gene/Utrn" },
      },
    ],
  } as unknown as Design;
}

function noopEditorProps() {
  return {
    report: null,
    currentDisposition: "pending" as const,
    onSave: vi.fn().mockResolvedValue(undefined),
    onAgree: vi.fn(),
    onDismiss: vi.fn(),
    onPark: vi.fn(),
    onUndo: vi.fn(),
  };
}

describe("tag near-match — statement delta in FindingDetailsEditor", () => {
  it("renders the proposed S·P·O on the proposer side and the bare tag on the Current side", () => {
    const finding = nearMatchFinding();
    const design = designWithBareUtrn();
    renderWithProviders(
      <FindingDetailsEditor finding={finding} design={design} {...noopEditorProps()} />,
      {
        audit: makeAuditCtx({ findings: [finding] }),
        draft: makeDraftCtx(design),
      },
    );
    // Proposed side carries the added statement.
    expect(screen.getByText("has_genotype")).toBeInTheDocument();
    expect(screen.getByText("Heterozygous")).toBeInTheDocument();
    // Current side still shows the existing (bare) tag value — the two
    // sides side by side ARE the delta.
    expect(screen.getByText("Utrn [mouse] utrophin")).toBeInTheDocument();
  });
});
