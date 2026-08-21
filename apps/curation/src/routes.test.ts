/**
 * @vitest-environment jsdom
 *
 * `siblingExperimentRoute` — walking to another experiment without
 * losing where the curator was.
 *
 * Paul, 2026-08-20: walking a ticket with ‹ › *"should keep the tab
 * that was selected, so nav stays on design details or whatever."*
 *
 * Worth pinning rather than trusting to review: five separate
 * affordances walk between experiments, and before this every one of
 * them dropped the tab — three by building the URL string by hand, two
 * by calling `experimentRoute(id, undefined, group)`, which omits the
 * param rather than preserving it. A comment above one of those two
 * claimed it preserved the tab, and had claimed it for months.
 */
import { describe, expect, it } from "vitest";
import { experimentRoute, siblingExperimentRoute, currentExperimentTab } from "./routes";

function at(hash: string) {
  window.location.hash = hash;
}

describe("siblingExperimentRoute — keeps the tab", () => {
  it("carries the tab across a ticket walk", () => {
    at("#/experiments/12822?tab=design&ticket=188");
    expect(siblingExperimentRoute(9704, { ticketContext: "188" })).toBe(
      "#/experiments/9704?tab=design&ticket=188",
    );
  });

  it("carries the tab across a set walk", () => {
    at("#/experiments/12822?tab=samples&group=g1");
    expect(siblingExperimentRoute(9704, { groupContext: "g1" })).toBe(
      "#/experiments/9704?tab=samples&group=g1",
    );
  });

  it("carries the comparison chips too", () => {
    // A curator walking 20 members comparing `current` against the
    // agent's proposal set that up once, not once per member.
    at("#/experiments/12822?tab=design&ticket=188&base=current&cmp=agent_proposal");
    expect(siblingExperimentRoute(9704, { ticketContext: "188" })).toBe(
      "#/experiments/9704?tab=design&ticket=188&base=current&cmp=agent_proposal",
    );
  });

  it("switches context on the SAME experiment without losing the tab", () => {
    // The set-switch dropdown: same id, different group.
    at("#/experiments/12822?tab=qc&group=g1");
    expect(siblingExperimentRoute(12822, { groupContext: "g2" })).toBe(
      "#/experiments/12822?tab=qc&group=g2",
    );
  });

  it("omits the tab when the curator had not chosen one", () => {
    at("#/experiments/12822?ticket=188");
    expect(siblingExperimentRoute(9704, { ticketContext: "188" })).toBe(
      "#/experiments/9704?ticket=188",
    );
  });

  it("takes the DESTINATION's context, not the source's", () => {
    // Walking a ticket must not smuggle the old group along.
    at("#/experiments/12822?tab=design&group=g1");
    expect(siblingExperimentRoute(9704, { ticketContext: "188" })).toBe(
      "#/experiments/9704?tab=design&ticket=188",
    );
  });

  it("survives being called from somewhere that is not an experiment page", () => {
    at("#/tickets/188");
    expect(siblingExperimentRoute(9704, { ticketContext: "188" })).toBe(
      "#/experiments/9704?ticket=188",
    );
  });

  it("keeps a preboarding id literal, not percent-encoded", () => {
    // `%3A` works for the server but trips the hash router on a paste.
    at("#/experiments/12822?tab=design");
    expect(siblingExperimentRoute("preboarding:7", {})).toBe(
      "#/experiments/preboarding:7?tab=design",
    );
  });
});

describe("the gap this closes", () => {
  it("🛑 experimentRoute with an undefined tab OMITS it — that is not preserving", () => {
    // The exact call two of the five sites were making, with a comment
    // above one of them saying it preserved the tab.
    at("#/experiments/12822?tab=design&group=g1");
    expect(experimentRoute(9704, undefined, "g1")).toBe(
      "#/experiments/9704?group=g1",
    );
    expect(siblingExperimentRoute(9704, { groupContext: "g1" })).toBe(
      "#/experiments/9704?tab=design&group=g1",
    );
  });
});

describe("currentExperimentTab", () => {
  it("reads the live hash", () => {
    at("#/experiments/12822?tab=diagnostics");
    expect(currentExperimentTab()).toBe("diagnostics");
  });

  it("is undefined off an experiment page", () => {
    at("#/tickets/188");
    expect(currentExperimentTab()).toBeUndefined();
  });
});
