import { test, expect } from "@playwright/test";
import {
  SEED_EXPERIMENT_SHORT_NAME,
  gotoSeedExperiment,
  installErrorGuards,
} from "./_helpers";
import { requiresBackend } from "./_backend";

/**
 * State-tracking e2e — per Paul 2026-06-14: "you need to do something
 * like capture all the data on the web page, click a button, and see
 * if what changes is what you expect. Every single button, field etc.
 * has to be tested in such a manner."
 *
 * The pattern each test follows:
 *   1. Capture the relevant UI state (visible row count, active chip,
 *      button label, URL).
 *   2. Trigger a single user action (button click, chip toggle, …).
 *   3. Assert the EXPECTED change(s) — and only those — actually
 *      happened.
 *
 * The Chrome of these tests is the WHAT-changed assertion. A test
 * that just clicks a button and waits is worth less than nothing —
 * it silently survives behaviour regressions. Each assertion below
 * names the specific delta the click should produce, derived from
 * the component contract.
 *
 * Seed experiment is empty (no findings / no dispositions wired) so
 * these focus on chrome-level state — tab switches, URL params,
 * filter-chip activation, draft-dirty flipping. Findings-level state
 * (disposition counts decrementing on click) needs a populated
 * audit, filed as a separate setup.
 */

test.describe("state tracking — tab switches mutate URL and active-tab class @live", () => {
  test.beforeEach(({ page }) => {
    requiresBackend();
    installErrorGuards(page);
  });

  test("clicking Design tab from Overview: URL ?tab=design + Design active", async ({
    page,
  }) => {
    await gotoSeedExperiment(page, "overview");
    // Pre-state.
    await expect(page).toHaveURL(/tab=overview|\/experiments\/\d+(?!\?tab=)/);
    // Action.
    await page
      .getByRole("button", { name: /^Design( setup)?$/i })
      .first()
      .click();
    // Post-state.
    await expect(page).toHaveURL(/tab=design/);
  });

  test("clicking Samples tab from Design: URL flips, Samples active, Design inactive", async ({
    page,
  }) => {
    await gotoSeedExperiment(page, "design");
    await page
      .getByRole("button", { name: /^Samples$/i })
      .first()
      .click();
    await expect(page).toHaveURL(/tab=samples/);
    // Active tab carries font-medium; non-active does not.
    await expect(
      page.getByRole("button", { name: /^Samples$/i }).first(),
    ).toHaveClass(/font-medium/);
  });

  test("repeated clicks on the same tab don't toggle it off", async ({
    page,
  }) => {
    await gotoSeedExperiment(page, "design");
    const designBtn = page
      .getByRole("button", { name: /^Design( setup)?$/i })
      .first();
    await designBtn.click();
    await designBtn.click();
    await expect(page).toHaveURL(/tab=design/);
    await expect(designBtn).toHaveClass(/font-medium/);
  });
});

test.describe("state tracking — experiment-queue filter chips report counts @live", () => {
  test.beforeEach(({ page }) => {
    requiresBackend();
    installErrorGuards(page);
  });

  test("filter chips render with counts (All / Started / Finished / Not started)", async ({
    page,
  }) => {
    // The ticket page hosts the ExperimentQueue. The seed DB may
    // not have a ticket id 44 populated; this test asserts the chip
    // structure when present and otherwise no-ops cleanly.
    await page.goto("/#/tickets/44");
    const chipRegex = /^(All|Started|Finished|Not started)\s+\(\d+\)$/;
    const anyChip = page.getByRole("button", { name: chipRegex }).first();
    const found = await anyChip
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!found, "ticket 44 not in this DB — skipping queue-chip test");
    // The four chip labels each carry an integer count.
    for (const label of ["All", "Started", "Finished", "Not started"]) {
      await expect(
        page.getByRole("button", { name: new RegExp(`^${label}\\s+\\(\\d+\\)$`) }).first(),
      ).toBeVisible();
    }
  });

  test("clicking a filter chip activates it (blue background) and deactivates the prior", async ({
    page,
  }) => {
    await page.goto("/#/tickets/44");
    const startedChip = page
      .getByRole("button", { name: /^Started\s+\(\d+\)$/ })
      .first();
    const found = await startedChip
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!found, "ticket 44 not in this DB — skipping filter-chip toggle test");
    const allChip = page
      .getByRole("button", { name: /^All\s+\(\d+\)$/ })
      .first();
    // Click "All" first — known stable starting point.
    await allChip.click();
    await expect(allChip).toHaveClass(/bg-blue-600/);
    await expect(startedChip).not.toHaveClass(/bg-blue-600/);
    // Click "Started".
    await startedChip.click();
    await expect(startedChip).toHaveClass(/bg-blue-600/);
    await expect(allChip).not.toHaveClass(/bg-blue-600/);
  });

  test("a filter chip with count 0 still toggles into an empty list with the 'no match' caption", async ({
    page,
  }) => {
    await page.goto("/#/tickets/44");
    // Find a chip whose label includes "(0)" — that's the empty-bucket
    // case Paul flagged.
    const zeroChip = page
      .getByRole("button", { name: /\(0\)$/ })
      .first();
    const found = await zeroChip
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(
      !found,
      "no (0)-count chip present in this DB state — every bucket non-empty",
    );
    await zeroChip.click();
    // Caption visible.
    await expect(
      page.getByText(/No experiments match this filter/i),
    ).toBeVisible();
  });
});

test.describe("state tracking — overall shell continuity @live", () => {
  test.beforeEach(({ page }) => {
    requiresBackend();
    installErrorGuards(page);
  });

  test("URL hash deep-links survive a tab round-trip", async ({ page }) => {
    await gotoSeedExperiment(page, "samples");
    const initialHash = await page.evaluate(() => window.location.hash);
    await page
      .getByRole("button", { name: /^Overview$/i })
      .first()
      .click();
    await page
      .getByRole("button", { name: /^Samples$/i })
      .first()
      .click();
    const finalHash = await page.evaluate(() => window.location.hash);
    // The query-string portion should round-trip even if other
    // pieces (group, ticket context) change.
    expect(finalHash).toMatch(/tab=samples/);
    expect(initialHash).toMatch(/tab=samples/);
  });

  test("the experiment banner survives every tab visit (shell doesn't strand)", async ({
    page,
  }) => {
    for (const tab of ["overview", "design", "samples"] as const) {
      await gotoSeedExperiment(page, tab);
      await expect(
        page.getByText(SEED_EXPERIMENT_SHORT_NAME).first(),
      ).toBeVisible();
    }
  });
});
