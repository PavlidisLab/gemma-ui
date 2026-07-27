/**
 * @vitest-environment jsdom
 *
 * Render-time regression tests for BossReviewPanel — the top-of-
 * experiment slot the reviewer moved the boss-critic surface into on
 * 2026-06-16 (after the fan-out spam complaint). Pins:
 *   - suppresses entirely on empty / missing input
 *   - severity chip counts ("1 blocker · 2 advisory") render
 *   - the "Round 1 only — proposer didn't re-evaluate" note fires
 *     when blockers exist but no higher round did
 *   - per-row scope label renders "Whole design" / "Factor: <cat>" /
 *     "Tag: <cat> : <val>" forms instead of raw target_ids
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { BossCriticReview } from "@/api/auditTypes";
import { BossReviewPanel } from "./BossReviewPanel";

function row(overrides: Partial<BossCriticReview> = {}): BossCriticReview {
  return {
    target_id: "design",
    round: 1,
    severity: "blocker",
    verdict: "The diurnal-sampling factor was miscategorised.",
    brief: "The diurnal-sampling factor was miscategorised.",
    ...overrides,
  };
}

describe("BossReviewPanel — empty-state", () => {
  it("renders nothing when reviews is null", () => {
    const { container } = render(<BossReviewPanel reviews={null} />);
    expect(container.firstChild).toBeNull();
  });
  it("renders nothing when reviews is undefined", () => {
    const { container } = render(<BossReviewPanel reviews={undefined} />);
    expect(container.firstChild).toBeNull();
  });
  it("renders nothing when reviews is empty array", () => {
    const { container } = render(<BossReviewPanel reviews={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("BossReviewPanel — severity counts", () => {
  it("renders one chip per severity present, with counts", () => {
    render(
      <BossReviewPanel
        reviews={[
          row({ target_id: "design", severity: "blocker" }),
          row({ target_id: "factor:age", severity: "advisory" }),
          row({ target_id: "factor:sex", severity: "advisory" }),
          row({ target_id: "tag:cell-type|astrocyte", severity: "ok" }),
        ]}
      />,
    );
    expect(screen.getByText(/1\s+blocker/i)).toBeInTheDocument();
    expect(screen.getByText(/2\s+advisory/i)).toBeInTheDocument();
    expect(screen.getByText(/1\s+ok/i)).toBeInTheDocument();
  });
});

describe("BossReviewPanel — unresolved-blocker note", () => {
  it("shows the 'Round 1 only' note when blockers exist and no higher round did", () => {
    render(
      <BossReviewPanel
        reviews={[
          row({ target_id: "design", severity: "blocker", round: 1 }),
        ]}
      />,
    );
    expect(
      screen.getByText(/proposer didn't re-evaluate/i),
    ).toBeInTheDocument();
  });

  it("suppresses the note when a round-2 entry exists for the blocker target", () => {
    render(
      <BossReviewPanel
        reviews={[
          row({ target_id: "design", severity: "blocker", round: 1 }),
          row({ target_id: "design", severity: "ok", round: 2 }),
        ]}
      />,
    );
    expect(
      screen.queryByText(/proposer didn't re-evaluate/i),
    ).toBeNull();
  });

  it("suppresses the note when only OK rows are present", () => {
    render(
      <BossReviewPanel
        reviews={[row({ target_id: "design", severity: "ok", round: 1 })]}
      />,
    );
    expect(
      screen.queryByText(/proposer didn't re-evaluate/i),
    ).toBeNull();
  });
});

describe("BossReviewPanel — scope labels", () => {
  it("renders target_ids as curator-readable scope labels", () => {
    render(
      <BossReviewPanel
        reviews={[
          row({ target_id: "design" }),
          row({ target_id: "factor:age" }),
          row({ target_id: "tag:cell type|astrocyte" }),
          row({ target_id: "tag:14" }),
        ]}
      />,
    );
    expect(screen.getByText(/Whole design/)).toBeInTheDocument();
    expect(screen.getByText(/Factor: age/)).toBeInTheDocument();
    expect(screen.getByText(/Tag: cell type : astrocyte/)).toBeInTheDocument();
    expect(screen.getByText(/Tag #14/)).toBeInTheDocument();
  });

  it("flags the row as 'proposer didn't address' when it's the unresolved blocker", () => {
    render(
      <BossReviewPanel
        reviews={[
          row({ target_id: "design", severity: "blocker", round: 1 }),
        ]}
      />,
    );
    expect(
      screen.getByText(/proposer didn't address/i),
    ).toBeInTheDocument();
  });
});
