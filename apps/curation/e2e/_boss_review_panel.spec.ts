/**
 * Playwright spec — boss-critic review presentation.
 *
 * Contract (handoff BOSS_CRITIC_REVIEW_PRESENTATION_2026_08_03): the
 * boss-critic feed is a curator WORKLIST, not a raw dump of the agent's
 * multi-round deliberation.
 *   - Round history collapses to ONE verdict per (target, issue); the
 *     earlier rounds tuck behind a "how the agent got here" expander.
 *   - WHOLE-DESIGN verdicts render in the top panel; verdicts about a
 *     specific factor / FV / tag route INLINE onto that element's
 *     finding section.
 *   - The panel header still shows the experiment-wide severity tally.
 *
 * Anchor experiment: GSE190221 (id 29184) on the live boss-critic-200
 * ticket — the frozen HAR carries one design-scope blocker + two
 * round-1 factor-scope blockers on "diurnal ZT sampling" (no
 * ``finding_key`` yet, so the two factor rows collapse on ``target_id``
 * into one routed factor annotation). Stable seed across rebuilds
 * because the source-run JSONL pinned the verdicts.
 *
 * Tagged @critical so the precommit gate runs it.
 */
import { expect, test } from "@playwright/test";
import { mockExperiment } from "./_mocks";

const TARGET = "/#/experiments/29184";

test.describe("Boss-critic review presentation @critical", () => {
  test.beforeEach(async ({ page }) => {
    // Data-mocked: the boss-critic verdicts + finding set are frozen in
    // a HAR so this tests the RENDER, not the store having GSE190221
    // loaded or the ontology host being reachable. Re-record with
    // PWHAR_UPDATE=1 (see mockExperiment).
    await mockExperiment(page, "exp-29184");
    await page.addInitScript(() => window.localStorage.clear());
    await page.setViewportSize({ width: 1600, height: 1400 });
    await page.goto(TARGET);
    await page.waitForSelector("#root > *", { state: "attached" });
    await page
      .getByText(/boss-critic review/i)
      .first()
      .waitFor({ state: "visible", timeout: 30000 });
  });

  test("renders the panel header 'Boss-critic review · experiment-wide'", async ({
    page,
  }) => {
    await expect(page.getByText(/boss-critic review/i)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(/experiment-wide/i)).toBeVisible();
  });

  test("severity tally spans design + routed verdicts (2 blocker)", async ({
    page,
  }) => {
    // 1 design-scope blocker + the two factor rows collapsed to one
    // factor-scope blocker = a 2-blocker experiment-wide tally.
    await expect(page.getByText(/2\s+blocker/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test("the whole-design verdict stays in the top panel", async ({ page }) => {
    await expect(page.getByText(/whole design/i).first()).toBeVisible({
      timeout: 10000,
    });
    // The design blocker's prose appears exactly once — it is not fanned
    // out across finding cards (the v0.14.2–.4 regression) and not also
    // routed inline (it's design-scope, so it belongs only in the panel).
    await expect(page.getByText(/Reviewed the 2×6 Bmal1 HepKO/i)).toHaveCount(
      1,
      { timeout: 10000 },
    );
  });

  test("the factor-scope verdict routes inline as a boss annotation", async ({
    page,
  }) => {
    // "diurnal ZT sampling" is a factor-scope verdict — it renders on the
    // factor section as a "Boss-critic" annotation, not in the top panel.
    await expect(
      page.getByText(/Boss-critic/i).nth(1),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText(/diurnal ZT sampling/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
