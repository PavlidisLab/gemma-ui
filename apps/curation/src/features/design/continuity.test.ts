import { describe, expect, it } from "vitest";
import { diffDesign } from "./diff";
import {
  addFactor,
  addPublication,
  deleteFactor,
  deleteFactorValue,
  deletePublication,
  setBiomaterialCharacteristic,
  setBiomaterialName,
  setDesignDescription,
  setDesignShortName,
  setDesignTitle,
  setFactorFields,
  setFvLabel,
  toggleBaseline,
  addFactorValue,
} from "./mutations";
import type {
  Biomaterial,
  Design,
  Factor,
  FactorValue,
  Publication,
} from "@/features/experiment/types";

/**
 * Continuity-contract tests: every mutator that can change a piece of
 * the Design must mark the resulting draft as dirty against the
 * pre-mutation saved state.
 *
 * The 2026-06-13 continuity sweep surfaced eight mutators whose edits
 * passed through ``apply()`` but never flipped ``isDirty`` because the
 * diff only compared factors + tags. This file pins the post-fix
 * contract: every mutator -> diffDesign(saved, draft).isDirty === true.
 *
 * If a future regression silently drops a mutator from the diff or
 * mis-keys the LS persist effect, one of these tests fails loud
 * BEFORE the curator's edits are silently lost.
 */

const mkFv = (overrides: Partial<FactorValue> = {}): FactorValue =>
  ({
    id: 100,
    free_text_label: "control",
    is_baseline: false,
    biomaterial_short_names: ["S1"],
    statements: [],
    ...overrides,
  }) as FactorValue;

const mkFactor = (overrides: Partial<Factor> = {}): Factor =>
  ({
    id: 1,
    name: "treatment",
    category: { label: "treatment", uri: null },
    description: "",
    type: "categorical",
    factor_values: [mkFv()],
    ...overrides,
  }) as Factor;

const mkBm = (overrides: Partial<Biomaterial> = {}): Biomaterial => ({
  short_name: "S1",
  name: "Sample 1",
  characteristics: { tissue: "kidney" },
  ...overrides,
});

const mkDesign = (overrides: Partial<Design> = {}): Design =>
  ({
    experiment_id: 1,
    experiment_short_name: "GSE-test",
    factors: [mkFactor()],
    biomaterials: [mkBm()],
    tags: [],
    title: "Initial title",
    description: "Initial description",
    publications: [],
    ...overrides,
  }) as Design;

