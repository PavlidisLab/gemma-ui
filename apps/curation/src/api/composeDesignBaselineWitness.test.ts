/**
 * `is_baseline_explicit` — the one field that answers "did GEMMA set
 * this flag", and the only witness the commit builder has.
 *
 * 🛑 `isBaseline` is TRI-STATE on Gemma's side: `null` means infer from
 * the terms, `false` means forced-not-baseline with inference off
 * permanently. `composeCurationDesign` collapses `?? false` on the way
 * in, so `is_baseline` alone cannot tell those apart and
 * `buildCurationDocument`'s `baselineFlag` reads this flag instead to
 * decide whether an `isBaseline: false` is a real un-setting.
 *
 * It was computed as `(ov.is_baseline ?? v.is_baseline) != null` — with
 * `ov` the curation store's PROPOSAL overlay, not Gemma. An overlay
 * entry carrying `is_baseline: false` for a value whose Gemma flag is
 * null made the witness true, and the commit then forced `false` over
 * that null: baseline inference off, and the direction of every
 * differential-expression contrast on that factor flipped.
 */
import { describe, expect, it } from "vitest";

import { composeCurationDesign } from "./composeDesign";

type G2 = Parameters<typeof composeCurationDesign>[0];
type Overlay = Parameters<typeof composeCurationDesign>[3];

/** One factor, one value, with whatever Gemma served for the flag. */
function served(is_baseline: boolean | null | undefined): G2 {
  return {
    experimental_factors: [
      {
        id: 23079,
        name: "treatment",
        type: "categorical",
        category: { category: "treatment", category_uri: "obo:EFO_0000727" },
        values: [
          {
            id: 64275,
            value: "vehicle",
            ...(is_baseline === undefined ? {} : { is_baseline }),
          },
        ],
      },
    ],
  } as unknown as G2;
}

const flagOf = (g2: G2, overlay?: Overlay) =>
  composeCurationDesign(g2, 1658, "GSE11630", overlay ?? null).factors[0]
    .factor_values[0];

describe("the explicit-baseline witness follows Gemma", () => {
  it("is true where Gemma served a flag", () => {
    expect(flagOf(served(true)).is_baseline_explicit).toBe(true);
    expect(flagOf(served(false)).is_baseline_explicit).toBe(true);
  });

  it("is false where Gemma served null — the value to infer from", () => {
    expect(flagOf(served(null)).is_baseline_explicit).toBe(false);
    expect(flagOf(served(undefined)).is_baseline_explicit).toBe(false);
  });

  it("🛑 a proposal overlay does NOT make the flag explicit", () => {
    // The overlay is the agent's proposal, not what Gemma stored.
    // Counted as a witness, a proposed `false` over a null flag turns
    // Gemma's baseline inference off on commit.
    const overlay = { factor_values: { 64275: { is_baseline: false } } };
    const fv = flagOf(served(null), overlay);
    expect(fv.is_baseline_explicit).toBe(false);
    // The overlay still wins on the collapsed boolean the editor reads.
    expect(fv.is_baseline).toBe(false);
  });

  it("🛑 nor does a proposal that marks the value AS baseline", () => {
    const overlay = { factor_values: { 64275: { is_baseline: true } } };
    const fv = flagOf(served(null), overlay);
    expect(fv.is_baseline_explicit).toBe(false);
    expect(fv.is_baseline).toBe(true);
  });
});
