/** Coverage for the curator-auditing framing — the chip-diff
 *  synthesised AuditReport must include dispositions when ONE slot
 *  holds a curator's polished view, so the existing AuditDot ✓/✗
 *  path renders instead of showing every card as open ``□``.
 *
 *  Two configurations under test:
 *
 *  - ``baseline=preboard, comparator=am_polished`` — preboard-vs-curator.
 *  - ``baseline=cy_polished, comparator=am_polished`` — cross-curator.
 *
 *  Plus the existing curator-audits-agent path (regression).
 */
import { describe, expect, it } from "vitest";
import type { Design, Factor, Tag } from "@/features/experiment/types";
import { diffDesignsToAuditReport } from "./diffToAuditReport";

function f(category: string, name?: string): Factor {
  return {
    id: 0,
    name: name ?? category,
    category: { label: category, uri: null },
    type: "categorical",
    factor_values: [],
  } as unknown as Factor;
}

function t(category: string, value: string): Tag {
  return {
    id: 0,
    category: { label: category, uri: null },
    value: { label: value, uri: null },
  } as unknown as Tag;
}

function d(factors: Factor[] = [], tags: Tag[] = []): Design {
  return {
    experiment_id: 999,
    short_name: "GSEx",
    external_source: null,
    title: "",
    description: "",
    taxon: "mouse",
    assay: "rna",
    technology_type: "SEQUENCING",
    platform: null,
    publications: [],
    factors,
    biomaterials: [],
    tags,
  } as unknown as Design;
}

describe("diffDesignsToAuditReport — curator-in-comparator (new path)", () => {
  it("preboard × am_polished: surfaces ✓ added / ✗ dismissed dispositions per finding", () => {
    const baseline = d([f("strain")], [t("tissue", "liver")]);
    const comparator = d(
      [f("organism part")],
      [t("disease", "diabetes"), t("tissue", "liver")],
    );

    const report = diffDesignsToAuditReport({
      baseline,
      comparator,
      baselineSource: "preboard",
      comparatorSource: "polished:am",
      experimentId: 999,
      experimentShortName: "GSEx",
    });

    expect(report).not.toBeNull();
    const findings = report!.findings;
    const dispositions = report!.dispositions;

    // Expected findings:
    //  - Factor "organism part" in cmp not baseline → kind=added_solo
    //  - Factor "strain" in baseline not cmp        → kind=dismissed
    //  - Tag "disease/diabetes" in cmp not baseline → kind=added_solo
    //  - Tag "tissue/liver" matches                → kind=accepted
    expect(findings).toHaveLength(4);

    const byCode = Object.fromEntries(
      findings.map((f) => [f.issue_code, f]),
    );
    expect(byCode["chipdiff_factor_added_solo"]).toBeDefined();
    expect(byCode["chipdiff_factor_dismissed"]).toBeDefined();
    expect(byCode["chipdiff_tag_added_solo"]).toBeDefined();
    expect(byCode["chipdiff_tag_accepted"]).toBeDefined();

    // Disposition per finding — what the user actually sees as ✓ / ✗.
    expect(dispositions).toHaveLength(4);
    const byTarget = Object.fromEntries(
      dispositions.map((d) => [d.target_id, d.status]),
    );
    expect(
      byTarget[byCode["chipdiff_factor_added_solo"].target_id],
    ).toBe("accepted");
    expect(
      byTarget[byCode["chipdiff_factor_dismissed"].target_id],
    ).toBe("dismissed");
    expect(
      byTarget[byCode["chipdiff_tag_added_solo"].target_id],
    ).toBe("accepted");
    expect(
      byTarget[byCode["chipdiff_tag_accepted"].target_id],
    ).toBe("accepted");

    // Reviewer attribution — am is the curator whose decisions we render.
    expect(dispositions.every((d) => d.reviewer === "Am")).toBe(true);

    // Rationale prefix — the actor verb leads, so the curator can
    // read at a glance whose decision they're looking at.
    expect(byCode["chipdiff_factor_added_solo"].rationale).toMatch(/^Am added/);
    expect(byCode["chipdiff_factor_dismissed"].rationale).toMatch(/^Am dismissed/);
  });

  it("cy_polished × am_polished: dispositions attribute to am (the comparator)", () => {
    const baseline = d([f("strain")], []);
    const comparator = d([], [t("disease", "hypertension")]);

    const report = diffDesignsToAuditReport({
      baseline,
      comparator,
      baselineSource: "polished:cy",
      comparatorSource: "polished:am",
      experimentId: 999,
      experimentShortName: "GSEx",
    });

    expect(report).not.toBeNull();
    expect(report!.dispositions).toHaveLength(2);
    expect(report!.dispositions.every((d) => d.reviewer === "Am")).toBe(true);

    const byCode = Object.fromEntries(
      report!.findings.map((f) => [f.issue_code, f]),
    );
    expect(byCode["chipdiff_factor_dismissed"]).toBeDefined(); // strain in cy not am
    expect(byCode["chipdiff_tag_added_solo"]).toBeDefined(); // hypertension in am not cy
  });
});

describe("diffDesignsToAuditReport — curator-in-baseline (existing path)", () => {
  it("cy_polished × agent_proposal: curator dismissals come out attributed to cy", () => {
    const baseline = d([f("strain")], []);
    const comparator = d([f("treatment")], []);

    const report = diffDesignsToAuditReport({
      baseline,
      comparator,
      baselineSource: "polished:cy",
      comparatorSource: "agent_proposal",
      experimentId: 999,
      experimentShortName: "GSEx",
    });

    expect(report).not.toBeNull();
    const byCode = Object.fromEntries(
      report!.findings.map((f) => [f.issue_code, f]),
    );

    // Agent proposed "treatment" but cy_polished doesn't have it
    // → cy DISMISSED treatment.
    expect(byCode["chipdiff_factor_dismissed"]).toBeDefined();
    // Cy has "strain" but agent didn't propose it → cy ADDED SOLO.
    expect(byCode["chipdiff_factor_added_solo"]).toBeDefined();

    expect(report!.dispositions).toHaveLength(2);
    expect(report!.dispositions.every((d) => d.reviewer === "Cy")).toBe(true);
  });
});

describe("diffDesignsToAuditReport — no-curator pairings", () => {
  it("preboard × agent_proposal: no synthesized dispositions; cards stay open", () => {
    const baseline = d([f("strain")], []);
    const comparator = d([f("strain"), f("treatment")], []);

    const report = diffDesignsToAuditReport({
      baseline,
      comparator,
      baselineSource: "preboard",
      comparatorSource: "agent_proposal",
      experimentId: 999,
      experimentShortName: "GSEx",
    });

    expect(report).not.toBeNull();
    // Structural diff: agent has treatment that preboard doesn't.
    // No curator on either side → no synthesised dispositions.
    expect(report!.dispositions).toHaveLength(0);
  });
});