describe("continuity: every mutator dirties the draft", () => {
  describe("Factors", () => {
    it("addFactor flips isDirty", () => {
      const saved = mkDesign();
      const { design: draft } = addFactor(saved);
      expect(diffDesign(saved, draft).isDirty).toBe(true);
      expect(diffDesign(saved, draft).factorsAdded.length).toBe(1);
    });

    it("deleteFactor flips isDirty + populates factorsRemoved", () => {
      const saved = mkDesign();
      const draft = deleteFactor(saved, saved.factors[0].id);
      const r = diffDesign(saved, draft);
      expect(r.isDirty).toBe(true);
      expect(r.factorsRemoved.length).toBe(1);
      expect(r.factorsRemoved[0].id).toBe(saved.factors[0].id);
    });

    it("setFactorFields flips isDirty when name changes", () => {
      const saved = mkDesign();
      const draft = setFactorFields(saved, saved.factors[0].id, {
        name: "renamed",
      });
      const r = diffDesign(saved, draft);
      expect(r.isDirty).toBe(true);
      expect(r.totals.factorFieldsChanged).toBeGreaterThan(0);
    });

    it("setFactorFields no-op (same field value) does NOT flip isDirty", () => {
      const saved = mkDesign();
      const draft = setFactorFields(saved, saved.factors[0].id, {
        name: saved.factors[0].name,
      });
      expect(diffDesign(saved, draft).isDirty).toBe(false);
    });
  });

  describe("Factor values", () => {
    it("addFactorValue flips isDirty + adds to totals.addedFvs", () => {
      const saved = mkDesign();
      const draft = addFactorValue(saved, saved.factors[0].id);
      const r = diffDesign(saved, draft);
      expect(r.isDirty).toBe(true);
      expect(r.totals.addedFvs).toBeGreaterThan(0);
    });

    it("deleteFactorValue flips isDirty + removes from totals", () => {
      const saved = mkDesign({
        factors: [
          mkFactor({
            factor_values: [
              mkFv({ id: 100 }),
              mkFv({ id: 101, free_text_label: "treated" }),
            ],
          }),
        ],
      });
      const draft = deleteFactorValue(saved, saved.factors[0].id, 101);
      const r = diffDesign(saved, draft);
      expect(r.isDirty).toBe(true);
      expect(r.totals.removedFvs).toBeGreaterThan(0);
    });

    it("setFvLabel flips isDirty when label changes", () => {
      const saved = mkDesign();
      const draft = setFvLabel(
        saved,
        saved.factors[0].id,
        saved.factors[0].factor_values[0].id,
        "renamed",
      );
      const r = diffDesign(saved, draft);
      expect(r.isDirty).toBe(true);
      expect(r.totals.modifiedFvs).toBeGreaterThan(0);
    });

    it("setFvLabel to same value does NOT flip isDirty", () => {
      const saved = mkDesign();
      const draft = setFvLabel(
        saved,
        saved.factors[0].id,
        saved.factors[0].factor_values[0].id,
        saved.factors[0].factor_values[0].free_text_label,
      );
      expect(diffDesign(saved, draft).isDirty).toBe(false);
    });

    it("toggleBaseline flips isDirty + counts as modified", () => {
      const saved = mkDesign();
      const draft = toggleBaseline(
        saved,
        saved.factors[0].id,
        saved.factors[0].factor_values[0].id,
      );
      const r = diffDesign(saved, draft);
      expect(r.isDirty).toBe(true);
      expect(r.totals.modifiedFvs).toBeGreaterThan(0);
    });
  });

  describe("Biomaterials (the sweep blind spot)", () => {
    it("setBiomaterialName flips isDirty", () => {
      const saved = mkDesign();
      const draft = setBiomaterialName(saved, "S1", "Sample 1 renamed");
      const r = diffDesign(saved, draft);
      expect(r.isDirty).toBe(true);
      expect(r.metadata.biomaterialsModified).toBe(1);
    });

    it("setBiomaterialCharacteristic flips isDirty on key add", () => {
      const saved = mkDesign();
      const draft = setBiomaterialCharacteristic(saved, "S1", "age", "21");
      const r = diffDesign(saved, draft);
      expect(r.isDirty).toBe(true);
      expect(r.metadata.biomaterialsModified).toBe(1);
    });

    it("setBiomaterialCharacteristic flips isDirty on value change", () => {
      const saved = mkDesign();
      const draft = setBiomaterialCharacteristic(saved, "S1", "tissue", "liver");
      const r = diffDesign(saved, draft);
      expect(r.isDirty).toBe(true);
      expect(r.metadata.biomaterialsModified).toBe(1);
    });

    it("setBiomaterialName to same value does NOT flip isDirty", () => {
      const saved = mkDesign();
      const draft = setBiomaterialName(saved, "S1", "Sample 1");
      expect(diffDesign(saved, draft).isDirty).toBe(false);
    });

    it("setBiomaterialName on a missing short_name is a no-op", () => {
      const saved = mkDesign();
      const draft = setBiomaterialName(saved, "S-missing", "Whatever");
      expect(diffDesign(saved, draft).isDirty).toBe(false);
    });

    it("each modified biomaterial counts independently", () => {
      const saved = mkDesign({
        biomaterials: [
          mkBm({ short_name: "S1", name: "A" }),
          mkBm({ short_name: "S2", name: "B" }),
        ],
      });
      let draft = setBiomaterialName(saved, "S1", "A renamed");
      draft = setBiomaterialName(draft, "S2", "B renamed");
      const r = diffDesign(saved, draft);
      expect(r.metadata.biomaterialsModified).toBe(2);
    });
  });

  describe("Publications (the sweep blind spot)", () => {
    const pub: Publication = {
      pubmed_id: "12345",
      doi: "10.0000/x",
      citation: "c",
      title: "t",
    };

    it("addPublication flips isDirty + publicationsAdded", () => {
      const saved = mkDesign({ publications: [] });
      const draft = addPublication(saved, pub);
      const r = diffDesign(saved, draft);
      expect(r.isDirty).toBe(true);
      expect(r.metadata.publicationsAdded).toBe(1);
    });

    it("deletePublication flips isDirty + publicationsRemoved", () => {
      const saved = mkDesign({ publications: [pub] });
      const draft = deletePublication(saved, pub.pubmed_id, pub.doi);
      const r = diffDesign(saved, draft);
      expect(r.isDirty).toBe(true);
      expect(r.metadata.publicationsRemoved).toBe(1);
    });

    it("add then immediately delete: no net change, isDirty=false", () => {
      const saved = mkDesign({ publications: [] });
      const added = addPublication(saved, pub);
      const removed = deletePublication(added, pub.pubmed_id, pub.doi);
      const r = diffDesign(saved, removed);
      expect(r.isDirty).toBe(false);
    });

    it("addPublication is idempotent (de-dup keyed on pubmed_id)", () => {
      const saved = mkDesign({ publications: [pub] });
      const draft = addPublication(saved, pub);
      const r = diffDesign(saved, draft);
      expect(r.metadata.publicationsAdded).toBe(0);
    });
  });

  describe("Scalar metadata (the sweep blind spot)", () => {
    it("setDesignTitle flips isDirty + titleChanged", () => {
      const saved = mkDesign();
      const draft = setDesignTitle(saved, "New title");
      const r = diffDesign(saved, draft);
      expect(r.isDirty).toBe(true);
      expect(r.metadata.titleChanged).toBe(true);
    });

    it("setDesignDescription flips isDirty + descriptionChanged", () => {
      const saved = mkDesign();
      const draft = setDesignDescription(saved, "New description");
      const r = diffDesign(saved, draft);
      expect(r.isDirty).toBe(true);
      expect(r.metadata.descriptionChanged).toBe(true);
    });

    it("setDesignShortName flips isDirty + shortNameChanged", () => {
      const saved = mkDesign();
      const draft = setDesignShortName(saved, "GSE-renamed");
      const r = diffDesign(saved, draft);
      expect(r.isDirty).toBe(true);
      expect(r.metadata.shortNameChanged).toBe(true);
    });

    it("setting a scalar to the same value does NOT flip isDirty", () => {
      const saved = mkDesign({ title: "T" });
      const draft = setDesignTitle(saved, "T");
      expect(diffDesign(saved, draft).isDirty).toBe(false);
    });

    it("trims aren't auto-normalised — explicit whitespace counts as a change", () => {
      // This pins the current behavior: a curator who adds a trailing
      // space gets dirty=true. If we want to normalise on commit, that
      // becomes a separate fix; this test documents the current
      // semantics so any change is intentional.
      const saved = mkDesign({ title: "T" });
      const draft = setDesignTitle(saved, "T ");
      expect(diffDesign(saved, draft).isDirty).toBe(true);
    });
  });

  describe("Combined mutations — isDirty stays true through compounds", () => {
    it("title + biomaterial + publication all dirty together", () => {
      const saved = mkDesign({ publications: [] });
      let draft = setDesignTitle(saved, "T2");
      draft = setBiomaterialName(draft, "S1", "S1 renamed");
      draft = addPublication(draft, {
        pubmed_id: "1",
        doi: "",
        citation: "",
        title: "",
      });
      const r = diffDesign(saved, draft);
      expect(r.isDirty).toBe(true);
      expect(r.metadata.titleChanged).toBe(true);
      expect(r.metadata.biomaterialsModified).toBe(1);
      expect(r.metadata.publicationsAdded).toBe(1);
    });

    it("revert all compound mutations back to identity: isDirty=false", () => {
      const saved = mkDesign({ publications: [] });
      let draft = setDesignTitle(saved, "T2");
      draft = setBiomaterialName(draft, "S1", "S1 renamed");
      // Revert
      draft = setDesignTitle(draft, saved.title!);
      draft = setBiomaterialName(draft, "S1", "Sample 1");
      expect(diffDesign(saved, draft).isDirty).toBe(false);
    });
  });
});
