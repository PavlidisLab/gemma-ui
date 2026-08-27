/**
 * @vitest-environment jsdom
 *
 * A closed audit shows no dots — and reopening brings them back.
 *
 * The dot dimmed for a per-target "accepted"/"dismissed" and ignored
 * the review as a whole, so finalizing left full-strength discs on the
 * design advertising "MAJOR · ungrounded_fv … (click to open in
 * sidebar)" — an open finding, on a review the curator had just closed.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const ctx = { value: null as unknown };
vi.mock("./AuditContext", () => ({
  useAuditOptional: () => ctx.value,
  useFocusFinding: () => vi.fn(),
}));

const { AuditDot } = await import("./AuditDot");

const TARGET = "factor:genotype#9001";

function contextWith(isFinalized: boolean) {
  return {
    isFinalized,
    findingsByTarget: new Map([
      [
        TARGET,
        [
          {
            target_id: TARGET,
            issue_code: "ungrounded_fv",
            severity: "major",
            rationale: "Should `Utrn -/-` be resolved to an ontology term?",
          },
        ],
      ],
    ]),
    dispositionByTarget: new Map(),
  };
}

describe("AuditDot on a closed audit", () => {
  it("🛑 renders nothing once the audit is finalized", () => {
    ctx.value = contextWith(true);
    const { container } = render(<AuditDot targetId={TARGET} />);
    expect(container.innerHTML).toBe("");
  });

  it("comes back when the audit is reopened", () => {
    // Nothing is lost by hiding: the dot is derived from the report,
    // never stored, so reopening restores it exactly.
    ctx.value = contextWith(false);
    render(<AuditDot targetId={TARGET} />);
    expect(screen.getByRole("button", { name: /audit: 1 finding/i })).toBeTruthy();
  });

  it("still hides when there is no audit context at all", () => {
    ctx.value = null;
    const { container } = render(<AuditDot targetId={TARGET} />);
    expect(container.innerHTML).toBe("");
  });
});
