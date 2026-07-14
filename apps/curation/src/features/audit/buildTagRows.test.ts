import { describe, expect, it } from "vitest";
import type { AuditFinding } from "@/api/auditTypes";
import type { Design, Tag } from "@/features/experiment/types";
import { buildTagRows } from "./FindingDetailsEditor";

/**
 * Contract tests for the calibration-tag finding's "look up the gold
 * side in the live design" path. The lookup feeds the "Current"
 * column in the TAG MATCH / ADD TAG / REMOVE TAG editors.
 *
 * Regression that motivated these tests: GSE87700 TAG MATCH for
 * ``disease model: fetal alcohol spectrum disorder
 * MONDO:0000408`` — the design had the tag under category
 * ``disease`` (EFO:0000408) instead of ``disease model``, both
 * value-side URIs matched (MONDO:0000408), and the Current column
 * still rendered "no entry" because the lookup required
 * category-label equality. Per Paul 2026-06-12: the category drift
 * between proposer and curator is real, and the URI is the
 * identity-bearing field.
 *
 * The contract here:
 *   - Match when the value URIs match, regardless of category label.
 *   - Fall back to (category + value label) when neither side carries
 *     a URI on the value.
 *   - Return empty SideValue ("Current: no entry") when neither path
 *     finds anything.
 */

function tag(
  id: number,
  categoryLabel: string,
  valueLabel: string,
  opts: { valueUri?: string | null; categoryUri?: string | null } = {},
): Tag {
  return {
    id,
    category: {
      label: categoryLabel,
      uri: opts.categoryUri ?? null,
    },
    value: {
      label: valueLabel,
      uri: opts.valueUri ?? null,
    },
  };
}

function design(tags: Tag[]): Design {
  return {
    experiment_id: 1,
    experiment_short_name: "GSE-test",
    factors: [],
    biomaterials: [],
    tags,
  };
}

function mkFinding(partial: Partial<AuditFinding> = {}): AuditFinding {
  return {
    target_kind: "tag",
    target_id: "calibration:match:disease-model/fetal-alcohol-spectrum-disorder",
    severity: "ok",
    issue_code: "calibration_match",
    rationale: "Tag matches.",
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    proposer_term: {
      label: "fetal alcohol spectrum disorder",
      uri: "http://purl.obolibrary.org/obo/MONDO_0000408",
      resolver: null,
      score: null,
    },
    ...partial,
  };
}

