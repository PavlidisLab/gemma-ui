import { describe, expect, it } from "vitest";
import { fvDisplayLabel } from "./fvLabels";

const fv = (overrides: Partial<Parameters<typeof fvDisplayLabel>[0]>) =>
  ({
    id: 1,
    free_text_label: "level",
    ...overrides,
  }) as Parameters<typeof fvDisplayLabel>[0];

describe("fvDisplayLabel — visible text + tooltip", () => {
  it("renders just the label when unique", () => {
    const r = fvDisplayLabel(fv({ id: 1, free_text_label: "control" }), [
      fv({ id: 1, free_text_label: "control" }),
      fv({ id: 2, free_text_label: "treated" }),
    ]);
    expect(r.text).toBe("control");
    expect(r.title).toBe("");
  });

  it("puts the id in the tooltip on duplicate labels (not in text)", () => {
    const allFvs = [
      fv({ id: 269342, free_text_label: "age: 485" }),
      fv({ id: 269355, free_text_label: "age: 485" }),
    ];
    const r = fvDisplayLabel(allFvs[0], allFvs);
    expect(r.text).toBe("age: 485");
    expect(r.text).not.toContain("id ");
    expect(r.title).toBe("id 269342");
  });

  it("appends (n=K) when biomaterial_short_names is populated and not compact", () => {
    const r = fvDisplayLabel(
      fv({ id: 1, biomaterial_short_names: ["s1", "s2", "s3"] }),
      [fv({ id: 1, biomaterial_short_names: ["s1", "s2", "s3"] })],
    );
    expect(r.text).toBe("level (n=3)");
  });

  it("suppresses (n=K) when compact is set", () => {
    const r = fvDisplayLabel(
      fv({ id: 1, biomaterial_short_names: ["s1", "s2", "s3"] }),
      [fv({ id: 1, biomaterial_short_names: ["s1", "s2", "s3"] })],
      { compact: true },
    );
    expect(r.text).toBe("level");
  });

  it("prefixes empty-FV warning when no samples are assigned", () => {
    const r = fvDisplayLabel(
      fv({ id: 1, biomaterial_short_names: [] }),
      [fv({ id: 1, biomaterial_short_names: [] })],
    );
    expect(r.text).toBe("⚠ no samples — level");
  });

  it("appends · baseline last", () => {
    const r = fvDisplayLabel(
      fv({
        id: 1,
        free_text_label: "control",
        is_baseline: true,
        biomaterial_short_names: ["s1"],
      }),
      [fv({ id: 1, biomaterial_short_names: ["s1"] })],
    );
    expect(r.text).toBe("control (n=1) · baseline");
  });

  it("falls back to 'FV {id}' on empty labels with no tooltip", () => {
    const r = fvDisplayLabel(fv({ id: 42, free_text_label: "" }), [
      fv({ id: 42, free_text_label: "" }),
      fv({ id: 43, free_text_label: "" }),
    ]);
    expect(r.text).toBe("FV 42");
    // Empty-label dupes don't need the id tooltip — `FV 42` already
    // unique-identifies via the visible id.
    expect(r.title).toBe("");
  });
});
