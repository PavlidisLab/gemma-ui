/**
 * Apply-chain contract tests for the TAG-side branches that
 * `applyHandlers.test.ts` leaves uncovered.
 *
 * Three themes, all of which have bitten before:
 *
 *   1. **Idempotency.** Every apply path has an "already done" arm so a
 *      second Agree click doesn't render a dead button or double-apply.
 *      Those arms are the least-exercised code in the module.
 *   2. **Match-downgrade** (``goldEmpty``). A ``calibration_match``
 *      viewed against a baseline that doesn't carry the tag is
 *      curator-actionable as an ADD; before the 2026-06-16 handoff
 *      Agree was a silent no-op here.
 *   3. **Protected categories.** ``assay`` / ``technology type`` must
 *      never be removed, including through the label-based helper that
 *      other callers could thread directly.
 */
import { describe, expect, it } from "vitest";
import type { AuditFinding } from "@/api/auditTypes";
import type {
  Design,
  Factor,
  FactorValue,
  OntologyTerm,
  Tag,
} from "@/features/experiment/types";
import type { OntologyTerm as WireTerm } from "@/api/types";
import { resolveApplyAction } from "./applyHandlers";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function term(label: string, uri: string | null = null): OntologyTerm {
  return { label, uri };
}

function wireTerm(label: string, uri: string | null = null): WireTerm {
  return { label, uri, resolver: null, score: null };
}

function tag(
  id: number,
  categoryLabel: string,
  valueLabel: string,
  opts: { valueUri?: string | null; inferred?: boolean } = {},
): Tag {
  return {
    id,
    category: term(categoryLabel),
    value: term(valueLabel, opts.valueUri ?? null),
    inferred: opts.inferred ?? false,
    inferred_source: "",
    evidence_code: "IC",
  };
}

function fv(id: number, label: string, bms: string[] = []): FactorValue {
  return {
    id,
    free_text_label: label,
    is_baseline: false,
    biomaterial_short_names: bms,
    statements: [{ subject: term(label) }],
  };
}

function factor(id: number, categoryLabel: string, fvs: FactorValue[]): Factor {
  return {
    id,
    name: categoryLabel,
    category: term(categoryLabel),
    description: "",
    type: "categorical",
    factor_values: fvs,
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
  } as AuditFinding;
}

// ---------------------------------------------------------------------------
// Structured remove_tag apply_action
// ---------------------------------------------------------------------------

