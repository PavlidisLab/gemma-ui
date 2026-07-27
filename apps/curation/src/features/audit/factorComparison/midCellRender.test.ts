import { describe, expect, it } from "vitest";
import { midCellRender } from "./FactorComparisonGrid";
import type { FactorComparisonPair, GridFv } from "./FactorComparisonGrid";

/**
 * Regression tests locking the design review's exact spec for the middle-column
 * cell of ``FactorComparisonGrid`` (2026-06-15).
 *
 * The middle column communicates the SAMPLE-COUNT axis only. Label
 * drift is a different axis — it's surfaced by per-chip diff rings on
 * the side cells, NOT by recolouring the middle. Earlier iterations
 * collapsed both axes into ``≈ 12`` / ``= 12`` glyphs, which read as
 * "approximately 12 samples" — wrong (the count is exact). the design review's
 * fix: always render ``N ↔ M``; colour by count agreement; ignore
 * pair.status entirely.
 *
 * Spec:
 *   - Both sides populated, counts EQUAL → ``N ↔ N`` emerald,
 *     regardless of pair.status (same, drift, etc).
 *   - Both sides populated, counts DIFFER → ``N ↔ M`` amber.
 *   - One side populated → ``N →`` (right empty) or ``← N`` (left
 *     empty) in rose.
 *   - Both sides empty of sample data → ``null`` (caller falls back
 *     to its own glyph).
 */

function fv(opts: {
  count?: number;
  label?: string;
  uri?: string | null;
} = {}): GridFv {
  const count = opts.count ?? 0;
  return {
    free_text_label: opts.label ?? "",
    statements: [],
    biomaterial_short_names: Array.from({ length: count }, (_, i) => `s${i}`),
    is_baseline: false,
  } as unknown as GridFv;
}

function pair(
  left: GridFv | null,
  right: GridFv | null,
  status: FactorComparisonPair["status"] = "same",
): FactorComparisonPair {
  return { left, right, status };
}

describe("midCellRender — the design review's spec 2026-06-15", () => {
  describe("equal counts both sides → emerald `N ↔ N` regardless of label drift", () => {
    it.each([
      ["status=same",  "same"  as const],
      ["status=drift", "drift" as const],
    ])("renders `12 ↔ 12` emerald when both sides have 12 samples (%s)", (_, status) => {
      const out = midCellRender(pair(fv({ count: 12 }), fv({ count: 12 }), status));
      expect(out).not.toBeNull();
      expect(out!.text).toBe("12 ↔ 12");
      expect(out!.cls).toMatch(/emerald-600/);
      expect(out!.cls).toMatch(/dark:text-emerald-400/);
    });

    it("text never collapses to a single number — `↔` is always present when both sides have samples", () => {
      // Earlier bug: equal counts rendered as bare ``12`` (no
      // arrow), which made the "this is the SAMPLE COUNT axis"
      // framing invisible. The ↔ glyph is the load-bearing
      // signal that the middle is comparing per-side counts.
      const out = midCellRender(pair(fv({ count: 6 }), fv({ count: 6 })));
      expect(out!.text).toContain("↔");
    });

    it("does NOT use `≈` (approximation glyph) — count is exact, not approximate", () => {
      // Earlier bug: drift-status equal counts rendered as
      // `≈ 12`, conflating label-drift with count-approximation.
      const out = midCellRender(pair(fv({ count: 12 }), fv({ count: 12 }), "drift"));
      expect(out!.text).not.toContain("≈");
    });

    it("does NOT use `=` glyph — visual axis is `↔`", () => {
      const out = midCellRender(pair(fv({ count: 6 }), fv({ count: 6 })));
      expect(out!.text).not.toContain("=");
    });
  });

  describe("unequal counts both sides → amber `N ↔ M`", () => {
    it("renders `12 ↔ 15` amber when counts differ", () => {
      const out = midCellRender(pair(fv({ count: 12 }), fv({ count: 15 })));
      expect(out).not.toBeNull();
      expect(out!.text).toBe("12 ↔ 15");
      expect(out!.cls).toMatch(/amber-600/);
      expect(out!.cls).toMatch(/dark:text-amber-400/);
    });

    it("preserves left/right order in the text", () => {
      const out = midCellRender(pair(fv({ count: 3 }), fv({ count: 9 })));
      expect(out!.text).toBe("3 ↔ 9");
    });
  });

  describe("one-sided pairs → rose with direction arrow", () => {
    it("left-only: `N →` rose when right is null", () => {
      const out = midCellRender(pair(fv({ count: 8 }), null, "left_only"));
      expect(out).not.toBeNull();
      expect(out!.text).toBe("8 →");
      expect(out!.cls).toMatch(/rose-600/);
    });

    it("right-only: `← N` rose when left is null", () => {
      const out = midCellRender(pair(null, fv({ count: 4 }), "right_only"));
      expect(out).not.toBeNull();
      expect(out!.text).toBe("← 4");
      expect(out!.cls).toMatch(/rose-600/);
    });

    it("left present but its FV has 0 samples while right has N → treats as right-only", () => {
      const out = midCellRender(pair(fv({ count: 0 }), fv({ count: 5 })));
      expect(out!.text).toBe("← 5");
    });

    it("right present but its FV has 0 samples while left has N → treats as left-only", () => {
      const out = midCellRender(pair(fv({ count: 7 }), fv({ count: 0 })));
      expect(out!.text).toBe("7 →");
    });
  });

  describe("no sample data on either side → null (caller falls back)", () => {
    it("returns null when both sides have 0 samples", () => {
      expect(midCellRender(pair(fv({ count: 0 }), fv({ count: 0 })))).toBeNull();
    });

    it("returns null when both sides are entirely missing", () => {
      expect(midCellRender(pair(null, null, null))).toBeNull();
    });
  });

  describe("pair.status MUST NOT influence colour when both sides have counts", () => {
    // The status field carries label-level pairing semantics (same,
    // drift, left_only, right_only). The middle cell's colour is
    // strictly count-driven. Locked in because the earlier
    // implementation read status to pick `=` vs `≈` glyphs.
    it.each([
      ["same"        as const],
      ["drift"       as const],
      ["left_only"   as const],
      ["right_only"  as const],
      [null],
    ])("equal counts render emerald regardless of pair.status=%s", (status) => {
      const out = midCellRender(pair(fv({ count: 10 }), fv({ count: 10 }), status));
      expect(out!.cls).toMatch(/emerald-600/);
    });

    it.each([
      ["same"        as const],
      ["drift"       as const],
      ["left_only"   as const],
      ["right_only"  as const],
      [null],
    ])("differing counts render amber regardless of pair.status=%s", (status) => {
      const out = midCellRender(pair(fv({ count: 10 }), fv({ count: 11 }), status));
      expect(out!.cls).toMatch(/amber-600/);
    });
  });

  describe("tooltip text — surfaces the count, not the label-drift hint", () => {
    it("equal counts tooltip names the per-side count + 'partition agrees'", () => {
      const out = midCellRender(pair(fv({ count: 12 }), fv({ count: 12 })));
      expect(out!.title).toContain("12");
      expect(out!.title.toLowerCase()).toContain("partition agrees");
    });

    it("differing counts tooltip names BOTH side counts + 'partition disagrees'", () => {
      const out = midCellRender(pair(fv({ count: 6 }), fv({ count: 10 })));
      expect(out!.title).toContain("6");
      expect(out!.title).toContain("10");
      expect(out!.title.toLowerCase()).toContain("partition disagrees");
    });
  });
});
