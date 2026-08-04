/**
 * @vitest-environment jsdom
 *
 * Render-time regression tests for BossReviewPanel — the top-of-
 * experiment slot, now the DESIGN-scoped slice of the boss-critic feed
 * (handoff BOSS_CRITIC_REVIEW_PRESENTATION_2026_08_03). Factor / FV /
 * tag verdicts route inline onto their finding section (tested via
 * ``bossCriticGrouping`` + ``findingList``); this panel renders the
 * whole-design verdicts plus an experiment-wide severity tally.
 *
 * Pins:
 *   - suppresses entirely when there's no design verdict AND nothing routed
 *   - the experiment-wide severity tally spans design + routed groups
 *   - the "Round 1 only — proposer didn't re-evaluate" note fires on an
 *     unresolved design blocker
 *   - design rows render "Whole design"; routed groups surface a
 *     "N on factors …" pointer instead of their bodies
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { BossCriticReview } from "@/api/auditTypes";
import { BossReviewPanel } from "./BossReviewPanel";
import {
  bossSectionKind,
  groupBossReviews,
  type GroupedBossReview,
} from "./bossCriticGrouping";

function rev(overrides: Partial<BossCriticReview> = {}): BossCriticReview {
  return {
    target_id: "design",
    round: 1,
    severity: "blocker",
    verdict: "The diurnal-sampling factor was miscategorised.",
    brief: "The diurnal-sampling factor was miscategorised.",
    ...overrides,
  };
}

/** Build the {design, routed} split the panel takes, the same way
 *  findingList does. */
function split(reviews: BossCriticReview[]): {
  designGroups: GroupedBossReview[];
  routedGroups: GroupedBossReview[];
} {
  const groups = groupBossReviews(reviews);
  return {
    designGroups: groups.filter(
      (g) => g.scopeKind === "design" || g.scopeKind === "other",
    ),
    routedGroups: groups.filter((g) => bossSectionKind(g.scopeKind) !== null),
  };
}

describe("BossReviewPanel — empty-state", () => {
  it("renders nothing when there are no groups", () => {
    const { container } = render(
      <BossReviewPanel designGroups={[]} routedGroups={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("BossReviewPanel — severity counts", () => {
  it("tallies design + routed groups in the experiment-wide chips", () => {
    const { designGroups, routedGroups } = split([
      rev({ target_id: "design", severity: "blocker" }),
      rev({ target_id: "factor:age", severity: "advisory" }),
      rev({ target_id: "factor:sex", severity: "advisory" }),
      rev({ target_id: "tag:cell-type|astrocyte", severity: "ok" }),
    ]);
    render(
      <BossReviewPanel designGroups={designGroups} routedGroups={routedGroups} />,
    );
    expect(screen.getByText(/1\s+blocker/i)).toBeInTheDocument();
    expect(screen.getByText(/2\s+advisory/i)).toBeInTheDocument();
    expect(screen.getByText(/1\s+ok/i)).toBeInTheDocument();
  });
});

describe("BossReviewPanel — unresolved-blocker note", () => {
  it("shows the 'Round 1 only' note for an unresolved design blocker", () => {
    const { designGroups, routedGroups } = split([
      rev({ target_id: "design", severity: "blocker", round: 1 }),
    ]);
    render(
      <BossReviewPanel designGroups={designGroups} routedGroups={routedGroups} />,
    );
    expect(
      screen.getByText(/proposer didn't re-evaluate/i),
    ).toBeInTheDocument();
  });

  it("suppresses the note when a round-2 entry resolved the blocker", () => {
    const { designGroups, routedGroups } = split([
      rev({ target_id: "design", severity: "blocker", round: 1 }),
      rev({ target_id: "design", severity: "ok", round: 2 }),
    ]);
    render(
      <BossReviewPanel designGroups={designGroups} routedGroups={routedGroups} />,
    );
    expect(
      screen.queryByText(/proposer didn't re-evaluate/i),
    ).toBeNull();
  });
});

describe("BossReviewPanel — design rows + routed pointer", () => {
  it("renders the design verdict as a 'Whole design' row", () => {
    const { designGroups, routedGroups } = split([
      rev({ target_id: "design", severity: "blocker" }),
    ]);
    render(
      <BossReviewPanel designGroups={designGroups} routedGroups={routedGroups} />,
    );
    expect(screen.getByText(/Whole design/)).toBeInTheDocument();
  });

  it("points at the routed count instead of rendering routed bodies", () => {
    const { designGroups, routedGroups } = split([
      rev({ target_id: "design", severity: "blocker" }),
      rev({
        target_id: "factor:age",
        severity: "advisory",
        verdict: "AGE VERDICT BODY should not appear in the panel",
      }),
    ]);
    render(
      <BossReviewPanel designGroups={designGroups} routedGroups={routedGroups} />,
    );
    // The routed factor verdict's prose stays out of the panel...
    expect(
      screen.queryByText(/AGE VERDICT BODY/),
    ).toBeNull();
    // ...but its count is pointed at.
    expect(screen.getByText(/1 on factor/i)).toBeInTheDocument();
  });
});
