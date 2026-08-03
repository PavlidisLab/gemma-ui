/**
 * @vitest-environment jsdom
 *
 * Render test for a TAG-REMOVAL finding in FindingDetailsEditor.
 *
 * A finding whose structured action is ``remove_tag`` must route to the
 * keep-vs-remove ("removal proposed") card — NOT the generic match
 * render. The routing keys off ``apply_action.kind``, not a hardcoded
 * issue_code list, so an agent's over-tag scan (issue_code the UI has
 * never seen, target_id shape ``tag:<cat>/<val>``) still lands the
 * removal card. Before this, such a finding fell through to the match
 * scaffold with empty comparison rows — "some kind of mess" on 27201
 * (GSE201943 granulosa-cell over-tag).
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

import type { AuditFinding } from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";

import { FindingDetailsEditor } from "./FindingDetailsEditor";
import { renderWithProviders, makeAuditCtx, makeDraftCtx } from "./testRender";

function overTagRemovalFinding(): AuditFinding {
  return {
    target_kind: "tag",
    // Entity-frame removal: slug-shaped target_id, no ``calibration:`` prefix.
    target_id: "tag:cell-type/granulosa-cell",
    severity: "major",
    // An issue_code the UI has no special-case for — must still route via
    // the apply_action.
    issue_code: "gold_polish_over_tag",
    rationale: "Cell line 'KGN' already implies the granulosa-cell identity.",
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    proposer_term: {
      label: "granulosa cell",
      uri: "http://purl.obolibrary.org/obo/CL_0000501",
    },
    apply_action: { kind: "remove_tag" },
  } as unknown as AuditFinding;
}

function designWithGranulosaTag(): Design {
  return {
    experimentId: 1,
    experimentShortName: "GSE201943",
    factors: [],
    biomaterials: [],
    tags: [
      {
        id: 7,
        category: { label: "cell type", uri: "http://purl.obolibrary.org/obo/EFO_0000324" },
        value: {
          label: "granulosa cell",
          uri: "http://purl.obolibrary.org/obo/CL_0000501",
        },
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

describe("tag removal — remove_tag routes to the keep-vs-remove card", () => {
  it("renders the removal card with the real (de-slugged) tag label, not the match scaffold", () => {
    const finding = overTagRemovalFinding();
    const design = designWithGranulosaTag();
    renderWithProviders(
      <FindingDetailsEditor finding={finding} design={design} {...noopEditorProps()} />,
      {
        audit: makeAuditCtx({ findings: [finding] }),
        draft: makeDraftCtx(design),
      },
    );
    // The removal card renders its "removal proposed" marker (the match
    // scaffold has no such marker — this is what proves the routing)...
    expect(screen.getByText("removal proposed")).toBeInTheDocument();
    // ...and the tag identity resolved from the design (real labels, not
    // the lossy ``cell-type / granulosa-cell`` slugs).
    expect(screen.getByText("cell type: granulosa cell")).toBeInTheDocument();
  });
});
