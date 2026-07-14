/**
 * @vitest-environment jsdom
 *
 * Render-time regression tests for ``CompactFindingCard`` titles.
 *
 * What these pin: the TITLE on the collapsed card matches the
 * SHAPE of the underlying finding, including the cross-baseline
 * downgrade introduced by commit ed4f25f (2026-06-16). Six base
 * shapes:
 *
 *   - factor-match-exact (both sides have the factor) → "FACTOR MATCH"
 *   - factor-extra (only agent)                       → "ADD FACTOR"
 *   - factor-gold-only-miss (only gold)               → "REMOVE FACTOR"
 *   - tag-match  (both sides have the tag)            → "TAG MATCH"
 *   - tag-extra (only agent)                          → "ADD TAG"
 *   - tag-gold-only-miss (only gold)                  → "REMOVE TAG"
 *
 * Plus the cross-baseline downgrade variants — the GSE110721 ticket
 * 55 / 56 bug shape — where a stored *_match is viewed against a
 * draft baseline that doesn't carry the entity. The title flips to
 * the Add label so it agrees with the body's "Current: no entry".
 *
 * Coverage rationale: ANY of these would have caught the
 * ``useMemo`` crash this morning (the card refused to mount at all)
 * AND the title-vs-body mismatch ed4f25f fixed.
 */
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";

import type { AuditFinding } from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";

import { CompactFindingCard } from "./findingCard";
import {
  renderWithProviders,
  makeAuditCtx,
  makeDraftCtx,
} from "./testRender";

function tagFinding(
  overrides: Partial<AuditFinding> = {},
): AuditFinding {
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
    ...overrides,
  } as unknown as AuditFinding;
}

function factorFinding(
  overrides: Partial<AuditFinding> = {},
): AuditFinding {
  return {
    target_kind: "factor",
    target_id: "factor:treatment",
    severity: "ok",
    issue_code: "calibration_factor_match_exact",
    rationale: "",
    rationale_summary: "",
    rationale_bin: "",
    citation: "",
    citation_url: "",
    supporting_evidence: [],
    why: null,
    reviews: [],
    comparison: null,
    ...overrides,
  } as unknown as AuditFinding;
}

function draftWithTag(category: string, value: string): Design {
  return {
    tags: [
      {
        category: { label: category, uri: null },
        value: { label: value, uri: null },
      },
    ],
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

function draftWithFactor(category: string): Design {
  return {
    tags: [],
    factors: [
      {
        category: { label: category, uri: null },
        factor_values: [],
      },
    ],
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

/** Match the title span exactly by its trimmed text content
 *  (case-insensitive). Title is rendered as
 *  ``<span class="...uppercase...">{findingActionLabel(...)}</span>``
 *  so the direct text content equals the action label verbatim.
 *  Uppercase comes from CSS — the raw text stays Mixed-Case.
 *
 *  Looser ``includes`` matching catches ancestor containers too and
 *  trips ``getByText`` on "multiple elements". This matcher narrows
 *  to nodes whose own trimmed text is exactly the label. */
function titleMatcher(label: string) {
  const lower = label.trim().toLowerCase();
  return (content: string, _node: Element | null) =>
    (content || "").trim().toLowerCase() === lower;
}

describe("CompactFindingCard — base titles (no baseline downgrade)", () => {
  it('tag-match renders "Tag match"', () => {
    const finding = tagFinding();
    const draft = draftWithTag("cell type", "astrocyte");
    renderWithProviders(<CompactFindingCard finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(draft),
    });
    expect(screen.getByText(titleMatcher("Tag match"))).toBeInTheDocument();
  });

  it('tag-extra renders "Add tag"', () => {
    const finding = tagFinding({
      issue_code: "calibration_agent_extra",
      target_id: "calibration:extra:cell type/astrocyte",
    });
    renderWithProviders(<CompactFindingCard finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(emptyDraft()),
    });
    expect(screen.getByText(titleMatcher("Add tag"))).toBeInTheDocument();
  });

  it('tag-gold-only-miss renders "Remove tag"', () => {
    const finding = tagFinding({
      issue_code: "calibration_gold_only_miss",
      target_id: "tag:cell-type/astrocyte",
      severity: "minor",
    });
    const draft = draftWithTag("cell type", "astrocyte");
    renderWithProviders(<CompactFindingCard finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(draft),
    });
    expect(screen.getByText(titleMatcher("Remove tag"))).toBeInTheDocument();
  });

  it('factor-match-exact renders "Factor match"', () => {
    const finding = factorFinding();
    const draft = draftWithFactor("treatment");
    renderWithProviders(<CompactFindingCard finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(draft),
    });
    expect(screen.getByText(titleMatcher("Factor match"))).toBeInTheDocument();
  });

  it('factor-extra renders "Add factor"', () => {
    const finding = factorFinding({
      issue_code: "calibration_factor_extra",
      target_id: "calibration:factor_extra:treatment",
    });
    renderWithProviders(<CompactFindingCard finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(emptyDraft()),
    });
    expect(screen.getByText(titleMatcher("Add factor"))).toBeInTheDocument();
  });

  it('factor-gold-only-miss renders "Remove factor"', () => {
    const finding = factorFinding({
      issue_code: "calibration_factor_gold_only_miss",
      severity: "minor",
    });
    const draft = draftWithFactor("treatment");
    renderWithProviders(<CompactFindingCard finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(draft),
    });
    expect(screen.getByText(titleMatcher("Remove factor"))).toBeInTheDocument();
  });
});

