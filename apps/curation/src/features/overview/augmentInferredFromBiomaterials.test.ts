import { describe, expect, it } from "vitest";
import { augmentInferredFromBiomaterials } from "./augmentInferred";
import type { Biomaterial, Tag } from "@/features/experiment/types";

/**
 * Tests for the inferred-tag augmenter. The function should:
 *   1. Synth one chip per category present in biomaterial
 *      characteristics, comma-joining sorted distinct values.
 *   2. Drop existing inferred tags for any synthed category (the
 *      synth supersedes them with the comprehensive set).
 *   3. Skip the synth entirely for categories already claimed by a
 *      direct (curator-attached) tag — the curator's choice wins.
 *   4. Pass non-affected tags through untouched.
 *   5. Stamp synth chips with inferred=true, inferred_source="BioMaterial",
 *      evidence_code="IIA".
 */

function bm(name: string, characteristics: Record<string, string>): Biomaterial {
  return { short_name: name, name, characteristics };
}

function inferredTag(id: number, category: string, value: string): Tag {
  return {
    id,
    category: { label: category, uri: null },
    value: { label: value, uri: null },
    inferred: true,
    inferred_source: "BioMaterial",
    evidence_code: "IIA",
  };
}

function directTag(id: number, category: string, value: string): Tag {
  return {
    id,
    category: { label: category, uri: null },
    value: { label: value, uri: null },
    inferred: false,
    evidence_code: "IC",
  };
}

