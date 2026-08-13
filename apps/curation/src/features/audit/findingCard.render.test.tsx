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
    // Design review 2026-07-13: a value near-match card is about adopting the
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

describe("CompactFindingCard — slug-fallback label casing", () => {
  it('restores "FVB/N" case from apply_action instead of the lowercased slug', () => {
    // Regression (design review 2026-07-19): a gold_only_miss tag whose target_id
    // slug misses the draft falls back to the slug for its display
    // label — and ``slug()`` lowercases, so "FVB/N" rendered as
    // "fvb/n". The value the Add button writes (apply_action.new_value)
    // keeps the real case, so the chip must show that, not the slug.
    const finding = tagFinding({
      issue_code: "calibration_gold_only_miss",
      target_id: "tag:strain/fvb/n",
      rationale: "",
      // Agent didn't propose — but it resolved the term, so the chip is
      // green via proposer_term.uri while the label came from the slug.
      proposer_term: {
        label: "FVB/N",
        uri: "http://purl.obolibrary.org/obo/EFO_0022467",
      },
      apply_action: {
        kind: "add_tag",
        new_category: "strain",
        new_value: "FVB/N",
        new_value_uri: "http://purl.obolibrary.org/obo/EFO_0022467",
      },
    } as unknown as AuditFinding);
    // Empty draft → the target_id slug misses, forcing the slug
    // fallback that lowercases.
    renderWithProviders(<CompactFindingCard finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(emptyDraft()),
    });
    expect(screen.getByText("FVB/N")).toBeInTheDocument();
    expect(screen.queryByText("fvb/n")).toBeNull();
  });
});

describe("CompactFindingCard — slug-fallback label punctuation", () => {
  // The casing test above uses "FVB/N", whose slug ("fvb/n") contains
  // no dash, so deslugging is a no-op and a case-insensitive guard was
  // enough. Every label whose slug DOES carry a dash took the opposite
  // path: deslug turned the dash into a space, the candidate no longer
  // matched case-insensitively, and the guard rejected the real label
  // and left the slug on screen. Reported by cab 2026-08-13 against
  // ticket 181 ("ADD TAG — cell line : bv 2").
  it('restores "BV-2" from apply_action instead of showing "bv 2"', () => {
    const finding = tagFinding({
      issue_code: "calibration_agent_extra",
      target_id: "tag:cell-line/bv-2",
      rationale: "",
      proposer_term: null,
      apply_action: {
        kind: "add_tag",
        new_category: "cell line",
        new_value: "BV-2",
        new_value_uri: "http://www.ebi.ac.uk/efo/EFO_0022792",
      },
    } as unknown as AuditFinding);
    renderWithProviders(<CompactFindingCard finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(emptyDraft()),
    });
    expect(screen.getByText("BV-2")).toBeInTheDocument();
    expect(screen.queryByText("bv 2")).toBeNull();
  });

  // The guard has to stay a guard. HEK-293F and HEK-293S are different
  // cell lines one character apart, so a candidate that doesn't re-slug
  // to the target identity must NOT be substituted in — the curator is
  // better served by an obviously-mangled label than by a confidently
  // wrong one.
  it("refuses a candidate whose slug doesn't match the target id", () => {
    const finding = tagFinding({
      issue_code: "calibration_agent_extra",
      target_id: "tag:cell-line/hek-293f",
      rationale: "",
      proposer_term: null,
      apply_action: {
        kind: "add_tag",
        new_category: "cell line",
        new_value: "HEK-293S",
        new_value_uri: "http://www.ebi.ac.uk/efo/EFO_0022515",
      },
    } as unknown as AuditFinding);
    renderWithProviders(<CompactFindingCard finding={finding} />, {
      audit: makeAuditCtx({ findings: [finding] }),
      draft: makeDraftCtx(emptyDraft()),
    });
    expect(screen.queryByText("HEK-293S")).toBeNull();
  });
});

describe("CompactFindingCard — displayed URI matches the applied URI", () => {
  // The other half of the CGR8 bug. The card and the Agree button read
  // the same two URI fields in opposite order, so on a term duplicated
  // across ontologies the curator was shown CLO_0002405 and Agree
  // wrote EFO_0006273. Both sides now route through
  // findingProposedUris; this pins the display half, applyHandlers.test
  // pins the apply half, and they assert the same literal URI.
  it("renders the apply_action URI, not a disagreeing proposer_term URI", () => {
    const finding = tagFinding({
      issue_code: "missing_tag",
      target_id: "tag:cell-line/cgr8",
      rationale: "",
      proposer_term: {
        label: "CGR8 cell",
        uri: "http://purl.obolibrary.org/obo/CLO_0002405",
      },
      apply_action: {
        kind: "add_tag",
        new_category: "cell line",
        new_value: "CGR8",
        new_value_uri: "http://purl.obolibrary.org/obo/EFO_0006273",
      },
    } as unknown as AuditFinding);
    const { container } = renderWithProviders(
      <CompactFindingCard finding={finding} />,
      {
        audit: makeAuditCtx({ findings: [finding] }),
        draft: makeDraftCtx(emptyDraft()),
      },
    );
    const html = container.innerHTML;
    expect(html).toContain("EFO_0006273");
    expect(html).not.toContain("CLO_0002405");
  });
});