describe("buildTagRows — Current-side lookup", () => {
  it("matches by value URI even when categories disagree (GSE87700 case)", () => {
    const d = design([
      // Design has the tag under the broader category. Audit calls it
      // "disease model"; both URIs agree, lookup should succeed.
      tag(7, "disease", "fetal alcohol spectrum disorder", {
        categoryUri: "http://www.ebi.ac.uk/efo/EFO_0000408",
        valueUri: "http://purl.obolibrary.org/obo/MONDO_0000408",
      }),
    ]);
    const rows = buildTagRows(
      mkFinding({
        target_id:
          "calibration:match:disease-model/fetal-alcohol-spectrum-disorder",
      }),
      d,
    );
    const valueRow = rows.find((r) => r.rowLabel === "Value");
    expect(valueRow?.currently?.label).toBe("fetal alcohol spectrum disorder");
    expect(valueRow?.currently?.uri).toBe(
      "http://purl.obolibrary.org/obo/MONDO_0000408",
    );
  });

  it("matches via (category, value) labels when neither side carries a URI", () => {
    const d = design([
      tag(7, "treatment", "vehicle"),
    ]);
    const rows = buildTagRows(
      mkFinding({
        target_id: "calibration:match:treatment/vehicle",
        proposer_term: {
          label: "vehicle",
          uri: null,
          resolver: null,
          score: null,
        },
      }),
      d,
    );
    const valueRow = rows.find((r) => r.rowLabel === "Value");
    expect(valueRow?.currently?.label).toBe("vehicle");
  });

  it("returns empty Current when no matching tag is on the design", () => {
    const d = design([
      tag(7, "disease", "diabetes", {
        valueUri: "http://purl.obolibrary.org/obo/MONDO_0005015",
      }),
    ]);
    const rows = buildTagRows(
      mkFinding({
        target_id:
          "calibration:match:disease-model/fetal-alcohol-spectrum-disorder",
      }),
      d,
    );
    const valueRow = rows.find((r) => r.rowLabel === "Value");
    expect(valueRow?.currently?.label ?? "").toBe("");
  });

  it("matches by value URI even when category labels are entirely unrelated", () => {
    // Defence against the broader pattern: when the proposer ships a
    // URI on the value side, that's the identity. The category label
    // is curator-facing context — informative but not load-bearing
    // for lookup.
    const d = design([
      tag(7, "condition", "fetal alcohol spectrum disorder", {
        valueUri: "http://purl.obolibrary.org/obo/MONDO_0000408",
      }),
    ]);
    const rows = buildTagRows(
      mkFinding({
        target_id:
          "calibration:match:disease-model/fetal-alcohol-spectrum-disorder",
      }),
      d,
    );
    const valueRow = rows.find((r) => r.rowLabel === "Value");
    expect(valueRow?.currently?.uri).toBe(
      "http://purl.obolibrary.org/obo/MONDO_0000408",
    );
  });

  it("does not match by value URI when URIs are different MONDO terms", () => {
    // Same label, different URI = different concept. Don't collide.
    const d = design([
      tag(7, "disease model", "fetal alcohol spectrum disorder", {
        valueUri: "http://purl.obolibrary.org/obo/MONDO_9999999",
      }),
    ]);
    const rows = buildTagRows(
      mkFinding({
        target_id:
          "calibration:match:disease-model/fetal-alcohol-spectrum-disorder",
      }),
      d,
    );
    const valueRow = rows.find((r) => r.rowLabel === "Value");
    // The label-based fallback shouldn't kick in because the
    // auditor's value HAS a URI — different URI means different
    // concept, no fallback to label match.
    expect(valueRow?.currently?.uri).not.toBe(
      "http://purl.obolibrary.org/obo/MONDO_0000408",
    );
  });

  it("resolves the proposal-side category URI from the design so it renders as a term, not italic text", () => {
    // The calibration target_id carries only the category LABEL
    // ("organism part"), never its URI, so the proposer category had no
    // URI on the wire and rendered as plain italic while the Current
    // column showed a term chip (GSE241529, Paul 2026-06-19). Borrow the
    // category URI from a design tag filed under the same label.
    const d = design([
      tag(7, "organism part", "internal ear", {
        categoryUri: "http://www.ebi.ac.uk/efo/EFO_0000635",
        valueUri: "http://purl.obolibrary.org/obo/UBERON_0001846",
      }),
    ]);
    const rows = buildTagRows(
      mkFinding({
        target_id: "calibration:match:organism part/inner ear",
        proposer_term: {
          label: "inner ear",
          uri: "http://purl.obolibrary.org/obo/UBERON_0001846",
          resolver: null,
          score: null,
        },
      }),
      d,
    );
    const categoryRow = rows.find((r) => r.rowLabel === "Category");
    expect(categoryRow?.proposal.label).toBe("organism part");
    expect(categoryRow?.proposal.uri).toBe(
      "http://www.ebi.ac.uk/efo/EFO_0000635",
    );
  });

  it("leaves the proposal category URI null when no design tag uses that category label", () => {
    // Genuinely novel category → no URI to borrow → stays italic. The
    // resolution must not invent a URI.
    const d = design([
      tag(7, "disease", "diabetes", {
        categoryUri: "http://www.ebi.ac.uk/efo/EFO_0000408",
      }),
    ]);
    const rows = buildTagRows(
      mkFinding({ target_id: "calibration:match:organism part/inner ear" }),
      d,
    );
    const categoryRow = rows.find((r) => r.rowLabel === "Category");
    expect(categoryRow?.proposal.uri ?? null).toBeNull();
  });
});

