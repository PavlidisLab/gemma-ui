/**
 * @vitest-environment jsdom
 *
 * Interactivity regression tests for ``FindingActionRow``.
 *
 * What these pin (the MATCH_DOWNGRADE_ACTION handoff, 2026-06-16):
 *
 *   - The accept (Agree) button on a downgraded ``calibration_match``
 *     viewed against an empty baseline calls ``applyDraft`` with a
 *     mutator that ACTUALLY ADDS the tag (was a silent no-op pre-
 *     handoff — disposition stamped accepted, draft unchanged).
 *
 *   - Clicking the dismiss / Reject row opens a dismiss dialog whose
 *     chips read the add-side vocabulary on a downgraded match.
 *
 *   - The dismiss-dialog confirm button reads "Save" — not the
 *     title-duplicating "Don't remove tag" override that made the
 *     dialog read as unclosable.
 *
 * These tests are tagged @critical so the precommit gate runs them
 * (see ``package.json::test:ci`` + ``.husky/pre-commit``). A
 * regression in any of the three would re-introduce one of the
 * symptoms Paul filed in MATCH_DOWNGRADE_ACTION_HANDOFF.md.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";

import type { AuditFinding } from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";

import { FindingActionRow } from "./findingCard";
import {
  renderWithProviders,
  makeAuditCtx,
  makeDraftCtx,
} from "./testRender";

function tagMatchFinding(): AuditFinding {
  return {
    target_kind: "tag",
    target_id: "tag:cell-type/astrocyte",
    severity: "ok",
    issue_code: "calibration_match",
    rationale: "Is `cell type: astrocyte` correctly assigned?",
    rationale_summary: "",
    rationale_bin: "",
    citation: "",
    citation_url: "",
    supporting_evidence: [],
    why: null,
    reviews: [],
    comparison: null,
    proposer_term: { label: "astrocyte", uri: "http://CL/0000127" },
  } as unknown as AuditFinding;
}

function emptyDraft(): Design {
  return {
    tags: [],
    factors: [],
    name: "",
    title: "",
    description: "",
    experimentId: 1,
    experimentShortName: "GSE0",
    taxon: null,
    biomaterials: [],
    publications: [],
  } as unknown as Design;
}

/** The structured editor (``FindingDetailsEditor``) renders for
 *  findings with ``proposer_term`` / structured comparison content
 *  — which includes our calibration_match fixture. Inside the
 *  editor, the action row uses the legacy verb-pair "Agree" /
 *  "Reject…" for the ``isTagAddFinding`` branch (which a downgraded
 *  match now flips into per
 *  MATCH_DOWNGRADE_ACTION_HANDOFF.md). Both helpers below target
 *  the editor's exact labels — the non-editor fallback would use
 *  the action-shape verbs ("Add →" / "Don't add"), but the editor
 *  wins for our fixture shape. */
function getAcceptButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Agree$/ });
}

function getDismissButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Reject…$/ });
}

describe("FindingActionRow — calibration_match against empty baseline", () => {
  it("Agree click fires the add-tag mutator against the draft", async () => {
    const finding = tagMatchFinding();
    const applyDraft = vi.fn();
    const setDisposition = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(<FindingActionRow finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding], setDisposition }),
      draft: makeDraftCtx(emptyDraft(), { apply: applyDraft }),
    });

    fireEvent.click(getAcceptButton());

    // Mutator fires synchronously off the click (handleApply runs
    // applyDraft before any await; the patch chain is async).
    expect(applyDraft).toHaveBeenCalledTimes(1);
    const mutator = applyDraft.mock.calls[0][0];
    const result = mutator(emptyDraft());
    expect(result.tags.length).toBe(1);
    expect(result.tags[0].category.label.toLowerCase()).toContain("cell type");
    expect(result.tags[0].value.label.toLowerCase()).toContain("astrocyte");
  });

  it("dismiss opens a dialog with add-side chip vocabulary", () => {
    const finding = tagMatchFinding();
    renderWithProviders(<FindingActionRow finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(emptyDraft()),
    });

    fireEvent.click(getDismissButton());

    // Dialog body should carry the add-side chip vocab. The
    // ``redundant_with_bm_source`` chip (label "Redundant") is the
    // signature key of CAL_EXTRA_TAG_DISMISS_CHIPS and does NOT
    // appear in TAG_MATCH_DISMISS_CHIPS — its presence proves the
    // downgrade-aware routing fired. (DismissDialog doesn't set
    // ``role="dialog"`` so we query the document body directly.)
    expect(screen.getByText(/Redundant/)).toBeInTheDocument();
  });

  it("dismiss dialog confirm button reads 'Save', not 'Don't remove tag'", () => {
    const finding = tagMatchFinding();
    renderWithProviders(<FindingActionRow finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(emptyDraft()),
    });

    fireEvent.click(getDismissButton());

    // The dropped ``confirmLabelOverride`` means the dialog confirm
    // button falls back to MODE_CONFIG.dismiss.confirmLabel ("Save").
    // Pre-handoff this read "Don't remove tag" — same string as the
    // dialog title — and felt unclosable. The exact-name match here
    // narrows the assertion to the confirm-row button.
    expect(
      screen.getByRole("button", { name: /^Save$/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Don't remove tag$/i }),
    ).toBeNull();
  });
});

// ``within`` would be used if DismissDialog ever grows ``role="dialog"``.
void within;
