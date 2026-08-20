/**
 * @vitest-environment jsdom
 *
 * The >1-baseline signal renders in the SLATE advisory channel, never
 * the amber warnings list — Paul, 2026-08-19: *"flagged not as an error
 * just as a, did you need to do this?"*
 *
 * The advisory channel matters for a second reason: the amber list only
 * renders on the ``!ok`` path, and a two-baseline design is now valid.
 * Routed through ``warningsFor`` the note would be invisible exactly
 * when it applies.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  validateDesign,
  type Design,
  type FactorValue,
} from "@/features/experiment/types";
import { ValidatorBanner } from "./ValidatorBanner";

function fv(id: number, label: string, bm: string, baseline = false): FactorValue {
  return {
    id,
    free_text_label: label,
    is_baseline: baseline,
    biomaterial_short_names: [bm],
    statements: [],
  };
}

function designWith(fvs: FactorValue[]): Design {
  return {
    experiment_id: 1,
    experiment_short_name: "GSE0",
    factors: [
      {
        id: 1,
        name: "treatment",
        category: { label: "treatment", uri: "http://www.ebi.ac.uk/efo/EFO_0000727" },
        description: "described",
        type: "categorical",
        factor_values: fvs,
      },
    ],
    biomaterials: fvs.map((f, i) => ({ id: i + 1, short_name: f.biomaterial_short_names[0] })),
    tags: [],
  } as unknown as Design;
}

const TWO = designWith([
  fv(1, "vehicle A", "s1", true),
  fv(2, "drug A", "s2"),
  fv(3, "vehicle B", "s3", true),
  fv(4, "drug B", "s4"),
]);

function renderFor(d: Design) {
  return render(<ValidatorBanner design={d} state={validateDesign(d)} />);
}

describe("ValidatorBanner — two baselines ask, they don't scold", () => {
  it("still reports the design as valid", () => {
    renderFor(TWO);
    expect(screen.getByText("✓ design valid")).toBeTruthy();
    expect(screen.queryByText(/design has warnings/)).toBeNull();
  });

  it("asks whether more than one was needed", () => {
    renderFor(TWO);
    expect(screen.getByText("more than one baseline")).toBeTruthy();
    expect(
      screen.getByText(/did you need more than\s+one\?/),
    ).toBeTruthy();
  });

  it("never calls it a should-be-1 error", () => {
    renderFor(TWO);
    expect(screen.queryByText(/should be 1/)).toBeNull();
    expect(screen.queryByText(/need 1/)).toBeNull();
    expect(screen.queryByText(/exactly 1 expected/)).toBeNull();
  });

  it("names the split case, so the curator can tell if it applies", () => {
    renderFor(TWO);
    expect(screen.getByText(/two experiments in one/)).toBeTruthy();
  });

  // Gemma's DEA throws MultipleBaselinesRequireSubsetException on a
  // multi-baseline factor with no subset factor. A question that omits
  // that is a dead end discovered at analysis time.
  it("names the DEA consequence, not just the question", () => {
    renderFor(TWO);
    expect(screen.getByText(/needs a\s+subset factor before DEA can run/)).toBeTruthy();
  });

  // The draft carries subset RECOMMENDATIONS, never whether a subset
  // factor is configured — so the note may state the requirement but
  // must not accuse the curator of having skipped it.
  it("states the requirement without claiming a subset is missing", () => {
    renderFor(TWO);
    expect(screen.queryByText(/no subset factor/i)).toBeNull();
    expect(screen.queryByText(/missing subset/i)).toBeNull();
  });

  it("counts the baselines rather than printing a hardcoded '1'", () => {
    renderFor(TWO);
    expect(screen.getByText(/2 baselines/)).toBeTruthy();
  });

  it("says so plainly when Gemma detects one and nothing is marked", () => {
    const d = designWith([fv(1, "control", "s1"), fv(2, "drug", "s2")]);
    renderFor(d);
    expect(screen.getByText(/baseline detected by Gemma/)).toBeTruthy();
  });

  it("a single marked baseline carries no advisory at all", () => {
    renderFor(designWith([fv(1, "vehicle", "s1", true), fv(2, "drug", "s2")]));
    expect(screen.queryByText("more than one baseline")).toBeNull();
  });
});