describe("buildTagRows — statement delta (calibration_tag_match_near)", () => {
  // A tag near-match whose statements moved must surface the same
  // Current-vs-Proposed delta the FV path shows — Subject / Predicate /
  // Object rows built from finding.proposer_statements (proposal) vs the
  // matched tag's statements (currently).
  // TAG_STATEMENT_APPLY_AND_RENDER_UI_2026_07_13.md.
  const utrnStmt = {
    category: { label: "genotype", uri: null },
    subject: { label: "Utrn", uri: "http://gene/Utrn" },
    predicate: { label: "has_genotype", uri: "http://TGEMO/00166" },
    object: { label: "Heterozygous", uri: "http://TGEMO/00003" },
  };

  it("emits Subject/Predicate/Object rows; the added statement disagrees with the bare current tag", () => {
    // Current tag is bare (no statements). Proposal adds has_genotype
    // Heterozygous → predicate + object are the delta.
    const d = design([
      tag(3, "genotype", "Utrn [mouse] utrophin", {
        valueUri: "http://gene/Utrn",
      }),
    ]);
    const rows = buildTagRows(
      mkFinding({
        issue_code: "calibration_tag_match_near",
        target_id: "tag:genotype/utrn-[mouse]-utrophin",
        proposer_term: {
          label: "Utrn",
          uri: "http://gene/Utrn",
          resolver: null,
          score: null,
        },
        proposer_statements: [utrnStmt] as never,
        apply_action: {
          kind: "replace_tag",
          statements: [utrnStmt],
        } as never,
      }),
      d,
    );
    const predRow = rows.find((r) => r.rowLabel === "Predicate");
    const objRow = rows.find((r) => r.rowLabel === "Object");
    expect(predRow).toBeDefined();
    expect(objRow).toBeDefined();
    // Proposed side carries the statement; current side is empty (bare
    // tag) → the row disagrees, which is the near-match delta.
    expect(predRow!.proposal.label).toBe("has_genotype");
    expect(predRow!.currently?.label ?? "").toBe("");
    expect(predRow!.allAgree).toBe(false);
    expect(objRow!.proposal.label).toBe("Heterozygous");
    expect(objRow!.allAgree).toBe(false);
  });

  it("does not emit statement rows for a plain tag match (no statement detail)", () => {
    const d = design([
      tag(7, "cell type", "astrocyte", { valueUri: "http://CL/0000127" }),
    ]);
    const rows = buildTagRows(
      mkFinding({
        issue_code: "calibration_match",
        target_id: "calibration:match:cell type/astrocyte",
        proposer_term: {
          label: "astrocyte",
          uri: "http://CL/0000127",
          resolver: null,
          score: null,
        },
      }),
      d,
    );
    expect(rows.find((r) => r.rowLabel === "Subject")).toBeUndefined();
    expect(rows.find((r) => r.rowLabel === "Predicate")).toBeUndefined();
    // Category + Value still there.
    expect(rows.find((r) => r.rowLabel === "Category")).toBeDefined();
    expect(rows.find((r) => r.rowLabel === "Value")).toBeDefined();
  });

  it("compares against an existing statement when the current tag already has one (object changed)", () => {
    // Current tag carries Homozygous negative; proposal changes it to
    // Heterozygous → Object row disagrees, Subject/Predicate agree.
    const current: Tag = {
      ...tag(4, "genotype", "Utrn", { valueUri: "http://gene/Utrn" }),
      statements: [
        {
          category: { label: "genotype", uri: null },
          subject: { label: "Utrn", uri: "http://gene/Utrn" },
          predicate: { label: "has_genotype", uri: "http://TGEMO/00166" },
          object: {
            label: "Homozygous negative",
            uri: "http://TGEMO/00001",
          },
        },
      ],
    };
    const d = design([current]);
    const rows = buildTagRows(
      mkFinding({
        issue_code: "calibration_tag_match_near",
        target_id: "tag:genotype/utrn",
        proposer_term: {
          label: "Utrn",
          uri: "http://gene/Utrn",
          resolver: null,
          score: null,
        },
        proposer_statements: [utrnStmt] as never,
        apply_action: {
          kind: "replace_tag",
          statements: [utrnStmt],
        } as never,
      }),
      d,
    );
    const objRow = rows.find((r) => r.rowLabel === "Object");
    expect(objRow!.proposal.label).toBe("Heterozygous");
    expect(objRow!.currently?.label).toBe("Homozygous negative");
    expect(objRow!.allAgree).toBe(false);
    // Predicate agrees on both sides.
    const predRow = rows.find((r) => r.rowLabel === "Predicate");
    expect(predRow!.allAgree).toBe(true);
  });
});
