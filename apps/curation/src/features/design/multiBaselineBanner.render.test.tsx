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

function designWith(
  fvs: FactorValue[],
  category = "treatment",
  uri: string | null = "http://www.ebi.ac.uk/efo/EFO_0000727",
): Design {
  return {
    experiment_id: 1,
    experiment_short_name: "GSE0",
    factors: [
      {
        id: 1,
        name: category,
        category: { label: category, uri },
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
    expect(
      screen.getByText(/needs a subset before DEA can run/),
    ).toBeTruthy();
    expect(
      screen.getByText(/refuses a\s+multiple-baseline contrast/),
    ).toBeTruthy();
  });

  // Paul: two baselines "strongly supports that the curator needs to
  // select a 'subset by' factor". Naming the consequence isn't enough —
  // the note has to name the control, which already exists as the
  // SubsetRecommendationsBlock in "Experiment-wide decisions".
  it("points at the control that fixes it", () => {
    renderFor(TWO);
    expect(screen.getByText(/choose a .subset by. factor/i)).toBeTruthy();
    expect(screen.getByText(/Experiment-wide decisions/)).toBeTruthy();
  });

  // ...and stops asking once they've done it. An accepted
  // SubsetRecommendation carrying a by_factor_id IS the choice; a note
  // that keeps demanding one after the fact is the nag this advisory
  // channel exists to avoid.
  it("acknowledges an accepted subset instead of demanding one", () => {
    const d = designWith([
      fv(1, "vehicle A", "s1", true),
      fv(2, "vehicle B", "s2", true),
    ]);
    d.factors.push({
      id: 2,
      name: "cell line",
      category: { label: "cell line", uri: null },
      description: "d",
      type: "categorical",
      factor_values: [],
    } as unknown as Design["factors"][number]);
    d.subset_recommendations = [
      {
        id: "curator:subset:2:1",
        by_factor_id: 2,
        level_labels: [],
        rationale: "",
        status: "accepted",
        source: "curator",
      },
    ];
    renderFor(d);
    expect(screen.getByText(/subset by cell line is recorded/)).toBeTruthy();
    expect(screen.queryByText(/No subset recorded yet/)).toBeNull();
  });

  // 🛑 The behaviour change, 2026-08-20. `agent_recommended` is the
  // arrival state of every seeded row and it does NOT mean "pending":
  // accept is the default. The note used to test `status ===
  // "accepted"` and so kept demanding a subset-by from curators who
  // already had a live Gemma one sitting in the design — on exactly
  // the 69 experiments most likely to hit multiple baselines.
  it("counts a Gemma recommendation nobody has touched — accept is the default", () => {
    const d = designWith([
      fv(1, "vehicle A", "s1", true),
      fv(2, "vehicle B", "s2", true),
    ]);
    d.factors.push({
      id: 2,
      name: "organism part",
      category: { label: "organism part", uri: null },
      description: "d",
      type: "categorical",
      factor_values: [],
    } as unknown as Design["factors"][number]);
    d.subset_recommendations = [
      {
        id: "gemma-subset-organism-part",
        by_factor_id: 2,
        level_labels: [],
        rationale: "Gemma already subsets the DEA on `organism part`.",
        status: "agent_recommended",
        source: "gemma",
      },
    ];
    renderFor(d);
    expect(screen.getByText(/subset by organism part is recorded/)).toBeTruthy();
    expect(screen.queryByText(/No subset recorded yet/)).toBeNull();
  });

  // Staleness is expected — polishing outruns Gemma's analysis — but a
  // recommendation whose factor is gone genuinely does not answer the
  // "which axis do I subset by" question, so it stops counting.
  it("ignores one whose factor has been curated away", () => {
    const d = designWith([
      fv(1, "vehicle A", "s1", true),
      fv(2, "vehicle B", "s2", true),
    ]);
    d.subset_recommendations = [
      {
        id: "gemma-subset-organism-part",
        by_factor_id: 42,
        level_labels: [],
        rationale: "",
        status: "agent_recommended",
        source: "gemma",
      },
    ];
    renderFor(d);
    expect(screen.getByText(/No subset recorded yet/)).toBeTruthy();
  });

  it("ignores a subset the curator rejected — that is not a choice", () => {
    const d = designWith([
      fv(1, "vehicle A", "s1", true),
      fv(2, "vehicle B", "s2", true),
    ]);
    d.subset_recommendations = [
      {
        id: "agent:subset:9:1",
        by_factor_id: 9,
        level_labels: [],
        rationale: "",
        status: "rejected",
        source: "agent",
      },
    ];
    renderFor(d);
    expect(screen.getByText(/No subset recorded yet/)).toBeTruthy();
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

  // Paul, 2026-08-19: "just flag ANY >1-baseline factor to the curator."
  // ``block`` is in NO_BASELINE_CATEGORIES, so ``baseline_required`` is
  // false and the filter used to skip it — the one category where two
  // marks are most surprising was the one that stayed silent.
  it("flags a block factor too, which never REQUIRES a baseline", () => {
    const d = designWith(
      [
        fv(1, "lane 1", "s1", true),
        fv(2, "lane 2", "s2", true),
      ],
      "block",
      null,
    );
    expect(validateDesign(d).factors[0].baseline_required).toBe(false);
    renderFor(d);
    expect(screen.getByText("more than one baseline")).toBeTruthy();
  });

  // The advisory has to hang off BOTH banner branches. It was wired
  // into the valid one only, so a design with any unrelated warning
  // (here: an ungrounded category) dropped it exactly when the curator
  // had the most on screen to read.
  it("survives the warnings branch, not just the valid one", () => {
    const d = designWith(
      [fv(1, "vehicle A", "s1", true), fv(2, "vehicle B", "s2", true)],
      "treatment",
      null, // ungrounded -> the design has warnings
    );
    expect(validateDesign(d).ok).toBe(false);
    renderFor(d);
    expect(screen.getByText(/design has warnings/)).toBeTruthy();
    expect(screen.getByText("more than one baseline")).toBeTruthy();
  });

  it("still says nothing about a block factor with one mark", () => {
    renderFor(
      designWith([fv(1, "lane 1", "s1", true), fv(2, "lane 2", "s2")], "block", null),
    );
    expect(screen.queryByText("more than one baseline")).toBeNull();
  });
});