describe("CompactFindingCard — cross-baseline match-downgrade (GSE110721 bug shape)", () => {
  it('tag-match against an empty draft baseline downgrades to "Add tag"', () => {
    // The audit stored ``calibration_match`` because the audit-time
    // baseline (live Gemma) carried ``cell type: astrocyte``. The
    // curator is now viewing against polished_gold which does NOT
    // carry that tag. Title must read "Add tag" so it agrees with
    // the body's "Current: no entry".
    const finding = tagFinding();
    renderWithProviders(<CompactFindingCard finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(emptyDraft()),
    });
    expect(screen.getByText(titleMatcher("Add tag"))).toBeInTheDocument();
    expect(screen.queryByText(titleMatcher("Tag match"))).toBeNull();
  });

  it('tag-match against a draft that DOES carry the tag keeps "Tag match"', () => {
    const finding = tagFinding();
    const draft = draftWithTag("cell type", "astrocyte");
    renderWithProviders(<CompactFindingCard finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(draft),
    });
    expect(screen.getByText(titleMatcher("Tag match"))).toBeInTheDocument();
  });

  it('factor-match against an empty draft downgrades to "Add factor"', () => {
    const finding = factorFinding();
    renderWithProviders(<CompactFindingCard finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(emptyDraft()),
    });
    expect(screen.getByText(titleMatcher("Add factor"))).toBeInTheDocument();
    expect(screen.queryByText(titleMatcher("Factor match"))).toBeNull();
  });

  it("renders without crashing when draft is null (no draft loaded yet)", () => {
    // The useMemo-import-missing bug shape — ANY render of the card
    // with a null-draft early-render path crashed the entire tree.
    // Pin it: a null draft is a valid pre-load state and must not
    // throw.
    const finding = tagFinding();
    renderWithProviders(<CompactFindingCard finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(null),
    });
    expect(screen.getByText(titleMatcher("Tag match"))).toBeInTheDocument();
  });
});

