/**
 * @vitest-environment jsdom
 *
 * "Factor value is not assigned to any samples" — Paul, 2026-08-20,
 * explicitly *"not a blocker"*.
 *
 * So it renders in the SLATE advisory channel, and the channel is the
 * whole point: the amber warnings list only renders on the ``!ok``
 * path, and a design carrying an empty level can be perfectly valid.
 * Routed through ``warningsFor`` this note would be invisible exactly
 * when it applies — every sample assigned, every category grounded, one
 * level holding nothing.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  validateDesign,
  type Design,
  type FactorValue,
} from "@/features/experiment/types";
import { ValidatorBanner } from "./ValidatorBanner";

function fv(id: number, label: string, bms: string[], baseline = false): FactorValue {
  return {
    id,
    free_text_label: label,
    is_baseline: baseline,
    biomaterial_short_names: bms,
    statements: [],
  };
}

/** Every sample lands on SOME level, so ``unassigned_biomaterials`` is
 *  clean — the empty level is invisible to that check. */
function designWith(fvs: FactorValue[]): Design {
  const names = [...new Set(fvs.flatMap((f) => f.biomaterial_short_names))];
  return {
    experiment_id: 1,
    experiment_short_name: "GSE0",
    factors: [
      {
        id: 1,
        name: "treatment",
        category: {
          label: "treatment",
          uri: "http://www.ebi.ac.uk/efo/EFO_0000727",
        },
        description: "described",
        type: "categorical",
        factor_values: fvs,
      },
    ],
    biomaterials: names.map((short_name, i) => ({ id: i + 1, short_name })),
    tags: [],
  } as unknown as Design;
}

const WITH_EMPTY = designWith([
  fv(1, "vehicle", ["s1"], true),
  fv(2, "valproic acid", ["s2"]),
  fv(3, "left over", []),
]);

const ALL_POPULATED = designWith([
  fv(1, "vehicle", ["s1"], true),
  fv(2, "valproic acid", ["s2"]),
]);

function renderFor(d: Design) {
  return render(<ValidatorBanner design={d} state={validateDesign(d)} />);
}

describe("ValidatorBanner — a level with no samples", () => {
  it("still reports the design as valid", () => {
    renderFor(WITH_EMPTY);
    expect(screen.getByText("✓ design valid")).toBeTruthy();
    expect(screen.queryByText(/design has warnings/)).toBeNull();
  });

  it("surfaces the note anyway — the advisory channel survives ok", () => {
    renderFor(WITH_EMPTY);
    expect(screen.getByText("factor value with no samples")).toBeTruthy();
    expect(
      screen.getByText(/1 value is not assigned to any samples/),
    ).toBeTruthy();
  });

  it("names the level, so the curator knows which one", () => {
    renderFor(WITH_EMPTY);
    expect(screen.getByText(/"left over"/)).toBeTruthy();
  });

  it("names the consequence rather than just the fact", () => {
    // The cost is downstream and silent: Gemma has nothing to contrast
    // at that level, so it drops out of the analysis without saying so.
    renderFor(WITH_EMPTY);
    expect(screen.getByText(/won't appear in the analysis/)).toBeTruthy();
  });

  it("says nothing when every level holds samples", () => {
    renderFor(ALL_POPULATED);
    expect(screen.queryByText("factor value with no samples")).toBeNull();
  });
});