describe("augmentInferredFromBiomaterials", () => {
  it("returns input unchanged when biomaterials carry no characteristics", () => {
    const tags: Tag[] = [inferredTag(1, "disease", "MDD")];
    const next = augmentInferredFromBiomaterials(tags, []);
    expect(next).toEqual(tags);
  });

  it("synthesises one chip per category from biomaterial characteristics", () => {
    const tags: Tag[] = [];
    const bms = [
      bm("s1", { "organism part": "amygdala" }),
      bm("s2", { "organism part": "cerebellum" }),
      bm("s3", { "organism part": "amygdala" }),
    ];
    const next = augmentInferredFromBiomaterials(tags, bms);
    expect(next).toHaveLength(1);
    expect(next[0].category.label).toBe("organism part");
    // Sorted distinct values, comma-joined.
    expect(next[0].value.label).toBe("amygdala, cerebellum");
    expect(next[0].inferred).toBe(true);
    expect(next[0].inferred_source).toBe("BioMaterial");
    expect(next[0].evidence_code).toBe("IIA");
  });

  it("supersedes an under-counted API-feed inferred tag for the same category", () => {
    // The classic case from GSE45642.2: API surfaces only one
    // organism_part value, but biomaterials carry six.
    const tags: Tag[] = [inferredTag(1, "organism part", "amygdala")];
    const bms = [
      bm("s1", { "organism part": "amygdala" }),
      bm("s2", { "organism part": "cerebellum" }),
      bm("s3", { "organism part": "nucleus accumbens" }),
    ];
    const next = augmentInferredFromBiomaterials(tags, bms);
    // The original single-value inferred tag is replaced.
    expect(
      next.find(
        (t) => t.id === 1 && t.value.label === "amygdala",
      ),
    ).toBeUndefined();
    // One synth chip with all three values.
    const synth = next.find((t) => t.category.label === "organism part");
    expect(synth?.value.label).toBe("amygdala, cerebellum, nucleus accumbens");
  });

  it("synths the OTHER per-sample values of a category a direct tag partly covers", () => {
    // Per-value cover (design review 2026-07-20): the curator's `cell type:
    // T cell` direct tag suppresses only T cell; the remaining
    // biomaterial values still surface as an inherited chip.
    const directCellType = directTag(1, "cell type", "T cell");
    const tags: Tag[] = [directCellType];
    const bms = [
      bm("s1", { "cell type": "T cell" }),
      bm("s2", { "cell type": "B cell" }),
      bm("s3", { "cell type": "NK cell" }),
    ];
    const next = augmentInferredFromBiomaterials(tags, bms);
    expect(next).toContainEqual(directCellType);
    const synth = next.find(
      (t) => t.inferred && t.category.label === "cell type",
    );
    // T cell is covered by the direct tag; only the uncovered values synth.
    expect(synth?.value.label).toBe("B cell, NK cell");
  });

  it("replaces a legacy inferred tag with the per-value synth (no duplication)", () => {
    // Legacy API-feed inferred tag alongside a direct one for the same
    // category: the synth is the comprehensive source, so the legacy
    // inferred is dropped and only the uncovered value synths.
    const direct = directTag(1, "cell type", "T cell");
    const legacyInferred = inferredTag(2, "cell type", "B cell");
    const tags: Tag[] = [direct, legacyInferred];
    const bms = [
      bm("s1", { "cell type": "T cell" }),
      bm("s2", { "cell type": "B cell" }),
    ];
    const next = augmentInferredFromBiomaterials(tags, bms);
    expect(next).toContainEqual(direct);
    // Legacy inferred replaced by the synth.
    expect(next).not.toContainEqual(legacyInferred);
    const synths = next.filter((t) => t.id < 0);
    expect(synths).toHaveLength(1);
    expect(synths[0].value.label).toBe("B cell");
  });

  it("emits one synth per category when biomaterials cover multiple", () => {
    const bms = [
      bm("s1", { "cell type": "T cell", "organism part": "spleen" }),
      bm("s2", { "cell type": "B cell", "organism part": "thymus" }),
    ];
    const next = augmentInferredFromBiomaterials([], bms);
    expect(next).toHaveLength(2);
    const cats = next.map((t) => t.category.label).sort();
    expect(cats).toEqual(["cell type", "organism part"]);
  });

  it("filters empty / whitespace-only values", () => {
    const bms = [
      bm("s1", { "cell type": "T cell" }),
      bm("s2", { "cell type": "" }),
      bm("s3", { "cell type": "   " }),
    ];
    const next = augmentInferredFromBiomaterials([], bms);
    expect(next).toHaveLength(1);
    expect(next[0].value.label).toBe("T cell");
  });

  it("matches the direct per-value cover case-insensitively", () => {
    const direct = directTag(1, "Cell Type", "T cell");
    const bms = [
      bm("s1", { "cell type": "T cell" }),
      bm("s2", { "cell type": "B cell" }),
    ];
    const next = augmentInferredFromBiomaterials([direct], bms);
    const synth = next.find(
      (t) => t.inferred && (t.category.label || "").toLowerCase() === "cell type",
    );
    // "Cell Type: T cell" covers "cell type: T cell" case-insensitively;
    // only the uncovered B cell surfaces.
    expect(synth?.value.label).toBe("B cell");
  });

  it("uses negative ids for synth tags so they don't collide with server ids", () => {
    const bms = [bm("s1", { "cell type": "T cell" })];
    const next = augmentInferredFromBiomaterials([], bms);
    expect(next[0].id).toBeLessThan(0);
  });

  it("preserves direct tags untouched", () => {
    const direct = directTag(1, "treatment", "vehicle");
    const next = augmentInferredFromBiomaterials([direct], []);
    expect(next).toContainEqual(direct);
  });

  // Design review 2026-07-20 (supersedes the B3 removed-category suppression):
  // removing a direct tag no longer stops the biomaterial-derived synth
  // chip. The inherited chip reflects per-sample reality and reappears;
  // the direct-wins dedup keeps the EE tag on top while both are present,
  // and "Hide inherited" governs whether inferred chips show at all.
  it("re-synthesizes an inferred chip when no direct tag remains for that category", () => {
    const bms = [
      bm("s1", { "cell type": "fibroblast" }),
      bm("s2", { "cell type": "fibroblast" }),
    ];
    const next = augmentInferredFromBiomaterials([], bms);
    const synth = next.find(
      (t) => (t.category.label || "").toLowerCase() === "cell type",
    );
    expect(synth).toBeDefined();
    expect(synth?.inferred).toBe(true);
    expect(synth?.value.label).toBe("fibroblast");
  });

  it("synthesizes a chip for every biomaterial category present", () => {
    const bms = [
      bm("s1", { "cell type": "fibroblast", "organism part": "skin" }),
    ];
    const next = augmentInferredFromBiomaterials([], bms);
    expect(
      next.map((t) => (t.category.label || "").toLowerCase()).sort(),
    ).toEqual(["cell type", "organism part"]);
  });

  // Per-value cover (design review 2026-07-20): a direct tag suppresses re-synth
  // of its OWN value only — not the whole category.
  it("does not re-synthesize a value already carried by a direct tag", () => {
    const direct = directTag(1, "treatment", "tamoxifen");
    const bms = [
      bm("s1", { treatment: "tamoxifen" }),
      bm("s2", { treatment: "tamoxifen" }),
    ];
    const next = augmentInferredFromBiomaterials([direct], bms);
    expect(next).toContainEqual(direct);
    expect(
      next.find(
        (t) =>
          t.inferred && (t.category.label || "").toLowerCase() === "treatment",
      ),
    ).toBeUndefined();
  });

  it("synthesizes only the uncovered per-sample values alongside a direct tag", () => {
    const direct = directTag(1, "treatment", "tamoxifen");
    const bms = [
      bm("s1", { treatment: "tamoxifen" }),
      bm("s2", { treatment: "vehicle" }),
    ];
    const next = augmentInferredFromBiomaterials([direct], bms);
    const synth = next.find(
      (t) =>
        t.inferred && (t.category.label || "").toLowerCase() === "treatment",
    );
    expect(synth?.value.label).toBe("vehicle");
  });

  it("reveals the inherited value once the redundant direct tag is removed", () => {
    const bms = [
      bm("s1", { treatment: "tamoxifen" }),
      bm("s2", { treatment: "tamoxifen" }),
    ];
    // Curator deleted the direct tag → the inherited value now surfaces.
    const next = augmentInferredFromBiomaterials([], bms);
    const synth = next.find(
      (t) =>
        t.inferred && (t.category.label || "").toLowerCase() === "treatment",
    );
    expect(synth?.value.label).toBe("tamoxifen");
  });

  // -------------------------------------------------------------------------
  // Whitespace drift between hand-typed per-sample values
  // -------------------------------------------------------------------------

  it("collapses internal whitespace drift into one value", () => {
    // Real GSE102352 characteristics: the same cell type arrived with a
    // double space on one sample. A trim-only key kept both, and since
    // the chip comma-joins a category's values the curator read the same
    // text twice inside one chip.
    const bms = [
      bm("s1", {
        "cell type": "Cortical NSC/neurons at day 33 of neuronal  differentiation",
      }),
      bm("s2", {
        "cell type": "Cortical NSC/neurons at day 33 of neuronal differentiation",
      }),
    ];
    const synth = augmentInferredFromBiomaterials([], bms).find((t) => t.inferred);
    // First-seen spelling wins — a submitter's spacing is never rewritten.
    expect(synth?.value.label).toBe(
      "Cortical NSC/neurons at day 33 of neuronal  differentiation",
    );
  });

  it("still separates values that genuinely differ", () => {
    const bms = [
      bm("s1", { "cell type": "induced pluripotent stem cell line cell" }),
      bm("s2", { "cell type": "Cortical neurons at day 41 of neuronal differentiation" }),
    ];
    const synth = augmentInferredFromBiomaterials([], bms).find((t) => t.inferred);
    expect(synth?.value.label.split(", ")).toHaveLength(2);
  });

  it("treats leading/trailing and case drift as the same value", () => {
    const bms = [
      bm("s1", { treatment: "Tamoxifen" }),
      bm("s2", { treatment: "  tamoxifen  " }),
    ];
    const synth = augmentInferredFromBiomaterials([], bms).find((t) => t.inferred);
    expect(synth?.value.label).toBe("Tamoxifen");
  });

  it("a direct tag covers a per-sample value that differs only by spacing", () => {
    // Otherwise the direct chip and an inherited chip would render the
    // same words side by side, with no redundancy glint linking them.
    const direct = directTag(1, "treatment", "high dose tamoxifen");
    const bms = [bm("s1", { treatment: "high  dose   tamoxifen" })];
    const next = augmentInferredFromBiomaterials([direct], bms);
    expect(next.filter((t) => t.inferred)).toHaveLength(0);
  });
});
