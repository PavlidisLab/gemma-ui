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

  it("skips synth for categories claimed by a direct tag", () => {
    // Curator has attached `cell type: T cell` directly. Even
    // though biomaterials carry three cell types, the synth must
    // NOT fire for this category — the curator's explicit choice
    // is the source of truth here.
    const directCellType = directTag(1, "cell type", "T cell");
    const tags: Tag[] = [directCellType];
    const bms = [
      bm("s1", { "cell type": "T cell" }),
      bm("s2", { "cell type": "B cell" }),
      bm("s3", { "cell type": "NK cell" }),
    ];
    const next = augmentInferredFromBiomaterials(tags, bms);
    // Direct tag survives.
    expect(next).toContainEqual(directCellType);
    // No synth for cell type.
    const synth = next.find(
      (t) => t.inferred && t.category.label === "cell type",
    );
    expect(synth).toBeUndefined();
  });

  it("when a category has both a direct tag and an existing inferred tag, the inferred tag is preserved (synth is skipped)", () => {
    // Edge case: legacy data might have an API-feed inferred tag
    // alongside a curator's direct tag for the same category. Skip
    // the synth (direct claims the category), and don't touch the
    // existing inferred tag either — let both pass through.
    const direct = directTag(1, "cell type", "T cell");
    const legacyInferred = inferredTag(2, "cell type", "B cell");
    const tags: Tag[] = [direct, legacyInferred];
    const bms = [
      bm("s1", { "cell type": "T cell" }),
      bm("s2", { "cell type": "B cell" }),
    ];
    const next = augmentInferredFromBiomaterials(tags, bms);
    expect(next).toContainEqual(direct);
    expect(next).toContainEqual(legacyInferred);
    // No synth.
    expect(next.filter((t) => t.id < 0)).toEqual([]);
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

  it("treats category match case-insensitively when checking for direct claim", () => {
    const direct = directTag(1, "Cell Type", "T cell");
    const bms = [
      bm("s1", { "cell type": "T cell" }),
      bm("s2", { "cell type": "B cell" }),
    ];
    const next = augmentInferredFromBiomaterials([direct], bms);
    // Direct claim covers the lowercased version too.
    const synth = next.find(
      (t) => t.inferred && (t.category.label || "").toLowerCase() === "cell type",
    );
    expect(synth).toBeUndefined();
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

  // B3 (UIB_HANDOFF_2026_06_25): removing a direct tag must NOT make
  // the biomaterial-derived synth chip reappear for that category.
  it("does not re-synthesize a chip for a category the curator removed", () => {
    // GSE161828: curator removes the direct ``cell type: fibroblast``
    // tag, but the biomaterials still carry ``cell type`` — without the
    // guard, a synth chip duplicates the just-removed annotation.
    const bms = [
      bm("s1", { "cell type": "fibroblast" }),
      bm("s2", { "cell type": "fibroblast" }),
    ];
    const removed = new Set(["cell type"]);
    const next = augmentInferredFromBiomaterials([], bms, removed);
    expect(
      next.find(
        (t) => (t.category.label || "").toLowerCase() === "cell type",
      ),
    ).toBeUndefined();
  });

  it("matches the removed-category guard case-insensitively", () => {
    const bms = [bm("s1", { "Cell Type": "fibroblast" })];
    const next = augmentInferredFromBiomaterials([], bms, new Set(["cell type"]));
    expect(next).toHaveLength(0);
  });

  it("still synthesizes chips for categories that were NOT removed", () => {
    const bms = [
      bm("s1", { "cell type": "fibroblast", "organism part": "skin" }),
    ];
    const next = augmentInferredFromBiomaterials([], bms, new Set(["cell type"]));
    // organism part survives; cell type is suppressed.
    expect(next.map((t) => (t.category.label || "").toLowerCase())).toEqual([
      "organism part",
    ]);
  });
});
