import { describe, expect, it } from "vitest";
import type { AuditFinding } from "@/api/auditTypes";
import type { Design, Tag, Factor, OntologyTerm } from "@/features/experiment/types";
import { resolveApplyAction } from "./applyHandlers";

/**
 * Contract tests for the apply-action chain. These lock in the
 * behaviour Paul keeps having to re-prove: when the curator clicks
 * "remove" / "Agree" / "add" on a finding card, the design draft
 * gets mutated correctly. Each test runs the resolved mutator
 * against a real Design and verifies the resulting draft.
 *
 * History: this path has broken three times. Once when calibration
 * target_ids started using slugs (whitespace → "-") and the
 * design's free-text labels diverged. Once when the entity-frame
 * proposer started emitting ``tag:<cat>/<val>`` shape target_ids
 * instead of ``calibration:miss:<cat>/<val>``. Once when the
 * ``apply_action.kind === "remove_tag"`` structured shape landed
 * without a handler. Tests here cover all three shapes so any
 * regression surfaces immediately.
 */

function term(label: string, uri: string | null = null): OntologyTerm {
  return { label, uri };
}

function tag(
  id: number,
  categoryLabel: string,
  valueLabel: string,
  opts: { categoryUri?: string | null; valueUri?: string | null } = {},
): Tag {
  return {
    id,
    category: term(categoryLabel, opts.categoryUri ?? null),
    value: term(valueLabel, opts.valueUri ?? null),
  };
}

function design(opts: { tags?: Tag[]; factors?: Factor[] } = {}): Design {
  return {
    experiment_id: 1,
    experiment_short_name: "GSE-test",
    factors: opts.factors ?? [],
    biomaterials: [],
    tags: opts.tags ?? [],
  };
}

function finding(partial: Partial<AuditFinding>): AuditFinding {
  return {
    target_kind: "tag",
    target_id: "",
    severity: "minor",
    issue_code: "calibration_gold_only_miss",
    rationale: "",
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    ...partial,
  };
}

