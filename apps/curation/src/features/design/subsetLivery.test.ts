/**
 * The factor's subset livery — one mark from two sources.
 *
 * `Design.subset_recommendations` (agent-seeded or curator-written,
 * dispositioned accept/reject) and Gemma's own `Factor.subset_relevance`
 * both answer "should a DEA subset by this factor". They fold to one
 * chip rather than each growing their own, because two badges saying
 * the same thing in different words is how a curator stops trusting
 * either.
 *
 * 🛑 The case that carries the most weight is the one that renders
 * NOTHING. Only a factor somebody has ruled on carries a value, so
 * absence is the ordinary state and is not a negative — a chip reading
 * "not set" would turn silence into a claim.
 */
import { describe, expect, it } from "vitest";

import type { Design, Factor } from "@/features/experiment/types";
import { subsetLiveryFor } from "./subsetRecommendations";

const factor = (over: Partial<Factor> = {}): Factor =>
  ({
    id: 7,
    name: "treatment",
    category: { label: "treatment", uri: null },
    description: "",
    type: "categorical",
    gemma_factor_id: 25518,
    factor_values: [],
    ...over,
  }) as Factor;

const design = (f: Factor, recs: unknown[] = []): Design =>
  ({ factors: [f], subset_recommendations: recs }) as unknown as Design;

describe("subset livery — nothing claimed, nothing shown", () => {
  it("renders no chip on a factor nobody has ruled on", () => {
    const f = factor();
    expect(subsetLiveryFor(f, design(f))).toBeNull();
  });

  it("treats an empty string as cleared, not as a value", () => {
    // Empty string is Gemma's explicit clear; it must not become a chip
    // reading `subset: `.
    const f = factor({ subset_relevance: "" });
    expect(subsetLiveryFor(f, design(f))).toBeNull();
  });
});

describe("subset livery — Gemma's own advice", () => {
  it("marks a recommended factor", () => {
    const f = factor({ subset_relevance: "recommended" });
    expect(subsetLiveryFor(f, design(f))?.tone).toBe("on");
  });

  it("carries the reason into the hover text when one was given", () => {
    const f = factor({
      subset_relevance: "recommended",
      subset_relevance_reason: "tissues are not comparable on one model",
    });
    expect(subsetLiveryFor(f, design(f))?.blurb).toContain(
      "tissues are not comparable on one model",
    );
  });

  it("marks a ruled-out factor distinctly from an undecided one", () => {
    const no = factor({ subset_relevance: "not_applicable" });
    const dunno = factor({ subset_relevance: "uncertain" });
    expect(subsetLiveryFor(no, design(no))?.tone).toBe("off");
    expect(subsetLiveryFor(dunno, design(dunno))?.tone).toBe("unsure");
  });

  it("renders an UNFAMILIAR value as itself rather than dropping it", () => {
    // The vocabulary is open by contract — `covariate` is expected next
    // and needs no Gemma release. Swallowing an unknown value would
    // hide advice somebody deliberately recorded.
    const f = factor({ subset_relevance: "covariate" });
    const livery = subsetLiveryFor(f, design(f));
    expect(livery).not.toBeNull();
    expect(livery!.label).toContain("covariate");
  });
});

describe("subset livery — the design's own record wins", () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    id: "r1",
    gemma_factor_id: 25518,
    source: "agent",
    status: "agent_recommended",
    ...over,
  });

  it("a live recommendation speaks even when Gemma is silent", () => {
    const f = factor();
    expect(subsetLiveryFor(f, design(f, [rec()]))?.tone).toBe("on");
  });

  it("a REJECTION outranks a standing 'recommended' from Gemma", () => {
    // A rejection is a curator act on this design, and overruling a
    // recommendation is the entire reason it exists.
    const f = factor({ subset_relevance: "recommended" });
    const livery = subsetLiveryFor(f, design(f, [rec({ status: "rejected" })]));
    expect(livery?.tone).toBe("off");
  });

  it("does not borrow another factor's recommendation", () => {
    const f = factor();
    const other = design(f, [rec({ gemma_factor_id: 99999 })]);
    expect(subsetLiveryFor(f, other)).toBeNull();
  });
});

describe("subset livery — what an analysis actually did", () => {
  const used = new Set([25518]);

  it("marks a factor a DEA subset by, distinctly from advice", () => {
    const f = factor();
    const livery = subsetLiveryFor(f, design(f), used);
    expect(livery?.tone).toBe("on");
    expect(livery?.label).toBe("subset in analysis");
  });

  it("matches on the GEMMA factor id, never the design-local one", () => {
    // `Factor.id` is 7 here and the analysis names 25518; keying on the
    // wrong one would mark whichever factor happened to sit at that
    // index.
    const f = factor({ gemma_factor_id: 99999 });
    expect(subsetLiveryFor(f, design(f), used)).toBeNull();
  });

  it("leads with the fact but does not silence a later rejection", () => {
    // History and intent, not a contradiction — flattening one into the
    // other would report a decision nobody made.
    const f = factor({ subset_relevance: "recommended" });
    const d = design(f, [
      { id: "r1", gemma_factor_id: 25518, source: "agent", status: "rejected" },
    ]);
    const livery = subsetLiveryFor(f, d, used);
    expect(livery?.label).toBe("subset in analysis");
    expect(livery?.blurb).toContain("since rejected");
  });

  it("an empty used-set marks nothing — absence is not a ruling", () => {
    // Local mode and a failed read both land here. A factor we cannot
    // show was used must read as unmarked, never as ruled out.
    const f = factor();
    expect(subsetLiveryFor(f, design(f), new Set())).toBeNull();
  });
});
