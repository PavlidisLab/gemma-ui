/**
 * @vitest-environment jsdom
 *
 * The disc is the whole feature at a glance: it must appear only when
 * there is something to say, and what it says must be **where this
 * came from** — when, by whom, agent or not — never a verdict on it.
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

  it("says when it arrived and that an agent is where it came from", () => {
    render(withRun([traced()], <ProvenanceDot refId="factor:3" />));
    expect(screen.getByTitle("From an agent · 2026-08-15")).toBeTruthy();
  });

  it("names the curator when a human put it there", () => {
    render(
      withRun(
        [
          traced({
            ref_id: "tag:7",
            review_state: "curator_authored",
            events: [
              {
                kind: "curator_added",
                at: "2026-08-15T10:00:00Z",
                actor: { kind: "curator", name: "local-curator" },
              },
            ],
          }),
        ],
        <ProvenanceDot refId="tag:7" />,
      ),
    );
    expect(
      screen.getByTitle("Added by local-curator · 2026-08-15"),
    ).toBeTruthy();
  });

  // 🛑 The surface answers "where did this come from", and a proposal
  // a curator turned down answers it with nothing — the agent didn't
  // put the annotation there. Showing a disc would be reporting that
  // somebody argued about it, which is the judgement this is not for.
  it("renders nothing when all that happened is a declined proposal", () => {
    const { container } = render(
      withRun(
        [
          {
            ref_id: "factor:1",
            review_state: "rejected",
            events: [
              {
                kind: "curator_rejected",
                at: "2026-07-21T04:06:49Z",
                actor: { kind: "curator", name: "local-curator" },
                reason: "agent_real_miss",
              },
              {
                kind: "agent_proposed",
                at: "2026-07-21T03:07:17Z",
                actor: { kind: "agent", model: "adhoc-decision-ticket" },
              },
            ],
          },
        ],
        <ProvenanceDot refId="factor:1" />,
      ),
    );
    expect(container).toBeEmptyDOMElement();
  });

  // …but a decline that came AFTER the annotation was really put there
  // doesn't erase the origin.
  it("keeps the origin when something survived the decline", () => {
    render(
      withRun(
        [
          {
            ref_id: "tag:4",
            review_state: "rejected",
            events: [
              {
                kind: "curator_rejected",
                at: "2026-08-10T00:00:00Z",
                actor: { kind: "curator", name: "local-curator" },
              },
              {
                kind: "agent_applied",
                at: "2026-07-01T00:00:00Z",
                actor: { kind: "curator", name: "local-curator" },
              },
            ],
          },
        ],
        <ProvenanceDot refId="tag:4" />,
      ),
    );
    expect(
      screen.getByTitle("Added by local-curator · 2026-07-01"),
    ).toBeTruthy();
  });
});
