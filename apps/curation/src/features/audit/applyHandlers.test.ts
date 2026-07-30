import { describe, expect, it } from "vitest";
import type { AuditFinding } from "@/api/auditTypes";
import type {
  Design,
  Tag,
  Factor,
  FactorValue,
  OntologyTerm,
} from "@/features/experiment/types";
import { resolveApplyAction } from "./applyHandlers";

/**
 * Contract tests for the apply-action chain. These lock in the
 * behaviour the reviewer keeps having to re-prove: when the curator clicks
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

  it("removes a tag when target_id slug is hyphen-joined but design label uses spaces (the actual bug the reviewer hit)", () => {
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

  it("attaches apply_action.statements to a genuinely-new statement-bearing tag (Dmd add)", () => {
    // TAG_STATEMENT_ADD_TAG_APPLY_BUG_2026_07_13.md — accepting an
    // add_tag that carries statements must materialise the statement on
    // the new tag, not a bare gene tag. This is add-of-new (Dmd not in
    // the design), NOT the reverted existing-tag-mod-through-add_tag.
    const dmdStmt = {
      category: { label: "genotype", uri: null },
      subject: { label: "Dmd", uri: "http://ncbi_gene/13405" },
      predicate: { label: "has_genotype", uri: "http://TGEMO/00166" },
      object: { label: "mdx", uri: null },
    };
    const d = design({ tags: [] });
    const f = finding({
      target_kind: "tag",
      issue_code: "calibration_agent_extra",
      target_id: "tag:genotype/dmd",
      proposer_term: {
        label: "Dmd",
        uri: "http://ncbi_gene/13405",
        resolver: null,
        score: null,
      },
      proposer_statements: [dmdStmt] as never,
      apply_action: {
        kind: "add_tag",
        new_category: "genotype",
        new_value: "Dmd",
        new_value_uri: "http://ncbi_gene/13405",
        statements: [dmdStmt],
      } as never,
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    expect(next.tags).toHaveLength(1);
    const t = next.tags[0];
    expect(t.value.label).toBe("Dmd");
    expect(t.statements).toHaveLength(1);
    expect(t.statements![0].subject.label).toBe("Dmd");
    expect(t.statements![0].predicate?.label).toBe("has_genotype");
    expect(t.statements![0].object?.label).toBe("mdx");
  });

  it("materialises a treatment/cell-line add_tag carrying a derives-from statement (GSE43566)", () => {
    // Regression test for a ticket-130 export bug: the exported bundle
    // dropped an accepted ``treatment: neoplastic cell`` (CL_0001063)
    // tag that carried a ``neoplastic cell —derives from→ MMTV-PyMT``
    // statement. One hypothesis was that the resolver silently no-ops for
    // this shape (category ``treatment``, a CL cell-type value, predicate
    // ``derives from`` / RO_0001000) because the tested coverage was
    // gene-genotype-shaped (Dmd). This locks in that the add-of-new path
    // is category/predicate-agnostic: the tag AND its statement
    // materialise identically to the Dmd case. (The real drop is
    // downstream in the draft→/design→/polished→export persistence
    // chain, not here.)
    const derivesStmt = {
      category: { label: "treatment", uri: null },
      subject: { label: "neoplastic cell", uri: "http://purl.obolibrary.org/obo/CL_0001063" },
      predicate: { label: "derives from", uri: "http://purl.obolibrary.org/obo/RO_0001000" },
      object: { label: "MMTV-PyMT", uri: null },
    };
    const d = design({ tags: [] });
    const f = finding({
      target_kind: "tag",
      issue_code: "calibration_agent_extra",
      target_id: "tag:treatment/neoplastic-cell",
      proposer_term: {
        label: "neoplastic cell",
        uri: "http://purl.obolibrary.org/obo/CL_0001063",
        resolver: null,
        score: null,
      },
      proposer_statements: [derivesStmt] as never,
      apply_action: {
        kind: "add_tag",
        new_category: "treatment",
        new_value: "neoplastic cell",
        new_value_uri: "http://purl.obolibrary.org/obo/CL_0001063",
        statements: [derivesStmt],
      } as never,
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    expect(next.tags).toHaveLength(1);
    const t = next.tags[0];
    expect(t.category.label).toBe("treatment");
    expect(t.value.label).toBe("neoplastic cell");
    expect(t.value.uri).toBe("http://purl.obolibrary.org/obo/CL_0001063");
    expect(t.statements).toHaveLength(1);
    expect(t.statements![0].subject.label).toBe("neoplastic cell");
    expect(t.statements![0].predicate?.label).toBe("derives from");
    expect(t.statements![0].object?.label).toBe("MMTV-PyMT");
    // The disposition's applied_fix must carry the statement text so the
    // accept record is not a bare "add treatment: neoplastic cell".
    expect(action!.appliedFix).toContain("neoplastic cell · derives from · MMTV-PyMT");
  });

  it("adds a bare tag when the add carries no statements (unchanged)", () => {
    const d = design({ tags: [] });
    const f = finding({
      target_kind: "tag",
      issue_code: "missing_tag",
      target_id: "tag:disease/diabetes",
      apply_action: {
        kind: "add_tag",
        new_category: "disease",
        new_value: "diabetes",
        new_value_uri: "EFO:0001360",
      },
    });
    const action = resolveApplyAction(f, { design: d });
    const next = action!.mutate!(d);
    expect(next.tags[0].statements).toBeUndefined();
  });
});

describe("resolveApplyAction — SWAP TAG (replace_tag)", () => {
  // Tag swap: replace an existing baseline tag (target_id = "tag:N")
  // with a same-concept term under a different URI. The "current" side
  // is the replaced tag id; the proposed side is proposer_term /
  // apply_action. Adopt = drop baseline id N + add the replacement.
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

  it("removes the baseline but does NOT add an ungrounded (no-URI) replacement (B2)", () => {
    // GSE193284 regression: the agent flagged a hallucinated tag for
    // removal, but the replace_tag mutator added a free-text,
    // non-ontology replacement. With no grounded URI anywhere
    // (proposer_term or apply_action), the swap degrades to a pure
    // removal — the baseline drops and nothing free-text lands.
    const d = design({
      tags: [
        tag(7, "disease", "depressive disorder", {
          valueUri: "http://purl.obolibrary.org/obo/MONDO_0002050",
        }),
      ],
    });
    const f = finding({
      target_kind: "tag",
      issue_code: "calibration_tag_match_near",
      target_id: "tag:7",
      // No proposer_term URI, no new_value_uri → ungrounded.
      proposer_term: {
        label: "reference subject role",
        uri: null,
        resolver: null,
        score: null,
      },
      apply_action: {
        kind: "replace_tag",
        new_category: "disease",
        new_value: "reference subject role",
      } as never,
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    expect(action?.label).toBe("Agree (remove) →");
    const next = action!.mutate!(d);
    // Baseline gone; no free-text replacement added.
    expect(next.tags.find((t) => t.id === 7)).toBeUndefined();
    expect(next.tags).toHaveLength(0);
  });

  it("returns idempotent 'Already applied' for an ungrounded swap whose baseline is already gone", () => {
    const d = design({ tags: [] });
    const f = finding({
      target_kind: "tag",
      issue_code: "calibration_tag_match_near",
      target_id: "tag:7",
      proposer_term: { label: "free text", uri: null, resolver: null, score: null },
      apply_action: {
        kind: "replace_tag",
        new_category: "disease",
        new_value: "free text",
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

describe("resolveApplyAction — MODIFY TAG (replace_tag with statements)", () => {
  // Tag near-match (calibration_tag_match_near, 2026-07-13): a proposed
  // tag matches an existing one but its structured statements moved
  // (a bare ``genotype: Utrn`` gains ``Utrn · has_genotype ·
  // Heterozygous``). ``replace_tag`` becomes the general MODIFY — on
  // accept the target tag is updated IN PLACE (id preserved), its
  // statements replaced with the proposed set (replace-with-proposed).
  // TAG_STATEMENT_APPLY_AND_RENDER_UI_2026_07_13.md.
  const genotypeStmt = {
    category: { label: "genotype", uri: null },
    subject: { label: "Utrn", uri: "http://gene/Utrn" },
    predicate: { label: "has_genotype", uri: "http://TGEMO/00166" },
    object: { label: "Heterozygous", uri: "http://TGEMO/00003" },
  };

  it("sets the target tag's statements in place, preserving the id (not remove+add)", () => {
    const d = design({
      tags: [tag(3, "genotype", "Utrn", { valueUri: "http://gene/Utrn" })],
    });
    const f = finding({
      target_kind: "tag",
      issue_code: "calibration_tag_match_near",
      target_id: "tag:3",
      proposer_statements: [genotypeStmt] as never,
      apply_action: {
        kind: "replace_tag",
        statements: [genotypeStmt],
      } as never,
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    // Same tag id survives — modify in place, not remove+add.
    expect(next.tags).toHaveLength(1);
    const t = next.tags.find((x) => x.id === 3);
    expect(t).toBeDefined();
    expect(t!.statements).toHaveLength(1);
    expect(t!.statements![0].subject.label).toBe("Utrn");
    expect(t!.statements![0].predicate?.label).toBe("has_genotype");
    expect(t!.statements![0].object?.label).toBe("Heterozygous");
  });

  it("falls back to proposer_statements when apply_action.statements is null (GSE84876 Utrn bug)", () => {
    // Live repro: the agent populates proposer_statements (so the delta
    // renders) but leaves apply_action.statements null → the modify
    // silently no-op'd and "adopt Auditor's" didn't update the Utrn tag.
    // The apply must fall back to proposer_statements.
    const d = design({
      tags: [
        tag(1, "genotype", "Utrn [mouse] utrophin", {
          valueUri: "http://ncbi_gene/22288",
        }),
      ],
    });
    const f = finding({
      target_kind: "tag",
      issue_code: "calibration_tag_match_near",
      target_id: "tag:genotype/utrn-[mouse]-utrophin",
      proposer_term: {
        label: "Utrn [mouse] utrophin",
        uri: "http://ncbi_gene/22288",
        resolver: null,
        score: null,
      },
      proposer_statements: [
        {
          category: null,
          subject: { label: "Utrn [mouse] utrophin", uri: "http://ncbi_gene/22288" },
          predicate: { label: "has_genotype", uri: "http://TGEMO/00166" },
          object: { label: "Heterozygous", uri: "http://TGEMO/00003" },
        },
      ] as never,
      // Statement field ABSENT on the wire — the actual bug shape.
      apply_action: {
        kind: "replace_tag",
        new_value: null,
        new_category: null,
      } as never,
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    const t = next.tags.find((x) => x.id === 1)!;
    expect(t.statements).toHaveLength(1);
    expect(t.statements![0].predicate?.label).toBe("has_genotype");
    expect(t.statements![0].object?.label).toBe("Heterozygous");
  });

  it("resolves the target tag from a slug-shaped target_id (tag:<cat>/<val>)", () => {
    const d = design({
      tags: [tag(8, "genotype", "Utrn", { valueUri: "http://gene/Utrn" })],
    });
    const f = finding({
      target_kind: "tag",
      issue_code: "calibration_tag_match_near",
      target_id: "tag:genotype/utrn",
      proposer_statements: [genotypeStmt] as never,
      apply_action: {
        kind: "replace_tag",
        statements: [genotypeStmt],
      } as never,
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    expect(next.tags.find((x) => x.id === 8)!.statements).toHaveLength(1);
  });

  it("overwrites category / value too when the apply_action carries them", () => {
    const d = design({
      tags: [tag(4, "disease", "brain ischemia")],
    });
    const f = finding({
      target_kind: "tag",
      issue_code: "calibration_tag_match_near",
      target_id: "tag:4",
      proposer_term: {
        label: "cerebral ischemia",
        uri: "http://MONDO/0002679",
        resolver: null,
        score: null,
      },
      proposer_statements: [
        {
          category: { label: "disease model", uri: null },
          subject: { label: "cerebral ischemia", uri: "http://MONDO/0002679" },
          predicate: { label: "has_modifier", uri: null },
          object: { label: "chronic", uri: null },
        },
      ] as never,
      apply_action: {
        kind: "replace_tag",
        new_category: "disease model",
        new_value: "cerebral ischemia",
        new_value_uri: "http://MONDO/0002679",
        statements: [
          {
            category: { label: "disease model", uri: null },
            subject: {
              label: "cerebral ischemia",
              uri: "http://MONDO/0002679",
            },
            predicate: { label: "has_modifier", uri: null },
            object: { label: "chronic", uri: null },
          },
        ],
      } as never,
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    const t = next.tags.find((x) => x.id === 4)!;
    expect(t.category.label).toBe("disease model");
    expect(t.value.label).toBe("cerebral ischemia");
    expect(t.value.uri).toBe("http://MONDO/0002679");
    expect(t.statements).toHaveLength(1);
  });

  it("is idempotent when the target tag already carries the proposed statements", () => {
    const withStmts: Tag = {
      ...tag(3, "genotype", "Utrn", { valueUri: "http://gene/Utrn" }),
      statements: [
        {
          category: term("genotype"),
          subject: term("Utrn", "http://gene/Utrn"),
          predicate: term("has_genotype", "http://TGEMO/00166"),
          object: term("Heterozygous", "http://TGEMO/00003"),
        },
      ],
    };
    const d = design({ tags: [withStmts] });
    const f = finding({
      target_kind: "tag",
      issue_code: "calibration_tag_match_near",
      target_id: "tag:3",
      proposer_statements: [genotypeStmt] as never,
      apply_action: {
        kind: "replace_tag",
        statements: [genotypeStmt],
      } as never,
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("Already applied");
  });

  it("modifies a value-concept near-match with a SLUG target_id in place (strain C57BL/10 → mdx)", () => {
    // GSE84876 strain near-match: replace_tag, slug target_id, NO
    // statements, new_value "mdx". The old path required a numeric
    // tag:N and returned null → "adopt Auditor's" did nothing (the reviewer
    // 2026-07-13). Now it modifies the matched tag in place.
    const d = design({
      tags: [
        tag(1, "strain", "C57BL/10", { valueUri: "http://EFO/0000604" }),
      ],
    });
    const f = finding({
      target_kind: "tag",
      issue_code: "calibration_tag_match_near",
      target_id: "tag:strain/c57bl/10",
      proposer_term: {
        label: "mdx",
        uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00180",
        resolver: null,
        score: null,
      },
      apply_action: {
        kind: "replace_tag",
        new_value: "mdx",
        new_value_uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00180",
        new_category: null,
      } as never,
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    // Same tag id, value swapped to the proposal, category retained.
    expect(next.tags).toHaveLength(1);
    const t = next.tags.find((x) => x.id === 1)!;
    expect(t.category.label).toBe("strain");
    expect(t.value.label).toBe("mdx");
    expect(t.value.uri).toBe("http://gemma.msl.ubc.ca/ont/TGEMO_00180");
  });

  it("refuses to modify a protected (assay) tag via statements", () => {
    const d = design({
      tags: [tag(9, "assay", "RNA-Seq", { valueUri: "EFO:0008896" })],
    });
    const f = finding({
      target_kind: "tag",
      issue_code: "calibration_tag_match_near",
      target_id: "tag:9",
      proposer_statements: [genotypeStmt] as never,
      apply_action: {
        kind: "replace_tag",
        statements: [genotypeStmt],
      } as never,
    });
    const action = resolveApplyAction(f, { design: d });
    if (action?.mutates && action.mutate) {
      const next = action.mutate(d);
      // Untouched — statements not attached to the assay tag.
      expect(next.tags.find((x) => x.id === 9)!.statements).toBeUndefined();
    } else {
      expect(action?.mutates ?? false).toBe(false);
    }
  });

  it("leaves a plain replace_tag (no statements) on the existing swap path", () => {
    // Regression guard: the statement branch must NOT capture a
    // no-statements swap — that still removes the baseline and adds the
    // replacement (existing behaviour).
    const d = design({
      tags: [
        tag(2, "disease model", "brain ischemia", {
          valueUri: "http://MONDO/0005299",
        }),
      ],
    });
    const f = finding({
      target_kind: "tag",
      issue_code: "calibration_tag_match_near",
      target_id: "tag:2",
      proposer_term: {
        label: "cerebral ischemia",
        uri: "http://MONDO/0002679",
        resolver: null,
        score: null,
      },
      apply_action: {
        kind: "replace_tag",
        new_category: "disease model",
        new_value: "cerebral ischemia",
        new_value_uri: "http://MONDO/0002679",
      } as never,
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    // Baseline id 2 gone (remove+add swap), replacement present.
    expect(next.tags.find((x) => x.id === 2)).toBeUndefined();
    expect(next.tags[0].value.label).toBe("cerebral ischemia");
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

describe("resolveApplyAction — CONTINUOUS FACTOR add (design review 2026-06-13)", () => {
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

/**
 * calibration_factor_misbinding — the agent bound the wrong
 * gene/strain/cell-line on an otherwise-MATCHED factor. Agree = rebind
 * that ONE factor value (relabel + statement subject/object URI) to the
 * correct entity. Only fires on a clean 1↔1 swap (apply_action present);
 * multi-bind disagreements ship flag-only and stay focus-only.
 */
