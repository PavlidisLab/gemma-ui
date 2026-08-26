/**
 * @vitest-environment jsdom
 *
 * A finding whose remedy the agent could not express.
 *
 * Real fixture, audit 45cc7771 on GSE274093: `term_grounding_judge`
 * asks whether `Rosa26fsTRAP X Nav1.8-Cre` resolves to a strain term,
 * finds nothing (custom mouse line), and says so in `blocked_reason`.
 * Every other field on the action is null.
 *
 * Before this, the card offered **"adopt Auditor's"** — an adopt for a
 * proposal the finding exists to say does not exist. Clicking it
 * adopted nothing, the button greyed, the draft never moved. Reported
 * by Paul working ticket 203: *"when I click, it greys out but nothing
 * changes."*
 *
 * 🛑 Everything here keys on SHAPE, never on the kind's name. The kind
 * is being renamed away from `needs_curator_decision`; a test that
 * matched the string would need editing to keep passing, which is
 * exactly the failure it is meant to catch.
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

import type { AuditFinding } from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";
import { FindingActionRow } from "./findingCard";
import { renderWithProviders, makeAuditCtx, makeDraftCtx } from "./testRender";

const REASON =
  "`Rosa26fsTRAP X Nav1.8-Cre` resolves to no term in the `strain` namespace; a slot URI is looked up, never invented";

function inexpressible(): AuditFinding {
  return {
    target_kind: "tag",
    target_id: "tag:strain/rosa26fstrap-x-nav1.8-cre",
    severity: "minor",
    issue_code: "ungrounded_term",
    judge: "term_grounding_judge",
    rationale:
      "Should `Rosa26fsTRAP X Nav1.8-Cre` be resolved to an ontology term? (category URI present, value URI missing)",
    suggested_fix: "Resolve `Rosa26fsTRAP X Nav1.8-Cre` to an ontology term.",
    citation: "Curation-Rules §Ontology grounding",
    apply_action: {
      // The name is incidental and on its way out. What matters is
      // that every actionable field is null and a reason is given.
      kind: "needs_curator_decision",
      new_value: null,
      new_category: null,
      statements: null,
      blocked_reason: REASON,
    },
    proposer_term: null,
    proposer_statements: [],
    supporting_evidence: [],
    why: null,
    reviews: [],
    comparison: null,
  } as unknown as AuditFinding;
}

function draftWithTheTag(): Design {
  return {
    tags: [
      {
        id: 7,
        category: { label: "strain", uri: "http://www.ebi.ac.uk/efo/EFO_0005135" },
        value: { label: "Rosa26fsTRAP X Nav1.8-Cre", uri: "" },
        inferred: false,
        statements: [],
      },
    ],
    factors: [],
    name: "",
    title: "",
    description: "",
    experimentId: 38179,
    experimentShortName: "GSE274093",
    taxon: null,
    biomaterials: [],
    publications: [],
  } as unknown as Design;
}

function mount() {
  const finding = inexpressible();
  const setDisposition = vi.fn().mockResolvedValue(undefined);
  const applyDraft = vi.fn();
  renderWithProviders(<FindingActionRow finding={finding} />, {
    audit: makeAuditCtx({ findings: [finding], setDisposition }),
    draft: makeDraftCtx(draftWithTheTag(), { apply: applyDraft }),
  });
  return { setDisposition, applyDraft };
}

const buttonTexts = () =>
  screen.queryAllByRole("button").map((b) => (b.textContent ?? "").trim());

describe("a finding the agent could not express a fix for", () => {
  it("never offers to adopt the auditor's proposal", () => {
    mount();
    const texts = buttonTexts().join(" | ");
    // The exact string Paul clicked.
    expect(texts).not.toMatch(/adopt/i);
    // And no hanging possessive naming a proposal that isn't there.
    expect(texts).not.toMatch(/Auditor's/);
  });

  it("still gives the curator a live way to rule on it", () => {
    // The point of the card is to collect a ruling. Removing the
    // misleading button must not leave a dead end.
    mount();
    const live = screen
      .queryAllByRole("button")
      .filter((b) => !(b as HTMLButtonElement).disabled);
    expect(live.length).toBeGreaterThan(0);
  });

  it("shows the agent's reason there is nothing to apply", () => {
    mount();
    // Rendered through InlineMarkdown, so the backticked terms arrive
    // as code spans and the surrounding prose as text — assert on a
    // fragment that survives that split.
    expect(
      screen.getByText(/resolves to no term in the/i),
    ).toBeInTheDocument();
  });

  it("does not leak raw backticks into the curator's view", () => {
    mount();
    const body = document.body.textContent ?? "";
    expect(body).toContain("resolves to no term in the");
    expect(body).not.toContain("`Rosa26fsTRAP");
  });
});
