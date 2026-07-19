import { test, expect } from "@playwright/test";
import {
  SEED_EXPERIMENT_ID,
  SEED_EXPERIMENT_SHORT_NAME,
  installErrorGuards,
} from "./_helpers";
import { requiresBackend } from "./_backend";

// @live: reads the real experiment listing from the store. Skips when
// the backend is down (see _backend.ts); excluded from the pre-commit gate.
test.describe("All experiments page @live", () => {
  test.beforeEach(({ page }) => {
    requiresBackend();
    installErrorGuards(page);
  });

  test("mounts via dashboard's 'Browse all experiments' button", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Browse all experiments/i }).click();
    await expect(page).toHaveURL(/#\/all-experiments/);
  });

  test("direct navigation to #/all-experiments works", async ({ page }) => {
    await page.goto("/#/all-experiments");
    await expect(page).toHaveURL(/#\/all-experiments/);
  });

  test("shows the seed experiment in the listing", async ({ page }) => {
    await page.goto("/#/all-experiments");
    await expect(
      page.getByText(SEED_EXPERIMENT_SHORT_NAME).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("clicking a row navigates to the experiment shell", async ({ page }) => {
    await page.goto("/#/all-experiments");
    await page.getByText(SEED_EXPERIMENT_SHORT_NAME).first().click();
    await expect(page).toHaveURL(new RegExp(`#/experiments/${SEED_EXPERIMENT_ID}`));
  });

  test("page renders without crashing on empty filters", async ({ page }) => {
    await page.goto("/#/all-experiments");
    await page.waitForSelector("#root > *", { state: "attached" });
    await expect(page.locator("#root > *").first()).toBeAttached();
  });

  test("search box is present (if the list view exposes one)", async ({ page }) => {
    await page.goto("/#/all-experiments");
    const search = page.locator("input[type='search'], input[placeholder*='search' i]");
    if (await search.count()) {
      await expect(search.first()).toBeVisible();
    }
  });

  test("'back' to dashboard works via header link if present", async ({ page }) => {
    await page.goto("/#/all-experiments");
    const dashLink = page.getByRole("link", { name: /dashboard|home|gemma/i }).first();
    if (await dashLink.count()) {
      await dashLink.click();
      await expect(page).toHaveURL(/#\/?$|#$|\/$/);
    }
  });

  test("page title remains Gemma curation", async ({ page }) => {
    await page.goto("/#/all-experiments");
    await expect(page).toHaveTitle(/Gemma curation/i);
  });
});