function mfv(
  id: number,
  label: string,
  opts: {
    uri?: string | null;
    statements?: FactorValue["statements"];
  } = {},
): FactorValue {
  return {
    id,
    free_text_label: label,
    is_baseline: false,
    biomaterial_short_names: [],
    statements:
      opts.statements ?? [{ subject: term(label, opts.uri ?? null) }],
  };
}

function factor(id: number, categoryLabel: string, fvs: FactorValue[]): Factor {
  return {
    id,
    name: categoryLabel,
    category: term(categoryLabel, null),
    description: "",
    type: "categorical",
    factor_values: fvs,
  };
}

function misbind(opts: {
  wrongLabel: string;
  wrongUri?: string | null;
  newValue: string;
  newValueUri?: string | null;
  suggestedFix?: string;
  applyAction?: AuditFinding["apply_action"];
}): AuditFinding {
  return finding({
    target_kind: "factor",
    target_id: "factor:8001",
    issue_code: "calibration_factor_misbinding",
    severity: "major",
    proposer_term: {
      label: opts.wrongLabel,
      uri: opts.wrongUri ?? null,
      resolver: null,
      score: null,
    },
    gold_target_index: 0,
    suggested_fix: opts.suggestedFix ?? "",
    apply_action:
      "applyAction" in opts
        ? opts.applyAction
        : {
            kind: "rename_fv",
            new_value: opts.newValue,
            new_value_uri: opts.newValueUri ?? null,
          },
  });
}

