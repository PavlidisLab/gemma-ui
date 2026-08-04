/**
 * @vitest-environment jsdom
 *
 * The leave-guard must NOT prompt on same-experiment navigation (a tab /
 * chip-strip / param change keeps the running job visible on the page);
 * it only guards leaving the experiment. Regression for the tab-switch
 * false-prompt.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { NavigationBlocker } from "@/routes";

let captured: NavigationBlocker | null = null;

vi.mock("@/routes", () => ({
  registerNavigationBlocker: (b: NavigationBlocker) => {
    captured = b;
    return () => {
      captured = null;
    };
  },
}));

vi.mock("@/state/inFlightJobs", () => ({
  // A job IS in flight for the EE — so a real "leave the experiment"
  // navigation would defer to the modal.
  getJobsForEE: () => [{ kind: "proposal", label: "Proposal for GSE279439" }],
}));

vi.mock("@/api/tickets", () => ({
  useMyTickets: () => ({ data: [] }),
  useCreateTicket: () => ({
    mutateAsync: vi.fn(),
    isError: false,
    isPending: false,
    error: null,
  }),
}));

import { LeaveJobGuard } from "./LeaveJobGuard";

describe("LeaveJobGuard — same-experiment navigation is not guarded", () => {
  beforeEach(() => {
    captured = null;
    render(<LeaveJobGuard eeId={51} accession="GSE279439" />);
  });

  it("allows same-experiment tab / param changes without prompting", () => {
    expect(captured).toBeTruthy();
    expect(captured!("#/experiments/51")).toBe(true);
    expect(captured!("#/experiments/51?tab=design")).toBe(true);
    expect(captured!("#/experiments/51?tab=samples&base=preboard")).toBe(true);
  });

  it("defers to the modal when actually leaving the experiment", () => {
    // A different experiment, a prefix-collision id (510 vs 51), and a
    // non-experiment page all count as leaving → the blocker returns a
    // Promise (the modal decides), not a bare true.
    expect(captured!("#/experiments/52?tab=overview")).toBeInstanceOf(Promise);
    expect(captured!("#/experiments/510")).toBeInstanceOf(Promise);
    expect(captured!("#/inbox")).toBeInstanceOf(Promise);
  });
});
