/**
 * @vitest-environment jsdom
 *
 * The disc is the whole feature at a glance: it must appear only when
 * there is something to say, and what it says must be "was a human
 * involved", not "an annotation exists".
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { ProvenanceTrace } from "@/api/provenance";

import { ProvenanceDot } from "./ProvenanceDot";
import {
  ProvenanceRunContext,
  type ProvenanceRunValue,
} from "./ProvenanceContext";

function withRun(traces: ProvenanceTrace[], children: React.ReactNode) {
  const run: ProvenanceRunValue = {
    status: "ready",
    byRef: new Map(traces.map((t) => [t.ref_id, t])),
    asked: traces.length,
    traced: traces.filter((t) => t.events.length > 0).length,
    populate: () => {},
    clear: () => {},
  };
  return (
    <ProvenanceRunContext.Provider value={run}>
      {children}
    </ProvenanceRunContext.Provider>
  );
}

const traced = (over: Partial<ProvenanceTrace> = {}): ProvenanceTrace => ({
  ref_id: "factor:3",
  review_state: "unreviewed",
  events: [
    {
      kind: "agent_proposed",
      at: "2026-08-15T10:00:00Z",
      actor: { kind: "agent", name: "strain", model: "claude-sonnet-5" },
      run_id: "2026-08-15_allbells147",
    },
  ],
  ...over,
});

describe("ProvenanceDot", () => {
  // Before anyone presses "populate" there is no run, and the dot must
  // not imply the question was asked.
  it("renders nothing with no run", () => {
    const { container } = render(<ProvenanceDot refId="factor:3" />);
    expect(container).toBeEmptyDOMElement();
  });

  // 🛑 "We asked and nobody knew" earns no marker. Most annotations
  // are this case, and a ring on all of them is chrome charging rent —
  // the panel's tally carries the "we asked" half.
  it("renders nothing for an annotation the run found nothing for", () => {
    const { container } = render(
      withRun(
        [{ ref_id: "factor:3", review_state: null, events: [] }],
        <ProvenanceDot refId="factor:3" />,
      ),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a ref the run never covered", () => {
    const { container } = render(
      withRun([traced()], <ProvenanceDot refId="tag:99" />),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a disc once there is a trace, and says who blessed it", () => {
    render(withRun([traced()], <ProvenanceDot refId="factor:3" />));
    expect(
      screen.getByTitle("proposed, not reviewed by a human"),
    ).toBeTruthy();
  });

  it("distinguishes a human-owned annotation from a proposed one", () => {
    render(
      withRun(
        [traced({ ref_id: "tag:7", review_state: "curator_authored" })],
        <ProvenanceDot refId="tag:7" />,
      ),
    );
    expect(screen.getByTitle("a curator wrote this")).toBeTruthy();
  });

  // Events with no server-computed review_state must not be dressed as
  // "unreviewed" — that is a claim about a human we have no evidence
  // for.
  it("says the review state is unknown rather than guessing", () => {
    render(
      withRun(
        [traced({ ref_id: "tag:7", review_state: null })],
        <ProvenanceDot refId="tag:7" />,
      ),
    );
    expect(
      screen.getByTitle("source recorded; review state unknown"),
    ).toBeTruthy();
  });
});