describe("CompactFindingCard — tag statement rendering (calibration_tag_match_near)", () => {
  // A tag near-match whose statements moved renders the proposed
  // subject·predicate·object IN PLACE OF the bare value chip — not
  // appended (the reverted 2026-07-13 prototype duplicated the gene:
  // "Utrn protein · Utrn · has_genotype · Heterozygous", which
  // overflowed). TAG_STATEMENT_APPLY_AND_RENDER_UI_2026_07_13.md.
  it("shows the S·P·O sequence and does NOT duplicate the value label", () => {
    const finding = tagFinding({
      issue_code: "calibration_tag_match_near",
      // Slug matches the draft tag (category "genotype", value
      // "Utrn protein" → "utrn-protein") so the live label/URI resolve.
      target_id: "tag:genotype/utrn-protein",
      proposer_term: { label: "Utrn", uri: "http://gene/Utrn" },
      proposer_statements: [
        {
          category: { label: "genotype", uri: null },
          subject: { label: "Utrn", uri: "http://gene/Utrn" },
          predicate: { label: "has_genotype", uri: "http://TGEMO/00166" },
          object: { label: "Heterozygous", uri: "http://TGEMO/00003" },
        },
      ],
    } as unknown as AuditFinding);
    const draft = draftWithTag("genotype", "Utrn protein");
    renderWithProviders(<CompactFindingCard finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(draft),
    });
    // Statement parts render.
    expect(screen.getByText("has_genotype")).toBeInTheDocument();
    expect(screen.getByText("Heterozygous")).toBeInTheDocument();
    // Category still shows.
    expect(screen.getByText("genotype")).toBeInTheDocument();
    // The value chip ("Utrn protein") is REPLACED by the statement, so
    // the full value label does not appear — no duplicate gene render.
    expect(screen.queryByText("Utrn protein")).toBeNull();
  });

  it("shows the S·P·O on a statement-bearing ADD TAG (calibration_agent_extra), value not duplicated", () => {
    // TAG_STATEMENT_ADD_TAG_APPLY_BUG_2026_07_13.md facet 2 — a genuinely
    // new statement-bearing tag (Dmd) renders the same S·P·O the
    // near-match gets, not a bare gene chip.
    const finding = tagFinding({
      issue_code: "calibration_agent_extra",
      target_id: "tag:genotype/dmd",
      proposer_term: { label: "Dmd", uri: "http://ncbi_gene/13405" },
      proposer_statements: [
        {
          category: { label: "genotype", uri: null },
          subject: { label: "Dmd", uri: "http://ncbi_gene/13405" },
          predicate: { label: "has_genotype", uri: "http://TGEMO/00166" },
          object: { label: "mdx", uri: null },
        },
      ],
    } as unknown as AuditFinding);
    // Dmd is a NEW tag — the draft doesn't carry it.
    renderWithProviders(<CompactFindingCard finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(emptyDraft()),
    });
    expect(screen.getByText("has_genotype")).toBeInTheDocument();
    expect(screen.getByText("mdx")).toBeInTheDocument();
  });

  it("shows the PROPOSED value in the header for a value-concept near-match (strain → mdx)", () => {
    // Paul 2026-07-13: a value near-match card is about adopting the
    // proposal, so the title should read the proposed value (mdx), not
    // the current tag (C57BL/10). No statements on this one.
    const finding = tagFinding({
      issue_code: "calibration_tag_match_near",
      target_id: "tag:strain/c57bl/10",
      proposer_term: {
        label: "mdx",
        uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00180",
      },
      apply_action: {
        kind: "replace_tag",
        new_value: "mdx",
        new_value_uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00180",
        new_category: null,
      },
    } as unknown as AuditFinding);
    const draft = draftWithTag("strain", "C57BL/10");
    renderWithProviders(<CompactFindingCard finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(draft),
    });
    // Header shows the proposal, not the current value.
    expect(screen.getByText("mdx")).toBeInTheDocument();
    expect(screen.queryByText("C57BL/10")).toBeNull();
    // Category (unchanged) still shows.
    expect(screen.getByText("strain")).toBeInTheDocument();
  });

  it("renders value-only for a plain tag near-match with no statement detail", () => {
    // A near-match carrying subject-only statements (no predicate /
    // object) has nothing structured to show → falls back to the
    // value chip, unchanged.
    const finding = tagFinding({
      issue_code: "calibration_tag_match_near",
      target_id: "tag:cell-type/astrocyte",
      proposer_statements: [
        { category: null, subject: { label: "astrocyte", uri: null } },
      ],
    } as unknown as AuditFinding);
    const draft = draftWithTag("cell type", "astrocyte");
    renderWithProviders(<CompactFindingCard finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(draft),
    });
    expect(screen.getByText("astrocyte")).toBeInTheDocument();
  });
});
