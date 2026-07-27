/**
 * Playwright spec — top-of-experiment BossReviewPanel.
 *
 * Contract (design review 2026-06-16, ticket-62 walkthrough): the boss-critic
 * commentary renders ONCE at the top of the audit sidebar, between
 * the orientation prose and the per-finding cards. It is NOT
 * fanned out across cards. Per-experiment scope: severity counts,
 * scope chips per row, and an "unresolved blocker" note when the
 * proposer never re-evaluated.
 *
 * Anchor experiment: GSE190221 (id 29184) on the live boss-critic-200
 * ticket — carries 3 round-1 blockers (one design-scope, two
 * factor-scope on "diurnal ZT sampling"). Stable seed across
 * rebuilds because the source-run JSONL pinned the verdicts.
 *
 * Tagged @critical so the precommit gate runs it.
 */
import { expect, test } from "@playwright/test";
import { mockExperiment } from "./_mocks";

const TARGET = "/#/experiments/29184";

test.describe("BossReviewPanel — experiment-level boss-critic surface @critical", () => {
  test.beforeEach(async ({ page }) => {
    // Data-mocked: the boss-critic verdicts + finding set are frozen in
    // a HAR so this tests the panel's RENDER, not the store having
    // GSE190221 loaded or the ontology host being reachable. Re-record with
    // PWHAR_UPDATE=1 (see mockExperiment).
    await mockExperiment(page, "exp-29184");
    await page.addInitScript(() => window.localStorage.clear());
    await page.setViewportSize({ width: 1600, height: 1400 });
    await page.goto(TARGET);
    await page.waitForSelector("#root > *", { state: "attached" });
    // Wait for the boss panel to ACTUALLY render rather than a fixed sleep.
    // The audit sidebar loads async; under parallel @critical load a fixed
    // 4.5s beat loses the race (the data is correct — this was pure timing
    // flakiness). Anchoring on the panel header makes the spec reproducible.
    await page
      .getByText(/boss-critic review/i)
      .first()
      .waitFor({ state: "visible", timeout: 30000 });
  });

  test("renders a single panel header reading 'Boss-critic review · experiment-wide'", async ({
    page,
  }) => {
    const header = page.getByText(/boss-critic review/i);
    await expect(header).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/experiment-wide/i)).toBeVisible();
  });

  test("severity chip shows '3 blocker' for GSE190221", async ({ page }) => {
    // GSE190221 has three round-1 blocker calls — one on design + two
    // on factor:diurnal ZT sampling. The count chip aggregates.
    const blockerCount = page.getByText(/3\s+blocker/i);
    await expect(blockerCount).toBeVisible({ timeout: 10000 });
  });

  test("surfaces the unresolved-blocker note when only round 1 ran", async ({
    page,
  }) => {
    await expect(
      page.getByText(/proposer didn't re-evaluate/i),
    ).toBeVisible({ timeout: 10000 });
  });

  test("renders scope rows for design + factor entries", async ({
    page,
  }) => {
    // Three rows on GSE190221 — 1 design-scope + 2 factor-scope on
    // "diurnal ZT sampling". Confirm at least one row of each kind
    // landed. ``.first()`` is needed because the factor name is
    // emitted twice (two round-1 calls on the same factor).
    await expect(
      page.getByText(/whole design/i).first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText(/diurnal ZT sampling/i).first(),
    ).toBeVisible();
  });

  test("the panel is NOT duplicated inside any finding card body", async ({
    page,
  }) => {
    // Sanity: the v0.14.2–.4 fan-out behaviour painted the same
    // verdict prose onto every finding card's reviews list. After
    // v0.14.5 the prose should appear exactly ONCE on the page.
    const blockerBriefs = page.getByText(
      /Reviewed the 2×6 Bmal1 HepKO/i,
    );
    await expect(blockerBriefs).toHaveCount(1, { timeout: 10000 });
  });
});
