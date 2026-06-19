import { describe, expect, it } from "vitest";
import { diffDesign } from "./diff";
import type {
  Biomaterial,
  Design,
  Publication,
} from "@/features/experiment/types";

/**
 * Regression tests for the diff blind spot identified in the
 * 2026-06-13 continuity sweep.
 *
 * Before the fix, ``diffDesign`` only compared ``factors`` and
 * ``tags``. Curator edits to title / description / short_name /
 * biomaterials / publications all left ``isDirty=false``, which:
 *
 *   - hid the CommitBar (so the curator couldn't commit),
 *   - cleared the localStorage draft cache (so a refresh nuked
 *     the edits),
 *   - allowed background ``/design`` refetch to silently
 *     overwrite the curator's work.
 *
 * Every test here pins one slice of the new diff contract. They
 * fail loud on regression.
 */

const baseBm = (overrides: Partial<Biomaterial> = {}): Biomaterial => ({
  short_name: "S1",
  name: "Sample 1",
  characteristics: { tissue: "kidney" },
  ...overrides,
});

const baseDesign = (overrides: Partial<Design> = {}): Design => ({
  experiment_id: 1,
  experiment_short_name: "GSE-test",
  factors: [],
  biomaterials: [baseBm()],
  tags: [],
  title: "title A",
  description: "desc A",
  publications: [],
  ...overrides,
});