describe("resolveApplyAction — remove_tag idempotency", () => {
  it("reports already-removed when the slug parses but no tag matches", () => {
    const d = design({ tags: [tag(1, "cell type", "astrocyte")] });
    const f = finding({
      issue_code: "calibration_gold_only_miss",
      target_id: "tag:disease/alzheimer-disease",
      apply_action: { kind: "remove_tag" },
    } as Partial<AuditFinding>);

    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("Already removed");
    expect(action?.mutate).toBeUndefined();
  });

  it("declines entirely on a protected category rather than offering a remove", () => {
    // assay / technology type are never removable through the apply chain.
    const d = design({ tags: [tag(1, "assay", "RNA-seq")] });
    const f = finding({
      issue_code: "calibration_gold_only_miss",
      target_id: "tag:assay/rna-seq",
      apply_action: { kind: "remove_tag" },
    } as Partial<AuditFinding>);

    const action = resolveApplyAction(f, { design: d });
    // Falls through to the non-mutating focus fallback — never a remove.
    expect(action?.mutates).toBe(false);
    expect(action?.mutate).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Match-downgrade — a match against an empty gold baseline becomes an ADD
// ---------------------------------------------------------------------------

describe("resolveApplyAction — MATCH DOWNGRADE (goldEmpty ⇒ add tag)", () => {
  const downgrade = (partial: Partial<AuditFinding> = {}) =>
    finding({
      issue_code: "calibration_match",
      target_id: "tag:cell-type/astrocyte",
      severity: "ok",
      ...partial,
    });

  it("does nothing special when goldEmpty is not set", () => {
    // Without the downgrade flag a match is not an add — the curator
    // gets the ordinary non-mutating treatment.
    const d = design();
    const f = downgrade({
      proposer_term: wireTerm("astrocyte", "http://x/CL_0000127"),
    });

    expect(resolveApplyAction(f, { design: d })?.mutates).not.toBe(true);
  });

  it("adds the tag from proposer_term plus the target_id category slug", () => {
    const d = design();
    const f = downgrade({
      proposer_term: wireTerm("astrocyte", "http://x/CL_0000127"),
    });

    const action = resolveApplyAction(f, { design: d, goldEmpty: true });
    expect(action?.mutates).toBe(true);
    expect(action?.label).toContain("add");

    const next = action!.mutate!(d);
    expect(next.tags).toHaveLength(1);
    // The category slug is de-slugged best-effort for display.
    expect(next.tags[0].category.label).toBe("cell type");
    expect(next.tags[0].value.label).toBe("astrocyte");
    expect(next.tags[0].value.uri).toBe("http://x/CL_0000127");
  });

  it("falls back to the backticked `cat: val` in the rationale", () => {
    // calibration_match's standard rationale shape, used when the
    // finding ships no proposer_term.
    const d = design();
    const f = downgrade({
      target_id: "tag:cell-type/astrocyte",
      rationale: "Is `cell type: astrocyte` correctly assigned?",
    });

    const next = resolveApplyAction(f, { design: d, goldEmpty: true })!.mutate!(
      d,
    );
    expect(next.tags[0].category.label).toBe("cell type");
    expect(next.tags[0].value.label).toBe("astrocyte");
    // No URI on this path — the tag lands free-text for later grounding.
    expect(next.tags[0].value.uri).toBeNull();
  });

  it("says free-text in the tooltip when no URI is available", () => {
    const d = design();
    const f = downgrade({
      rationale: "Is `cell type: astrocyte` correctly assigned?",
    });

    expect(
      resolveApplyAction(f, { design: d, goldEmpty: true })?.tooltip,
    ).toContain("free-text");
  });

  it("declines when neither a proposer_term nor a backticked pair resolves", () => {
    const d = design();
    const f = downgrade({ target_id: "tag:", rationale: "no token here" });

    const action = resolveApplyAction(f, { design: d, goldEmpty: true });
    expect(action?.mutates).not.toBe(true);
  });

  it("reports already-in-draft when the tag is already present", () => {
    const d = design({ tags: [tag(1, "cell type", "astrocyte")] });
    const f = downgrade({ proposer_term: wireTerm("astrocyte", null) });

    const action = resolveApplyAction(f, { design: d, goldEmpty: true });
    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("Already in draft");
  });

  it("treats a different URI on the same label as NOT already applied", () => {
    // Same words, different concept — the curator still has work to do.
    const d = design({
      tags: [tag(1, "cell type", "astrocyte", { valueUri: "http://x/OLD" })],
    });
    const f = downgrade({
      proposer_term: wireTerm("astrocyte", "http://x/CL_0000127"),
    });

    expect(
      resolveApplyAction(f, { design: d, goldEmpty: true })?.mutates,
    ).toBe(true);
  });

  it("also downgrades the proposer-mode tag_proposed_match_with_design code", () => {
    const d = design();
    const f = downgrade({
      issue_code: "tag_proposed_match_with_design",
      proposer_term: wireTerm("astrocyte", null),
    });

    expect(
      resolveApplyAction(f, { design: d, goldEmpty: true })?.mutates,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// calibration_agent_extra — add the agent's tag
// ---------------------------------------------------------------------------

describe("resolveApplyAction — AGENT EXTRA (add tag) idempotency", () => {
  const extra = (partial: Partial<AuditFinding> = {}) =>
    finding({
      issue_code: "calibration_agent_extra",
      target_id: "calibration:extra:disease/alzheimer-disease",
      ...partial,
    });

  it("adds the agent's tag when it is not on the draft", () => {
    const d = design();
    const action = resolveApplyAction(
      extra({
        proposer_term: wireTerm("Alzheimer disease", "http://x/MONDO_1"),
      }),
      { design: d },
    );

    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    expect(next.tags[0].value.label).toBe("Alzheimer disease");
    expect(next.tags[0].value.uri).toBe("http://x/MONDO_1");
  });

  it("reports already-in-draft on a case-insensitive label match", () => {
    const d = design({ tags: [tag(1, "DISEASE", "alzheimer DISEASE")] });
    const action = resolveApplyAction(
      extra({ proposer_term: wireTerm("Alzheimer disease", null) }),
      { design: d },
    );

    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("Already in draft");
  });

  it("still adds when the labels match but the URIs differ", () => {
    const d = design({
      tags: [
        tag(1, "disease", "Alzheimer disease", { valueUri: "http://x/OTHER" }),
      ],
    });
    const action = resolveApplyAction(
      extra({
        proposer_term: wireTerm("Alzheimer disease", "http://x/MONDO_1"),
      }),
      { design: d },
    );

    expect(action?.mutates).toBe(true);
  });

  it("matches on label alone when the draft tag carries no URI", () => {
    const d = design({ tags: [tag(1, "disease", "Alzheimer disease")] });
    const action = resolveApplyAction(
      extra({
        proposer_term: wireTerm("Alzheimer disease", "http://x/MONDO_1"),
      }),
      { design: d },
    );

    expect(action?.mutates).toBe(false);
  });

  it("falls back to the target_id value when no proposer_term ships", () => {
    const d = design();
    const action = resolveApplyAction(extra(), { design: d });

    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    expect(next.tags[0].value.label).toBe("alzheimer-disease");
  });
});

// ---------------------------------------------------------------------------
// removeTagByLabels — reached when the resolver runs with no design
// ---------------------------------------------------------------------------

describe("removeTagByLabels (no-design resolve path)", () => {
  /** Resolving without a design yields a label-based remover, which is
   *  the only route to ``removeTagByLabels``. */
  const removerFor = (targetId: string) =>
    resolveApplyAction(
      finding({ issue_code: "calibration_gold_only_miss", target_id: targetId }),
      {},
    );

  it("removes by slug so target_id spelling matches curator spacing", () => {
    // The agent slugs "border-associated-macrophage"; the curator's tag
    // keeps the original space. labelEq's lowercase+trim missed this.
    const action = removerFor(
      "calibration:miss:cell-type/border-associated-macrophage",
    );
    expect(action?.mutates).toBe(true);

    const d = design({
      tags: [
        tag(7, "cell type", "border-associated macrophage"),
        tag(8, "disease", "AD"),
      ],
    });
    const next = action!.mutate!(d);
    expect(next.tags.map((t) => t.id)).toEqual([8]);
  });

  it("leaves the design untouched when nothing matches", () => {
    const action = removerFor("calibration:miss:disease/alzheimer-disease");
    const d = design({ tags: [tag(1, "cell type", "astrocyte")] });

    expect(action!.mutate!(d).tags).toHaveLength(1);
  });

  it("never hands back a remover at all for a protected category", () => {
    // The chain refuses before building a mutator, so an assay tag has
    // no remove affordance on this path whatsoever. (``removeTagByLabels``
    // repeats the guard internally for callers threading it directly;
    // that arm is unreachable from here by design.)
    expect(removerFor("calibration:miss:assay/rna-seq")).toBeNull();
  });

  it("removes an inferred chip too so Agree gives immediate feedback", () => {
    // Inferred chips reappear from their source on the next read; what
    // matters here is that the chip clears when the curator agrees.
    const action = removerFor("calibration:miss:cell-type/astrocyte");
    const d = design({
      tags: [tag(1, "cell type", "astrocyte", { inferred: true })],
    });

    expect(action!.mutate!(d).tags).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// calibration_factor_extra — add the agent's factor
// ---------------------------------------------------------------------------

describe("resolveApplyAction — FACTOR EXTRA (add factor) idempotency", () => {
  const extraFactor = (partial: Partial<AuditFinding> = {}) =>
    finding({
      target_kind: "factor",
      issue_code: "calibration_factor_extra",
      target_id: "factor:disease",
      apply_action: {
        kind: "add_factor",
        new_factor_payload: {
          category: wireTerm("disease"),
          name_in_design: "disease",
          factor_values: [
            {
              free_text_label: "AD",
              is_baseline: false,
              statements: [],
              biomaterial_short_names: ["S1"],
            },
            {
              free_text_label: "control",
              is_baseline: true,
              statements: [],
              biomaterial_short_names: ["S2"],
            },
          ],
        },
      },
      ...partial,
    } as Partial<AuditFinding>);

  it("adds the proposed factor when the design has nothing like it", () => {
    const d = design();
    const action = resolveApplyAction(extraFactor(), { design: d });

    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    expect(next.factors).toHaveLength(1);
    expect(next.factors[0].category.label).toBe("disease");
  });

  it("reports already-in-draft when an identical partition is present", () => {
    // Same category, same FV count, same (label, biomaterial-set)
    // signature on every FV.
    const d = design({
      factors: [
        factor(1, "disease", [fv(10, "AD", ["S1"]), fv(11, "control", ["S2"])]),
      ],
    });

    const action = resolveApplyAction(extraFactor(), { design: d });
    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("Already in draft");
  });

  it("does not call it already-applied when the FV count differs", () => {
    const d = design({
      factors: [factor(1, "disease", [fv(10, "AD", ["S1"])])],
    });

    expect(resolveApplyAction(extraFactor(), { design: d })?.mutates).toBe(
      true,
    );
  });

  it("does not call it already-applied when a biomaterial set differs", () => {
    const d = design({
      factors: [
        factor(1, "disease", [
          fv(10, "AD", ["S1"]),
          fv(11, "control", ["S9"]),
        ]),
      ],
    });

    expect(resolveApplyAction(extraFactor(), { design: d })?.mutates).toBe(
      true,
    );
  });

  it("warns about a same-category clash when adding anyway", () => {
    // A factor of this category exists but with a different partition —
    // adding gives the design two factors of the same name, which is
    // rarely what the curator wants, so the action says so up front.
    const d = design({
      factors: [factor(1, "disease", [fv(10, "something else", ["S3"])])],
    });

    const action = resolveApplyAction(extraFactor(), { design: d });
    expect(action?.mutates).toBe(true);
    expect(action?.confirmMessage ?? "").toContain("SECOND factor");
  });

  it("does not mutate the design passed to the resolver", () => {
    const d = design();
    resolveApplyAction(extraFactor(), { design: d })!.mutate!(d);

    expect(d.factors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Calibration remove path (no structured apply_action)
// ---------------------------------------------------------------------------

describe("resolveApplyAction — calibration slug remove", () => {
  const slugMiss = (targetId: string) =>
    finding({ issue_code: "calibration_gold_only_miss", target_id: targetId });

  it("removes by slug when the draft carries the tag", () => {
    const d = design({ tags: [tag(3, "cell type", "astrocyte")] });
    const action = resolveApplyAction(slugMiss("tag:cell-type/astrocyte"), {
      design: d,
    });

    expect(action?.mutates).toBe(true);
    expect(action!.mutate!(d).tags).toHaveLength(0);
  });

  it("matches through punctuation drift via the alphanumeric fallback", () => {
    // Strict slug compare misses "border-associated macrophage" vs the
    // agent's "border_associated_macrophage"; the normalised key catches it.
    const d = design({ tags: [tag(3, "cell type", "border-associated macrophage")] });
    const action = resolveApplyAction(
      slugMiss("tag:cell_type/border_associated_macrophage"),
      { design: d },
    );

    expect(action?.mutates).toBe(true);
    expect(action!.mutate!(d).tags).toHaveLength(0);
  });

  it("reports already-removed when the slug parses but the tag is gone", () => {
    const d = design({ tags: [tag(3, "disease", "AD")] });
    const action = resolveApplyAction(slugMiss("tag:cell-type/astrocyte"), {
      design: d,
    });

    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("Already removed");
  });
});

// ---------------------------------------------------------------------------
// Tag modify / swap (replace_tag)
// ---------------------------------------------------------------------------

describe("resolveApplyAction — replace_tag", () => {
  it("reports already-applied when the tag it would modify is gone", () => {
    // Slug-shaped target the draft no longer carries. Surfacing this as
    // already-applied stops the swap path being reached with nothing to
    // swap (which used to no-op silently).
    const d = design({ tags: [tag(1, "disease", "AD")] });
    const f = finding({
      issue_code: "calibration_tag_match_near",
      target_id: "tag:strain/c57bl-10",
      apply_action: {
        kind: "replace_tag",
        new_value: "mdx",
        new_value_uri: "http://x/NCBITaxon_1",
      },
    } as Partial<AuditFinding>);

    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("Already applied");
  });

  it("modifies the matched tag in place, preserving its id", () => {
    const d = design({ tags: [tag(5, "strain", "C57BL 10")] });
    const f = finding({
      issue_code: "calibration_tag_match_near",
      target_id: "tag:strain/c57bl-10",
      apply_action: {
        kind: "replace_tag",
        new_value: "mdx",
        new_value_uri: "http://x/NCBITaxon_1",
      },
    } as Partial<AuditFinding>);

    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    expect(next.tags).toHaveLength(1);
    expect(next.tags[0].id).toBe(5);
    expect(next.tags[0].value.label).toBe("mdx");
  });

  // -------------------------------------------------------------------
  // supersede set — ticket 189 / GSE245515 shape. The producer doesn't
  // emit ``supersedes`` yet; these pin the reader so the behaviour is
  // right the day it does, and pin the no-field case so nothing moves
  // until then.
  // -------------------------------------------------------------------

  const CLO_IPSC = "http://purl.obolibrary.org/obo/CLO_0037209";

  /** The composed tag plus the two bare tags it subsumes. */
  function composedTagDesign(): Design {
    return design({
      tags: [
        tag(1, "cell type", "glutamatergic neuron"),
        tag(2, "cell line", "induced pluripotent stem cell line cell"),
      ],
    });
  }

  function composedTagFinding(supersedes?: string[]): AuditFinding {
    return finding({
      issue_code: "calibration_tag_match_near",
      target_id: "tag:1",
      apply_action: {
        kind: "replace_tag",
        statements: [
          {
            category: null,
            subject: wireTerm("glutamatergic neuron"),
            predicate: wireTerm("derives from cell", CLO_IPSC),
            object: wireTerm("induced pluripotent stem cell line cell"),
          },
        ],
        ...(supersedes ? { supersedes } : {}),
      },
    } as Partial<AuditFinding>);
  }

  it("removes the tags a composed tag supersedes, in the same mutation", () => {
    const d = composedTagDesign();
    const action = resolveApplyAction(composedTagFinding(["tag:2"]), {
      design: d,
    });
    expect(action?.mutates).toBe(true);
    expect(action?.tooltip).toContain("Also removes 1 tag it covers");

    const next = action!.mutate!(d);
    // One click: the composed tag gains its statement AND the covered
    // tag is gone. Never one without the other.
    expect(next.tags.map((t) => t.id)).toEqual([1]);
    expect(next.tags[0].statements?.[0]?.predicate?.uri).toBe(CLO_IPSC);
    expect(action?.appliedFix).toContain(
      "supersedes cell line: induced pluripotent stem cell line cell",
    );
  });

  it("changes nothing when the producer ships no supersede set", () => {
    const d = composedTagDesign();
    const action = resolveApplyAction(composedTagFinding(), { design: d });
    const next = action!.mutate!(d);
    expect(next.tags.map((t) => t.id)).toEqual([1, 2]);
    expect(action?.tooltip).not.toContain("covers");
  });

  it("resolves a supersede entry by slug as well as by id", () => {
    const d = composedTagDesign();
    const action = resolveApplyAction(
      composedTagFinding([
        "tag:cell-line/induced-pluripotent-stem-cell-line-cell",
      ]),
      { design: d },
    );
    expect(action!.mutate!(d).tags.map((t) => t.id)).toEqual([1]);
  });

  it("ignores a supersede entry naming the target tag itself", () => {
    // Otherwise the modify lands and is immediately deleted by its own
    // supersede set — the tag disappears and the record says accepted.
    const d = composedTagDesign();
    const action = resolveApplyAction(composedTagFinding(["tag:1"]), {
      design: d,
    });
    const next = action!.mutate!(d);
    expect(next.tags.map((t) => t.id)).toEqual([1, 2]);
  });

  it("ignores supersede entries that don't resolve", () => {
    const d = composedTagDesign();
    const action = resolveApplyAction(
      composedTagFinding(["tag:404", "tag:nope/gone", ""]),
      { design: d },
    );
    expect(action!.mutate!(d).tags.map((t) => t.id)).toEqual([1, 2]);
  });

  it("still offers the removal when the composed tag already landed", () => {
    // A reload between the two halves of an earlier apply leaves the
    // statement in place and the covered tag behind. "Already applied"
    // would strand it.
    const d = design({
      tags: [
        {
          ...tag(1, "cell type", "glutamatergic neuron"),
          statements: [
            {
              subject: term("glutamatergic neuron"),
              predicate: term("derives from cell", CLO_IPSC),
              object: term("induced pluripotent stem cell line cell"),
            },
          ],
        },
        tag(2, "cell line", "induced pluripotent stem cell line cell"),
      ],
    });
    const action = resolveApplyAction(composedTagFinding(["tag:2"]), {
      design: d,
    });
    expect(action?.mutates).toBe(true);
    expect(action!.mutate!(d).tags.map((t) => t.id)).toEqual([1]);
  });

  it("reports already-applied once the covered tags are gone too", () => {
    const d = design({
      tags: [
        {
          ...tag(1, "cell type", "glutamatergic neuron"),
          statements: [
            {
              subject: term("glutamatergic neuron"),
              predicate: term("derives from cell", CLO_IPSC),
              object: term("induced pluripotent stem cell line cell"),
            },
          ],
        },
      ],
    });
    const action = resolveApplyAction(composedTagFinding(["tag:2"]), {
      design: d,
    });
    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("Already applied");
  });

  it("removes the baseline WITHOUT adding an ungrounded replacement", () => {
    // Adding a free-text replacement is how "removing a hallucinated tag
    // added a random tag instead" happened. Degrade to a pure removal.
    const d = design({ tags: [tag(9, "disease", "made up thing")] });
    const f = finding({
      issue_code: "calibration_tag_match_near",
      target_id: "tag:9",
      apply_action: {
        kind: "replace_tag",
        new_category: "disease",
        new_value: "something else",
        new_value_uri: null,
      },
    } as Partial<AuditFinding>);

    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    expect(action?.tooltip).toContain("isn't grounded");

    const next = action!.mutate!(d);
    expect(next.tags).toHaveLength(0);
  });

  it("reports already-applied for an ungrounded swap whose baseline is gone", () => {
    const d = design({ tags: [tag(1, "disease", "AD")] });
    const f = finding({
      issue_code: "calibration_tag_match_near",
      target_id: "tag:9",
      apply_action: {
        kind: "replace_tag",
        new_category: "disease",
        new_value: "something else",
        new_value_uri: null,
      },
    } as Partial<AuditFinding>);

    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("Already applied");
  });

  it("reports already-applied when the baseline is gone and the replacement is present", () => {
    const d = design({
      tags: [
        tag(1, "disease", "cerebral ischemia", {
          valueUri: "http://x/MONDO_0002679",
        }),
      ],
    });
    const f = finding({
      issue_code: "calibration_tag_match_near",
      target_id: "tag:9",
      apply_action: {
        kind: "replace_tag",
        new_category: "disease",
        new_value: "cerebral ischemia",
        new_value_uri: "http://x/MONDO_0002679",
      },
    } as Partial<AuditFinding>);

    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("Already applied");
  });
});

// ---------------------------------------------------------------------------
// Focus-only fallbacks for non-tag/factor target kinds
// ---------------------------------------------------------------------------

describe("resolveApplyAction — focus-only routing by target kind", () => {
  const cases: Array<[string, string]> = [
    ["assignment:GSM123", "samples tab"],
    ["experiment:1", "overview tab"],
    ["characteristic:BioSource", "overview tab"],
    ["statement:disease/ad/0", "design tab"],
  ];

  for (const [targetId, expected] of cases) {
    it(`routes ${targetId.split(":")[0]} findings to the ${expected}`, () => {
      const f = finding({
        issue_code: "some_unhandled_code",
        target_id: targetId,
      });

      const action = resolveApplyAction(f, { design: design() });
      expect(action?.mutates).toBe(false);
      expect(action?.tooltip).toContain(expected);
    });
  }

  it("returns null for a target_id that does not parse at all", () => {
    const f = finding({ issue_code: "some_unhandled_code", target_id: "junk" });
    expect(resolveApplyAction(f, { design: design() })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// addPopulatedTag duplicate guard
// ---------------------------------------------------------------------------

describe("add-tag duplicate guard", () => {
  it("does not append a second copy of a tag that is already present", () => {
    // The resolver's idempotency arm normally catches this first; the
    // helper repeats the guard so a re-run of the mutator (undo/redo
    // replay, Apply All batch) can't double-add.
    const d = design();
    const f = finding({
      issue_code: "calibration_agent_extra",
      target_id: "calibration:extra:disease/ad",
      proposer_term: wireTerm("AD", null),
    });

    const mutate = resolveApplyAction(f, { design: d })!.mutate!;
    const once = mutate(d);
    const twice = mutate(once);

    expect(once.tags).toHaveLength(1);
    expect(twice.tags).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// tagAlreadyOnDesign — the single "is it already there?" predicate
//
// Exercised through every call site rather than directly, because the
// point of consolidating was that the resolver arm and the mutator guard
// must agree. A resolver that offers "Agree (add)" over a guard that
// then declines is a no-op click.
// ---------------------------------------------------------------------------

describe("duplicate detection is one rule everywhere", () => {
  const agentExtra = (uri: string | null) =>
    finding({
      issue_code: "calibration_agent_extra",
      target_id: "calibration:extra:disease/ad",
      proposer_term: wireTerm("AD", uri),
    });

  it("an inferred projection does not block adding the real tag", () => {
    // An inferred row is a projection of a sample characteristic, not a
    // stored experiment tag. Curating it into a real tag is legitimate
    // work; the overlap is then SHOWN (TagBar's violet redundancy glint),
    // not prevented here.
    const d = design({ tags: [tag(1, "disease", "AD", { inferred: true })] });

    const action = resolveApplyAction(agentExtra(null), { design: d });
    expect(action?.mutates).toBe(true);

    const next = action!.mutate!(d);
    // The real tag lands; the projection is untouched.
    expect(next.tags.filter((t) => !t.inferred)).toHaveLength(1);
    expect(next.tags.filter((t) => t.inferred)).toHaveLength(1);
  });

  it("a real tag with the same labels DOES block it", () => {
    const d = design({ tags: [tag(1, "disease", "AD")] });

    expect(resolveApplyAction(agentExtra(null), { design: d })?.mutates).toBe(
      false,
    );
  });

  it("same labels under a different URI adds, and the mutator agrees", () => {
    // The resolver treats a different ontology term as a different
    // concept and offers the add. The mutator's guard used to compare
    // labels ONLY, so it then refused — the curator clicked Agree and
    // nothing happened. Both sides now read the URI the same way.
    const d = design({
      tags: [tag(1, "disease", "AD", { valueUri: "http://x/OTHER" })],
    });

    const action = resolveApplyAction(agentExtra("http://x/MONDO_1"), {
      design: d,
    });
    expect(action?.mutates).toBe(true);

    const next = action!.mutate!(d);
    expect(next.tags).toHaveLength(2);
    expect(next.tags.map((t) => t.value.uri).sort()).toEqual([
      "http://x/MONDO_1",
      "http://x/OTHER",
    ]);
  });

  it("matches on labels alone when the draft tag carries no URI", () => {
    // No URI evidence to disagree on — don't add a second chip reading
    // the same words.
    const d = design({ tags: [tag(1, "disease", "AD")] });

    const action = resolveApplyAction(agentExtra("http://x/MONDO_1"), {
      design: d,
    });
    expect(action?.mutates).toBe(false);
  });

  it("stays idempotent when the same mutator is replayed", () => {
    // Undo/redo and Apply All batches replay mutators.
    const d = design();
    const mutate = resolveApplyAction(agentExtra("http://x/MONDO_1"), {
      design: d,
    })!.mutate!;

    expect(mutate(mutate(d)).tags).toHaveLength(1);
  });
});
