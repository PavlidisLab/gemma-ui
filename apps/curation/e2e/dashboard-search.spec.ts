import { test, expect } from "@playwright/test";
import {
  SEED_EXPERIMENT_ID,
  SEED_EXPERIMENT_SHORT_NAME,
  installErrorGuards,
} from "./_helpers";
import { requiresBackend } from "./_backend";

/**
 * Dashboard quick-search + its handoff to the all-experiments browse
 * page. Covers the features added 2026-07-09:
 *   - the direct search box on the dashboard,
 *   - single-hit → open the experiment, else → browse with ?q= applied,
 *   - accession-aware matching shared with the browse filter,
 *   - the browse filter seeding from ?q=.
 *
 * The ticket gateway (a single hit on >1 open ticket → picker modal) is
 * NOT exercised here: the seed DB has 0 tickets, so there is no way to
 * reach the >1 branch. It's covered by the live/manual check noted in
 * project_dashboard_search_and_ticket_gateway_2026_07_09. What we can
 * assert on the seed DB is the 0-ticket branch: a single hit opens the
 * experiment plain (no ?ticket).
 *
 * Not tagged @critical — these run against the fresh seed DB in CI, not
 * the curator's live working DB.
 */
test.describe("Dashboard quick-search @live", () => {
  test.beforeEach(({ page }) => {
    requiresBackend();
    installErrorGuards(page);
  });

  test("renders a quick-search box with the accession-aware placeholder", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByPlaceholder(/find an experiment/i),
    ).toBeVisible();
  });

  test("a query with no matches hands off to the browse page with ?q= applied", async ({
    page,
  }) => {
    await page.goto("/");
    const box = page.getByPlaceholder(/find an experiment/i);
    const q = "zzz-no-such-accession-zzz";
    await box.fill(q);
    // The live match-count hint reads "no matches" before submit.
    await expect(page.getByText(/no matches/i)).toBeVisible();
    await box.press("Enter");
    // Hands off to browse with the query in the hash…
    await expect(page).toHaveURL(new RegExp(`#/all-experiments\\?q=${q}`));
    // …the browse filter is seeded from ?q=…
    await expect(
      page.locator("input[type='search']").first(),
    ).toHaveValue(q);
    // …and the browse empty-state confirms nothing matched.
    await expect(page.getByText(/No experiments/i).first()).toBeVisible();
  });

  test("a single-hit accession opens that experiment (0 tickets → plain)", async ({
    page,
  }) => {
    await page.goto("/");
    const box = page.getByPlaceholder(/find an experiment/i);
    await box.fill(SEED_EXPERIMENT_SHORT_NAME);
    // Exactly one match on the seed DB → the hint says it will open.
    await expect(page.getByText(/1 match .* opens/i)).toBeVisible();
    await box.press("Enter");
    // Seed experiment has no tickets, so it opens plain — no ?ticket.
    await expect(page).toHaveURL(
      new RegExp(`#/experiments/${SEED_EXPERIMENT_ID}(?!.*ticket)`),
    );
  });
});

test.describe("All-experiments browse — ?q handoff + accession filter @live", () => {
  test.beforeEach(({ page }) => {
    requiresBackend();
    installErrorGuards(page);
  });

  test("?q= seeds the browse filter box", async ({ page }) => {
    await page.goto(`/#/all-experiments?q=${SEED_EXPERIMENT_SHORT_NAME}`);
    await expect(
      page.locator("input[type='search']").first(),
    ).toHaveValue(SEED_EXPERIMENT_SHORT_NAME);
    await expect(
      page.getByText(SEED_EXPERIMENT_SHORT_NAME).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("filtering by accession narrows to the matching experiment", async ({
    page,
  }) => {
    await page.goto("/#/all-experiments");
    const filter = page.locator("input[type='search']").first();
    await filter.fill(SEED_EXPERIMENT_SHORT_NAME);
    await expect(
      page.getByText(SEED_EXPERIMENT_SHORT_NAME).first(),
    ).toBeVisible();
  });
});
