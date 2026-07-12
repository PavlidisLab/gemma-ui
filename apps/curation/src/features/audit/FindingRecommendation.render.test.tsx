/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FindingRecommendation } from "./FindingRecommendation";
import type { Recommendation } from "@/api/auditTypes";

function rec(partial: Partial<Recommendation>): Recommendation {
  return {
    action: "keep_current",
    adopt_value: null,
    confidence: "high",
    one_line_reason: "",
    ...partial,
  };
}

describe("FindingRecommendation", () => {
  it("renders the action verb, reason subtitle, and confidence chip", () => {
    render(
      <FindingRecommendation
        recommendation={rec({
          action: "keep_current",
          confidence: "medium",
          one_line_reason: "Gold's factor value is already correct.",
        })}
      />,
    );
    expect(screen.getByText("Keep current")).toBeInTheDocument();
    expect(
      screen.getByText("Gold's factor value is already correct."),
    ).toBeInTheDocument();
    expect(screen.getByText("medium")).toBeInTheDocument();
  });

  it("shows the adopt_value inline for a merge", () => {
    render(
      <FindingRecommendation
        recommendation={rec({
          action: "merge",
          adopt_value: "delivered at dose: 25 uM",
          one_line_reason:
            "Gold's DAPT FV is right but lacks the 25 uM dose the agent captured.",
        })}
      />,
    );
    // Verb + folded-in value render together.
    expect(screen.getByText("Merge in", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("delivered at dose: 25 uM")).toBeInTheDocument();
  });

  it("shows the adopt_value for add_missing (the concrete thing to add)", () => {
    // Real live-audit data: add_missing carries a meaningful value.
    render(
      <FindingRecommendation
        recommendation={rec({
          action: "add_missing",
          adopt_value: "disease: Huntington disease",
          confidence: "high",
          one_line_reason: "The experiment investigates the mutant huntingtin gene.",
        })}
      />,
    );
    expect(screen.getByText("Add missing", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("disease: Huntington disease")).toBeInTheDocument();
  });

  it("does NOT show an adopt_value for keep/drop even if one is present", () => {
    render(
      <FindingRecommendation
        recommendation={rec({
          action: "drop",
          adopt_value: "should not show",
          one_line_reason: "Agent over-tagged.",
        })}
      />,
    );
    expect(screen.getByText("Drop")).toBeInTheDocument();
    expect(screen.queryByText("should not show")).not.toBeInTheDocument();
  });

  it("falls back to a styled 'Your call' for an unknown/forward-compat action", () => {
    render(
      <FindingRecommendation
        recommendation={rec({
          action: "some_future_action",
          one_line_reason: "New action the UI doesn't know yet.",
        })}
      />,
    );
    // Unknown action still renders (via the flag_for_curator fallback),
    // never an unstyled/blank verb.
    expect(screen.getByTestId("finding-recommendation")).toBeInTheDocument();
    expect(screen.getByText("Your call")).toBeInTheDocument();
  });
});
