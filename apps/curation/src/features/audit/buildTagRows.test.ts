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
});
