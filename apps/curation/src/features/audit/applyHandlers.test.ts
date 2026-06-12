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