describe("diffDesign — metadata diff (continuity sweep 2026-06-13)", () => {
  it("isDirty=false when nothing changed", () => {
    const d = baseDesign();
    const r = diffDesign(d, d);
    expect(r.isDirty).toBe(false);
    expect(r.metadata.shortNameChanged).toBe(false);
    expect(r.metadata.titleChanged).toBe(false);
    expect(r.metadata.descriptionChanged).toBe(false);
    expect(r.metadata.biomaterialsModified).toBe(0);
    expect(r.metadata.publicationsAdded).toBe(0);
    expect(r.metadata.publicationsRemoved).toBe(0);
  });

  it("flips isDirty when the experiment short_name changes", () => {
    const saved = baseDesign();
    const draft = baseDesign({ experiment_short_name: "GSE-test renamed" });
    const r = diffDesign(saved, draft);
    expect(r.isDirty).toBe(true);
    expect(r.metadata.shortNameChanged).toBe(true);
  });

  it("flips isDirty when the title changes", () => {
    const saved = baseDesign();
    const draft = baseDesign({ title: "title B" });
    const r = diffDesign(saved, draft);
    expect(r.isDirty).toBe(true);
    expect(r.metadata.titleChanged).toBe(true);
  });

  it("flips isDirty when the description changes", () => {
    const saved = baseDesign();
    const draft = baseDesign({ description: "desc B" });
    const r = diffDesign(saved, draft);
    expect(r.isDirty).toBe(true);
    expect(r.metadata.descriptionChanged).toBe(true);
  });

  it("treats missing vs empty title as equivalent (no false positive)", () => {
    const saved = baseDesign({ title: undefined });
    const draft = baseDesign({ title: "" });
    const r = diffDesign(saved, draft);
    expect(r.metadata.titleChanged).toBe(false);
  });

  it("counts a biomaterial name change", () => {
    const saved = baseDesign({ biomaterials: [baseBm({ name: "Sample 1" })] });
    const draft = baseDesign({ biomaterials: [baseBm({ name: "Sample 1-renamed" })] });
    const r = diffDesign(saved, draft);
    expect(r.isDirty).toBe(true);
    expect(r.metadata.biomaterialsModified).toBe(1);
  });

  it("counts a characteristic value change", () => {
    const saved = baseDesign({
      biomaterials: [baseBm({ characteristics: { tissue: "kidney" } })],
    });
    const draft = baseDesign({
      biomaterials: [baseBm({ characteristics: { tissue: "liver" } })],
    });
    const r = diffDesign(saved, draft);
    expect(r.isDirty).toBe(true);
    expect(r.metadata.biomaterialsModified).toBe(1);
  });

  it("counts a characteristic key addition", () => {
    const saved = baseDesign({
      biomaterials: [baseBm({ characteristics: { tissue: "kidney" } })],
    });
    const draft = baseDesign({
      biomaterials: [
        baseBm({ characteristics: { tissue: "kidney", age: "12 weeks" } }),
      ],
    });
    const r = diffDesign(saved, draft);
    expect(r.metadata.biomaterialsModified).toBe(1);
  });

  it("counts a characteristic_uris value change", () => {
    const saved = baseDesign({
      biomaterials: [
        baseBm({
          characteristic_uris: { tissue: { value_uri: "UBERON:001" } },
        }),
      ],
    });
    const draft = baseDesign({
      biomaterials: [
        baseBm({
          characteristic_uris: { tissue: { value_uri: "UBERON:002" } },
        }),
      ],
    });
    const r = diffDesign(saved, draft);
    expect(r.metadata.biomaterialsModified).toBe(1);
  });

  it("ignores property-order in characteristics (no false positive)", () => {
    const saved = baseDesign({
      biomaterials: [
        baseBm({ characteristics: { a: "1", b: "2" } }),
      ],
    });
    const draft = baseDesign({
      biomaterials: [
        baseBm({ characteristics: { b: "2", a: "1" } }),
      ],
    });
    const r = diffDesign(saved, draft);
    expect(r.metadata.biomaterialsModified).toBe(0);
  });

  it("counts each modified biomaterial independently", () => {
    const saved = baseDesign({
      biomaterials: [
        baseBm({ short_name: "S1", name: "A" }),
        baseBm({ short_name: "S2", name: "B" }),
        baseBm({ short_name: "S3", name: "C" }),
      ],
    });
    const draft = baseDesign({
      biomaterials: [
        baseBm({ short_name: "S1", name: "A renamed" }),
        baseBm({ short_name: "S2", name: "B" }),
        baseBm({ short_name: "S3", name: "C renamed" }),
      ],
    });
    const r = diffDesign(saved, draft);
    expect(r.metadata.biomaterialsModified).toBe(2);
  });

  it("counts publication adds", () => {
    const pub: Publication = {
      pubmed_id: "12345",
      doi: "10.0000/x",
      citation: "c",
      title: "t",
    };
    const saved = baseDesign({ publications: [] });
    const draft = baseDesign({ publications: [pub] });
    const r = diffDesign(saved, draft);
    expect(r.isDirty).toBe(true);
    expect(r.metadata.publicationsAdded).toBe(1);
    expect(r.metadata.publicationsRemoved).toBe(0);
  });

  it("counts publication removes", () => {
    const pub: Publication = {
      pubmed_id: "12345",
      doi: "",
      citation: "",
      title: "t",
    };
    const saved = baseDesign({ publications: [pub] });
    const draft = baseDesign({ publications: [] });
    const r = diffDesign(saved, draft);
    expect(r.metadata.publicationsRemoved).toBe(1);
  });

  it("matches publications by pubmed_id (no false add+remove)", () => {
    const a: Publication = {
      pubmed_id: "12345",
      doi: "10.0000/old",
      citation: "c old",
      title: "t",
    };
    const b: Publication = {
      pubmed_id: "12345",
      doi: "10.0000/new",
      citation: "c new",
      title: "t",
    };
    const saved = baseDesign({ publications: [a] });
    const draft = baseDesign({ publications: [b] });
    const r = diffDesign(saved, draft);
    expect(r.metadata.publicationsAdded).toBe(0);
    expect(r.metadata.publicationsRemoved).toBe(0);
  });

  it("matches publications by doi when pubmed_id is empty", () => {
    const a: Publication = {
      pubmed_id: "",
      doi: "10.0000/x",
      citation: "c old",
      title: "t",
    };
    const b: Publication = {
      pubmed_id: "",
      doi: "10.0000/x",
      citation: "c new",
      title: "t",
    };
    const saved = baseDesign({ publications: [a] });
    const draft = baseDesign({ publications: [b] });
    const r = diffDesign(saved, draft);
    expect(r.metadata.publicationsAdded).toBe(0);
    expect(r.metadata.publicationsRemoved).toBe(0);
  });
});

describe("diffDesign — existing factor / tag invariants still hold", () => {
  it("returns the EMPTY_DIFF shape when either side is null", () => {
    const r = diffDesign(null, baseDesign());
    expect(r.isDirty).toBe(false);
    expect(r.metadata).toBeDefined();
    expect(r.metadata.biomaterialsModified).toBe(0);
  });
});
