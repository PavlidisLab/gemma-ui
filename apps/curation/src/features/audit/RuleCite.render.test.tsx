/**
 * @vitest-environment jsdom
 *
 * Render tests for ``<RuleCite/>`` — the precise-rule ``?`` next to a
 * finding's reasoning. Pins: it renders the ``?`` for a finding whose
 * issue_code is a registry key, pops the precise rule text on click,
 * and renders nothing for an unresolvable finding.
 */
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { AuditFinding } from "@/api/auditTypes";
import { RuleCite } from "./RuleCite";

function finding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    target_kind: "tag",
    target_id: "tag:x",
    severity: "ok",
    issue_code: "",
    citation: "",
    ...overrides,
  } as unknown as AuditFinding;
}

describe("RuleCite", () => {
  it("renders the ? for a known issue_code and pops the precise rule", () => {
    render(
      <RuleCite finding={finding({ issue_code: "calibration_gold_only_miss" })} />,
    );
    // The "?" affordance carries an aria-label of "help: <title>".
    const trigger = screen.getByLabelText(
      /A tag already captured by a biomaterial characteristic is redundant/i,
    );
    expect(trigger).toBeTruthy();
    // Body text is hidden until the popup opens.
    expect(screen.queryByText(/Tags fill gaps/i)).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByText(/Tags fill gaps/i)).toBeTruthy();
  });

  it("prefers citation over issue_code", () => {
    render(
      <RuleCite
        finding={finding({
          citation: "D8",
          issue_code: "calibration_gold_only_miss",
        })}
      />,
    );
    // D8 is the baseline rule, not the redundant-tag rule.
    expect(
      screen.getByLabelText(/Contrast factors need a baseline FV/i),
    ).toBeTruthy();
  });

  it("renders nothing for an unknown finding", () => {
    const { container } = render(
      <RuleCite finding={finding({ issue_code: "totally_unknown" })} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
