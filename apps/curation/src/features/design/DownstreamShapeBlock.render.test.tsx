/**
 * @vitest-environment jsdom
 *
 * The proposer / audit panel's analysis-scope strip.
 *
 * This block has never once rendered a Gemma-seeded recommendation:
 * `composeCurationDesign` dropped the field before it arrived, and even
 * when it did arrive the filter here was `source === "agent"`. 69 of
 * 500 experiments carry one. These pin both halves of the fix, plus the
 * disposition shape Paul set on 2026-08-20 — in effect by default,
 * reject is the only affordance.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Design, SubsetRecommendation } from "@/features/experiment/types";
import { DownstreamShapeBlock } from "./DownstreamShapeBlock";

const apply = vi.fn();

vi.mock("./DesignDraftContext", () => ({
  useDesignDraft: () => ({ apply }),
}));

function design(recs: SubsetRecommendation[], over: Partial<Design> = {}): Design {
  return {
    experiment_id: 18392,
    experiment_short_name: "GSE74438",
    factors: [
      {
        id: 1,
        name: "organism part",
        category: { label: "organism part", uri: null },
        description: "",
        type: "categorical",
        gemma_factor_id: 36160,
        factor_values: [
          {
            id: 10,
            free_text_label: "Ammon's horn",
            is_baseline: false,
            statements: [],
            biomaterial_short_names: [],
          },
          {
            id: 11,
            free_text_label: "frontal cortex",
            is_baseline: false,
            statements: [],
            biomaterial_short_names: [],
          },
        ],
      },
    ],
    biomaterials: [],
    tags: [],
    subset_recommendations: recs,
    ...over,
  };
}

function rec(over: Partial<SubsetRecommendation> = {}): SubsetRecommendation {
  return {
    id: "gemma-subset-organism-part",
    by_factor_id: 1,
    gemma_factor_id: 36160,
    level_labels: [],
    rationale: "",
    status: "agent_recommended",
    // The panel shows what the AGENT is proposing; Gemma's own rows are
    // already part of the record and live on the design tab.
    source: "agent",
    ...over,
  };
}

describe("DownstreamShapeBlock — proposal-origin only", () => {
  it("renders what the agent is proposing", () => {
    render(<DownstreamShapeBlock draft={design([rec({ source: "agent" })])} />);
    expect(screen.getByText(/proposed analysis scope/i)).toBeTruthy();
    expect(screen.getByText("organism part")).toBeTruthy();
    expect(screen.getByText(/from agent/)).toBeTruthy();
  });

  it("🛑 leaves a Gemma row to the design tab", () => {
    // Paul, 2026-08-20: "these should be in the proposal panel on the
    // right, if they are coming from a proposal. If they are already in
    // the system, obviously they are shown." Gemma's rows ARE the
    // record, and the design tab is on screen beside this panel —
    // repeating them here was half of what made the surface feel
    // duplicated and oversized.
    const { container } = render(
      <DownstreamShapeBlock draft={design([rec({ source: "gemma" })])} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("leaves the curator's own row to the design tab too", () => {
    const { container } = render(
      <DownstreamShapeBlock draft={design([rec({ source: "curator" })])} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing at all when there is nothing to say", () => {
    const { container } = render(<DownstreamShapeBlock draft={design([])} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("DownstreamShapeBlock — a row with no axis is a note", () => {
  // The agent's orphan-sample row on GSE… — `by_factor_id: null`,
  // `category: ""`, `level_labels: []`. It used to render as "subset on
  // (no factor) · every level", claiming a DEA per level of nothing.
  const note = () =>
    rec({
      id: "agent:run:subset:rec",
      by_factor_id: null,
      gemma_factor_id: null,
      category: "",
      level_labels: [],
      rationale:
        "possible orphan sample(s) that may not belong: GSM1919684, GSM1919685",
    });

  it("calls it a note, not a subset", () => {
    render(<DownstreamShapeBlock draft={design([note()])} />);
    expect(screen.getByText("note")).toBeTruthy();
    expect(screen.queryByText("subset")).toBeNull();
  });

  it("never says '(no factor)' or 'every level'", () => {
    render(<DownstreamShapeBlock draft={design([note()])} />);
    expect(screen.queryByText(/no factor/i)).toBeNull();
    expect(screen.queryByText(/every level/i)).toBeNull();
  });

  it("leads with the rationale, which is its whole content", () => {
    render(<DownstreamShapeBlock draft={design([note()])} />);
    expect(screen.getByText(/possible orphan sample/)).toBeTruthy();
  });
});

describe("DownstreamShapeBlock — reject is the only affordance", () => {
  it("offers no Accept button", () => {
    // 🛑 Paul, 2026-08-20: "the default is to accept it unless you
    // disagree". An Accept here asks the curator to agree with a
    // decision already in force — 69 times, to record 5 real signals.
    render(<DownstreamShapeBlock draft={design([rec()])} />);
    expect(screen.queryByRole("button", { name: /accept/i })).toBeNull();
    expect(screen.getByRole("button", { name: /reject/i })).toBeTruthy();
  });

  it("says the recommendation is already in force", () => {
    render(<DownstreamShapeBlock draft={design([rec()])} />);
    expect(screen.getByText(/in effect unless you reject/i)).toBeTruthy();
  });

  it("rejecting writes the status to the draft", async () => {
    apply.mockClear();
    render(<DownstreamShapeBlock draft={design([rec()])} />);
    await userEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(apply).toHaveBeenCalledTimes(1);
    const mutate = apply.mock.calls[0][0] as (d: Design) => Design;
    const next = mutate(design([rec()]));
    expect(next.subset_recommendations?.[0].status).toBe("rejected");
  });

  it("a rejected one drops out of the panel", () => {
    const { container } = render(
      <DownstreamShapeBlock draft={design([rec({ status: "rejected" })])} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("DownstreamShapeBlock — tier drives how loudly", () => {
  it("shows the tier when the wire carries one", () => {
    render(<DownstreamShapeBlock draft={design([rec({ tier: "qa" })])} />);
    expect(screen.getByText("quality")).toBeTruthy();
  });

  it("a convention-tier notice still renders — quiet is not hidden", () => {
    render(
      <DownstreamShapeBlock draft={design([rec({ tier: "convention" })])} />,
    );
    expect(screen.getByText("convention")).toBeTruthy();
  });

  it("tier none renders nothing", () => {
    const { container } = render(
      <DownstreamShapeBlock draft={design([rec({ tier: "none" })])} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("puts the classifier's own sentence on the chip, not the generic blurb", () => {
    const evidence =
      "Gemma reports a batch artifact (PC 1, p=0.0000), and the subset axis " +
      "is equal with the batch factor (Cramer's V 1.00 over 51 shared samples)";
    render(
      <DownstreamShapeBlock
        draft={design([rec({ tier: "qa", tier_evidence: evidence })])}
      />,
    );
    expect(screen.getByText("quality").getAttribute("title")).toBe(evidence);
  });

  it("no tier at all still renders — absent is unclassified, not tier 1", () => {
    // Every row in the store today is tier-less. Folding that to `none`
    // would hide all of them.
    render(<DownstreamShapeBlock draft={design([rec()])} />);
    expect(screen.getByText("organism part")).toBeTruthy();
  });
});

describe("DownstreamShapeBlock — staleness is quiet and absent", () => {
  it("drops a recommendation whose factor is gone, without a warning", () => {
    // Paul: "our polishing will cause this. it's okay." The panel's job
    // is what needs attention; a stale one needs none. It stays visible
    // on the design tab, marked "no longer applies".
    const { container } = render(
      <DownstreamShapeBlock draft={design([rec({ gemma_factor_id: 99999 })])} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("DownstreamShapeBlock — levels", () => {
  it("says 'every level' rather than showing an empty chip strip", () => {
    // Empty level_labels IS subset-DEA — one analysis per level.
    render(<DownstreamShapeBlock draft={design([rec({ level_labels: [] })])} />);
    expect(screen.getByText(/every level/)).toBeTruthy();
  });

  it("chips the levels it names", () => {
    render(
      <DownstreamShapeBlock
        draft={design([rec({ level_labels: ["Ammon's horn"] })])}
      />,
    );
    expect(screen.getByText("Ammon's horn")).toBeTruthy();
  });
});

describe("DownstreamShapeBlock — split", () => {
  it("renders the split decision alongside the subsets", () => {
    render(
      <DownstreamShapeBlock
        draft={design([rec()], {
          should_split_on_factor_id: 1,
          should_split_rationale: "two arms shipped as one series",
        })}
      />,
    );
    expect(screen.getByText("split")).toBeTruthy();
    expect(screen.getByText(/two arms shipped as one series/)).toBeTruthy();
  });
});