describe("resolveApplyAction — FACTOR MISBINDING (rename_fv)", () => {
  it("rebinds the wrong-bound FV to the correct entity (URI match)", () => {
    const d = design({
      factors: [
        factor(8001, "genotype", [
          mfv(1, "Gjb6", { uri: "http://ncbi/14623" }),
          mfv(2, "WT", { uri: null }),
        ]),
      ],
    });
    const f = misbind({
      wrongLabel: "Gjb6",
      wrongUri: "http://ncbi/14623",
      newValue: "Gja1",
      newValueUri: "http://ncbi/14609",
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    const fvOut = next.factors[0].factor_values.find((v) => v.id === 1)!;
    expect(fvOut.free_text_label).toBe("Gja1");
    expect(fvOut.statements[0].subject.label).toBe("Gja1");
    expect(fvOut.statements[0].subject.uri).toBe("http://ncbi/14609");
    // The correctly-bound sibling FV is untouched.
    expect(
      next.factors[0].factor_values.find((v) => v.id === 2)!.free_text_label,
    ).toBe("WT");
  });

  it("locates the FV by label when the wrong bind carries no URI", () => {
    const d = design({
      factors: [factor(8001, "strain", [mfv(1, "C57BL/10", { uri: null })])],
    });
    const f = misbind({
      wrongLabel: "C57BL/10",
      newValue: "mdx",
      newValueUri: "http://tgemo/180",
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    const fvOut = action!.mutate!(d).factors[0].factor_values[0];
    expect(fvOut.free_text_label).toBe("mdx");
    expect(fvOut.statements[0].subject.uri).toBe("http://tgemo/180");
  });

  it("rebinds an object-role bound term", () => {
    const d = design({
      factors: [
        factor(8001, "genotype", [
          mfv(1, "Utrn het", {
            statements: [
              {
                subject: term("Utrn"),
                predicate: term("has_genotype"),
                object: term("WrongAllele", "http://x/wrong"),
              },
            ],
          }),
        ]),
      ],
    });
    const f = misbind({
      wrongLabel: "WrongAllele",
      wrongUri: "http://x/wrong",
      newValue: "RightAllele",
      newValueUri: "http://x/right",
    });
    const st = resolveApplyAction(f, { design: d })!.mutate!(d).factors[0]
      .factor_values[0].statements[0];
    expect(st.object?.label).toBe("RightAllele");
    expect(st.object?.uri).toBe("http://x/right");
  });

  it("stays focus-only for a flag-only finding (no apply_action)", () => {
    const d = design({
      factors: [factor(8001, "genotype", [mfv(1, "Gjb6", { uri: "http://ncbi/14623" })])],
    });
    const f = misbind({
      wrongLabel: "Gjb6",
      wrongUri: "http://ncbi/14623",
      newValue: "Gja1",
      applyAction: null,
    });
    const action = resolveApplyAction(f, { design: d });
    // Falls through to focus-only — never a silent rebind.
    expect(action?.mutates).toBe(false);
  });

  it("reports already-applied when the FV is already rebound (idempotent)", () => {
    const d = design({
      factors: [factor(8001, "genotype", [mfv(1, "Gja1", { uri: "http://ncbi/14609" })])],
    });
    const f = misbind({
      wrongLabel: "Gjb6",
      wrongUri: "http://ncbi/14623",
      newValue: "Gja1",
      newValueUri: "http://ncbi/14609",
    });
    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("Already applied");
  });

  it("uses the finding's suggested_fix as appliedFix", () => {
    const d = design({
      factors: [factor(8001, "genotype", [mfv(1, "Gjb6", { uri: "http://ncbi/14623" })])],
    });
    const f = misbind({
      wrongLabel: "Gjb6",
      wrongUri: "http://ncbi/14623",
      newValue: "Gja1",
      newValueUri: "http://ncbi/14609",
      suggestedFix: "Rebind FV `Gjb6` to `Gja1`.",
    });
    expect(resolveApplyAction(f, { design: d })?.appliedFix).toBe(
      "Rebind FV `Gjb6` to `Gja1`.",
    );
  });
});