describe("resolveApplyAction — REMOVE TAG", () => {
  it("removes a tag when target_id is calibration:miss:<cat-slug>/<val-slug> and design labels match exactly", () => {
    // Plain happy path — slug == label, no normalisation drift. This is
    // the case that worked even before the slug fix.
    const d = design({
      tags: [
        tag(7, "cell-type", "border-associated-macrophage", {
          valueUri: "CL:0000129",
        }),
      ],
    });
    const f = finding({
      issue_code: "calibration_gold_only_miss",
      target_id: "calibration:miss:cell-type/border-associated-macrophage",
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    expect(next.tags.find((t) => t.id === 7)).toBeUndefined();
  });

  it("removes a tag when target_id slug is hyphen-joined but design label uses spaces (the actual bug Paul hit)", () => {
    // The agent slugs labels via "lowercase + collapse-whitespace-to-dash".
    // The curator's saved tag label keeps the original spacing. The
    // pre-fix labelEq compare (lowercase + trim only) missed this and
    // the "remove" button silently no-op'd.
    const d = design({
      tags: [
        // Saved label with a real space — slugs to "border-associated-macrophage".
        tag(7, "cell type", "border-associated macrophage", {
          valueUri: "CL:0000129",
        }),
      ],
    });
    const f = finding({
      issue_code: "calibration_gold_only_miss",
      target_id: "calibration:miss:cell-type/border-associated-macrophage",
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    expect(next.tags).toHaveLength(0);
  });

  it("removes a tag when target_id is tag:<cat-slug>/<val-slug> (entity-frame proposer shape, 2026-06-07+)", () => {
    // The entity-frame proposer uses tag_target() which emits
    // ``tag:<slug>/<slug>``, NOT ``calibration:miss:...``. Pre-fix this
    // fell through to focusOnly and the button did nothing.
    const d = design({
      tags: [
        tag(11, "cell-type", "border-associated-macrophage", {
          valueUri: "CL:0000129",
        }),
      ],
    });
    const f = finding({
      issue_code: "calibration_gold_only_miss",
      target_id: "tag:cell-type/border-associated-macrophage",
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    expect(next.tags).toHaveLength(0);
  });

  it("removes a tag when target_id is tag:<digits> (numeric-id shape, oldest path)", () => {
    const d = design({
      tags: [tag(42, "organism part", "liver", { valueUri: "UBERON:0002107" })],
    });
    const f = finding({
      issue_code: "calibration_gold_only_miss",
      target_id: "tag:42",
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    expect(next.tags).toHaveLength(0);
  });

  it("removes a tag via apply_action.kind === 'remove_tag' (structured action shape)", () => {
    const d = design({
      tags: [
        tag(7, "cell-type", "border-associated-macrophage", {
          valueUri: "CL:0000129",
        }),
      ],
    });
    const f = finding({
      issue_code: "calibration_gold_only_miss",
      target_id: "tag:cell-type/border-associated-macrophage",
      apply_action: { kind: "remove_tag" } as never,
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    expect(next.tags).toHaveLength(0);
  });

  it("returns idempotent 'Already removed' when the tag is already gone", () => {
    const d = design({ tags: [] });
    const f = finding({
      issue_code: "calibration_gold_only_miss",
      target_id: "calibration:miss:cell-type/border-associated-macrophage",
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("Already removed");
  });

  it("refuses to remove protected tag categories (assay / technology_type)", () => {
    const d = design({
      tags: [tag(99, "assay", "RNA-Seq", { valueUri: "EFO:0008896" })],
    });
    const f = finding({
      issue_code: "calibration_gold_only_miss",
      target_id: "calibration:miss:assay/rna-seq",
    });
    const action = resolveApplyAction(f, { design: d });
    // Either null (falls through to focus-only) or non-mutating.
    // Whichever path the chain picks, the protected tag must survive.
    if (action?.mutates && action.mutate) {
      const next = action.mutate(d);
      expect(next.tags).toHaveLength(1);
    } else {
      // Already short-circuited — no mutation will run.
      expect(action?.mutates ?? false).toBe(false);
    }
  });
});

describe("resolveApplyAction — ADD TAG", () => {
  it("adds a tag when apply_action.kind === 'add_tag' (proposer-mode path)", () => {
    const d = design({ tags: [] });
    const f = finding({
      target_kind: "tag",
      issue_code: "missing_tag",
      target_id: "tag:disease/diabetes",
      apply_action: {
        kind: "add_tag",
        new_category: "disease",
        new_value: "type 2 diabetes mellitus",
        new_value_uri: "EFO:0001360",
      },
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    expect(next.tags).toHaveLength(1);
    expect(next.tags[0].category.label).toBe("disease");
    expect(next.tags[0].value.label).toBe("type 2 diabetes mellitus");
    expect(next.tags[0].value.uri).toBe("EFO:0001360");
  });

  it("adds a tag via calibration_agent_extra (target_id-parsed path)", () => {
    const d = design({ tags: [] });
    const f = finding({
      target_kind: "tag",
      issue_code: "calibration_agent_extra",
      target_id: "calibration:extra:disease/type-2-diabetes-mellitus",
      proposer_term: {
        label: "type 2 diabetes mellitus",
        uri: "EFO:0001360",
        resolver: null,
        score: null,
      },
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    expect(next.tags).toHaveLength(1);
    expect(next.tags[0].value.label).toBe("type 2 diabetes mellitus");
  });

  it("returns idempotent 'Already in draft' when the proposed tag is already on the design", () => {
    const d = design({
      tags: [tag(3, "disease", "type 2 diabetes mellitus", {
        valueUri: "EFO:0001360",
      })],
    });
    const f = finding({
      target_kind: "tag",
      issue_code: "missing_tag",
      apply_action: {
        kind: "add_tag",
        new_category: "disease",
        new_value: "type 2 diabetes mellitus",
        new_value_uri: "EFO:0001360",
      },
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("Already in draft");
  });
});

describe("resolveApplyAction — SWAP TAG (replace_tag)", () => {
  // Tag swap: replace an existing baseline tag (target_id = "tag:N")
  // with a same-concept term under a different URI. The "current" side
  // is the replaced tag id; the proposed side is proposer_term /
  // apply_action. Adopt = drop baseline id N + add the replacement.
  // (UIB_HANDOFF_2026_06_20_TAG_SWAP_CURRENT_SIDE_FROM_TARGETID.md.)
  it("drops the baseline tag and adds the replacement", () => {
    const d = design({
      tags: [
        tag(2, "disease model", "brain ischemia", {
          valueUri: "http://purl.obolibrary.org/obo/MONDO_0005299",
        }),
      ],
    });
    const f = finding({
      target_kind: "tag",
      issue_code: "calibration_tag_match_near",
      target_id: "tag:2",
      proposer_term: {
        label: "cerebral ischemia",
        uri: "http://purl.obolibrary.org/obo/MONDO_0002679",
        resolver: null,
        score: null,
      },
      apply_action: {
        kind: "replace_tag",
        new_category: "disease model",
        new_value: "cerebral ischemia",
        new_value_uri: "http://purl.obolibrary.org/obo/MONDO_0002679",
      } as never,
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    // Baseline gone, replacement present with the new URI.
    expect(next.tags.find((t) => t.id === 2)).toBeUndefined();
    expect(next.tags).toHaveLength(1);
    expect(next.tags[0].value.label).toBe("cerebral ischemia");
    expect(next.tags[0].value.uri).toBe(
      "http://purl.obolibrary.org/obo/MONDO_0002679",
    );
  });

  it("returns idempotent 'Already applied' when the baseline is gone and the replacement is present", () => {
    const d = design({
      tags: [
        tag(5, "disease model", "cerebral ischemia", {
          valueUri: "http://purl.obolibrary.org/obo/MONDO_0002679",
        }),
      ],
    });
    const f = finding({
      target_kind: "tag",
      issue_code: "calibration_tag_match_near",
      // Baseline id no longer on the draft (already swapped).
      target_id: "tag:2",
      proposer_term: {
        label: "cerebral ischemia",
        uri: "http://purl.obolibrary.org/obo/MONDO_0002679",
        resolver: null,
        score: null,
      },
      apply_action: {
        kind: "replace_tag",
        new_category: "disease model",
        new_value: "cerebral ischemia",
        new_value_uri: "http://purl.obolibrary.org/obo/MONDO_0002679",
      } as never,
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("Already applied");
  });

  it("refuses to swap a protected (assay) tag", () => {
    const d = design({
      tags: [tag(9, "assay", "RNA-Seq", { valueUri: "EFO:0008896" })],
    });
    const f = finding({
      target_kind: "tag",
      issue_code: "calibration_tag_match_near",
      target_id: "tag:9",
      proposer_term: {
        label: "RNA-seq of coding RNA",
        uri: "EFO:0003738",
        resolver: null,
        score: null,
      },
      apply_action: {
        kind: "replace_tag",
        new_category: "assay",
        new_value: "RNA-seq of coding RNA",
        new_value_uri: "EFO:0003738",
      } as never,
    });
    const action = resolveApplyAction(f, { design: d });
    // Protected — never a one-click mutating swap; the assay tag survives.
    if (action?.mutates && action.mutate) {
      const next = action.mutate(d);
      expect(next.tags.find((t) => t.id === 9)).toBeDefined();
    } else {
      expect(action?.mutates ?? false).toBe(false);
    }
  });
});

describe("resolveApplyAction — REJECT / no-op cases", () => {
  it("returns null/focus-only when the finding has no apply_action and no calibration shape", () => {
    const d = design({ tags: [] });
    const f = finding({
      target_kind: "tag",
      issue_code: "ungrounded_term",
      target_id: "tag:foo/bar",
    });
    const action = resolveApplyAction(f, { design: d });
    // Either null or non-mutating focus-only — never silently fires a
    // mutation on a finding the curator didn't accept.
    expect(action?.mutates ?? false).toBe(false);
  });

  it("never mutates the draft from resolveApplyAction's return value alone (the caller chooses to invoke mutate)", () => {
    // Resolving the action should be a pure computation — the curator
    // clicking Agree is what runs mutate. Verify we don't accidentally
    // mutate the input Design during resolution.
    const originalTags = [tag(7, "cell-type", "border-associated-macrophage")];
    const d = design({ tags: originalTags });
    const f = finding({
      issue_code: "calibration_gold_only_miss",
      target_id: "calibration:miss:cell-type/border-associated-macrophage",
    });
    resolveApplyAction(f, { design: d });
    // Input design untouched — only mutate() called later changes it.
    expect(d.tags).toBe(originalTags);
    expect(d.tags).toHaveLength(1);
  });
});

describe("resolveApplyAction — CONTINUOUS FACTOR add (Paul 2026-06-13)", () => {
  // The agent ships continuous-factor proposals as ONE placeholder FV
  // with empty biomaterials + null numeric_value. The old apply path
  // added the placeholder verbatim — one empty FV, no per-sample
  // population, invisible to the curator. New path: detect the
  // placeholder shape, walk biomaterial.characteristics for a matching
  // key (case + punctuation tolerant), promote via
  // addContinuousFactorFromCharacteristic so the resulting factor has
  // one FV per BM carrying that characteristic.

  const baseDesign = (
    overrides: Partial<Design> = {},
  ): Design =>
    ({
      experiment_id: 1,
      experiment_short_name: "GSE",
      factors: [],
      biomaterials: [
        {
          short_name: "S1",
          name: "S1",
          characteristics: { timepoint: "0h" },
        },
        {
          short_name: "S2",
          name: "S2",
          characteristics: { timepoint: "12h" },
        },
        {
          short_name: "S3",
          name: "S3",
          characteristics: { timepoint: "24h" },
        },
      ],
      tags: [],
      ...overrides,
    }) as Design;

  const continuousFinding = (): AuditFinding =>
    ({
      target_kind: "factor",
      target_id: "calibration:factor_extra:timepoint",
      severity: "minor",
      issue_code: "calibration_factor_extra",
      rationale: "Agent proposes continuous factor `timepoint`.",
      citation: "",
      citation_url: "",
      suggested_fix: "",
      proposer_suggestion: "",
      agent_target_index: 0,
    }) as unknown as AuditFinding;

  const continuousReport = () =>
    ({
      audit_id: "a1",
      experiment_id: 1,
      experiment_short_name: "GSE",
      audited_at: "",
      model: null,
      scope: { include: [] },
      findings: [continuousFinding()],
      evidence: {
        preboarding_excerpt: "",
        paper_source: null,
        paper_excerpt: "",
        comparison_proposal: {
          factors: [
            {
              category: {
                label: "timepoint",
                uri: "http://www.ebi.ac.uk/efo/EFO_0000724",
              },
              name_in_design: "timepoint",
              factor_type: "continuous",
              factor_values: [
                {
                  // The placeholder shape — empty biomaterials, no
                  // numeric value.
                  free_text_label: "<continuous, populated from characteristic>",
                  is_baseline: false,
                  statements: [],
                  biomaterial_short_names: [],
                  numeric_value: null,
                },
              ],
            },
          ],
          tags: [],
        },
      },
      summary: { n_blocker: 0, n_major: 0, n_minor: 0, n_ok: 0, overall_verdict: "passes" },
      dispositions: [],
    }) as never;

  it("recognises the placeholder shape + returns a mutating ApplyAction", () => {
    const d = baseDesign();
    const a = resolveApplyAction(continuousFinding(), {
      design: d,
      report: continuousReport(),
    });
    expect(a).not.toBeNull();
    expect(a?.mutates).toBe(true);
    expect(a?.mutate).toBeDefined();
  });

  it("running the mutator promotes the placeholder to one FV per sample", () => {
    const d = baseDesign();
    const a = resolveApplyAction(continuousFinding(), {
      design: d,
      report: continuousReport(),
    });
    const next = a?.mutate!(d) as Design;
    // The new factor exists.
    const factor = (next.factors ?? []).find(
      (f) => f.category.label === "timepoint",
    );
    expect(factor).toBeDefined();
    // One FV per biomaterial carrying the characteristic.
    expect(factor!.factor_values.length).toBe(3);
    expect(factor!.factor_values.map((fv) => fv.free_text_label).sort()).toEqual(
      ["0h", "12h", "24h"],
    );
    // Marked continuous.
    expect(factor!.type).toBe("continuous");
  });

  it("falls back to generic add when no matching characteristic exists", () => {
    // Strip the characteristic; the proposal can't be promoted.
    const d = baseDesign({
      biomaterials: [
        { short_name: "S1", name: "S1", characteristics: {} },
      ],
    });
    const a = resolveApplyAction(continuousFinding(), {
      design: d,
      report: continuousReport(),
    });
    const next = a?.mutate!(d) as Design;
    // Factor still added — better than dropping the click. The
    // curator can re-bind from the design editor.
    const factor = (next.factors ?? []).find(
      (f) => f.category.label === "timepoint",
    );
    expect(factor).toBeDefined();
  });
});
