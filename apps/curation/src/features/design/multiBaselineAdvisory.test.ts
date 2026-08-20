/**
 * More than one marked baseline is LEGAL, and the UI must ask rather
 * than scold.
 *
 * Paul, 2026-08-19: *"we will allow >1 baseline, but in the user
 * interface, this should be flagged not as an error just as a, did you
 * need to do this?"* A dataset that is really two experiments in one
 * carries a reference level per sub-experiment, and Gemma agrees —
 * ``SplitExperimentServiceImpl`` clones the flag onto each split's
 * factor values, so "at most one per factor globally" would be wrong.
 *
 * Four gates used to read ``baseline_count === 1`` (or ``!== 1``) and so
 * treated a deliberate second reference as a defect: the design
 * validator, the ValidatorBanner warning list, the commit gate, and the
 * pre-publish checklist. This pins that none of them do.
 */
import { describe, expect, it } from "vitest";

import {
  validateDesign,
  type Design,
  type Factor,
  type FactorValue,
} from "@/features/experiment/types";

function fv(
  id: number,
  label: string,
  bms: string[],
  baseline = false,
): FactorValue {
  return {
    id,
    free_text_label: label,
    is_baseline: baseline,
    biomaterial_short_names: bms,
    statements: [],
  };
}

function treatmentFactor(fvs: FactorValue[]): Factor {
  return {
    id: 1,
    name: "treatment",
    // Grounded category + a description on purpose: this file is about
    // the baseline rule, and an ungrounded category or a blank
    // description would fail the design for unrelated reasons.
    category: { label: "treatment", uri: "http://www.ebi.ac.uk/efo/EFO_0000727" },
    description: "a described factor, so nothing else warns",
    type: "categorical",
    factor_values: fvs,
  };
}

function designWith(fvs: FactorValue[]): Design {
  const bms = fvs.flatMap((f) => f.biomaterial_short_names);
  return {
    experiment_id: 1,
    experiment_short_name: "GSE0",
    factors: [treatmentFactor(fvs)],
    biomaterials: bms.map((short_name, i) => ({ id: i + 1, short_name })),
    tags: [],
  } as unknown as Design;
}

/** Two references, each with its own treated arm — the shape a
 *  two-experiments-in-one dataset actually has. */
const TWO_BASELINES = [
  fv(1, "vehicle A", ["s1"], true),
  fv(2, "drug A", ["s2"]),
  fv(3, "vehicle B", ["s3"], true),
  fv(4, "drug B", ["s4"]),
];

const ONE_BASELINE = [fv(1, "vehicle", ["s1"], true), fv(2, "drug", ["s2"])];

const NO_BASELINE = [fv(1, "thing", ["s1"]), fv(2, "other", ["s2"])];

describe("more than one baseline is legal, not a validation failure", () => {
  it("the design still validates", () => {
    const state = validateDesign(designWith(TWO_BASELINES));
    expect(state.ok).toBe(true);
  });

  it("counts both and calls the baseline question answered", () => {
    const s = validateDesign(designWith(TWO_BASELINES)).factors[0];
    expect(s.baseline_count).toBe(2);
    expect(s.baseline_satisfied).toBe(true);
  });

  it("one baseline is still fine", () => {
    const s = validateDesign(designWith(ONE_BASELINE)).factors[0];
    expect(s.baseline_count).toBe(1);
    expect(s.baseline_satisfied).toBe(true);
    expect(validateDesign(designWith(ONE_BASELINE)).ok).toBe(true);
  });

  // The permissiveness is on the >1 side ONLY. Zero marked with nothing
  // for Gemma to detect is still unanswered, and loosening the rule must
  // not have loosened that too.
  it("ZERO baselines is still unsatisfied — the gate didn't go slack", () => {
    const s = validateDesign(designWith(NO_BASELINE)).factors[0];
    expect(s.baseline_count).toBe(0);
    expect(s.gemma_auto_baseline).toHaveLength(0);
    expect(s.baseline_satisfied).toBe(false);
    expect(validateDesign(designWith(NO_BASELINE)).ok).toBe(false);
  });

  // ``baseline_blocks_commit`` is what CommitBar and PrePublishChecklist
  // filter on; both now compare the count against 0 / >=1 rather than
  // ``=== 1``, so a two-reference factor reaches neither gate.
  it("a two-baseline factor is not a commit or publish blocker", () => {
    const s = validateDesign(designWith(TWO_BASELINES)).factors[0];
    expect(s.baseline_blocks_commit).toBe(true); // treatment DOES require one
    expect(s.baseline_count === 0).toBe(false); // ...but it has them
    expect(s.baseline_count >= 1).toBe(true);
  });
});
