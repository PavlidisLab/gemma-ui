import { test, expect } from "@playwright/test";
import { installErrorGuards, SEED_EXPERIMENT_ID } from "./_helpers";

test.describe("Routing", () => {
  test.beforeEach(({ page }) => installErrorGuards(page));

  test("blank hash routes to the landing page", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#root > *", { state: "attached" });
    // Landing page features the Sets / Tickets / All data sections.
    await expect(page.getByRole("heading", { name: /^Tickets$/ })).toBeVisible();
  });

  test("'#/' routes to the landing page", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByRole("heading", { name: /^Tickets$/ })).toBeVisible();
  });

  test("unknown hash route renders something (no white screen)", async ({ page }) => {
    await page.goto("/#/this-route-does-not-exist");
    await page.waitForSelector("#root > *", { state: "attached" });
    const text = await page.locator("#root").innerText();
    expect(text.length).toBeGreaterThan(20);
  });

  test("EE shell preserves ?tab= across navigation", async ({ page }) => {
    await page.goto(`/#/experiments/${SEED_EXPERIMENT_ID}?tab=design`);
    await expect(page).toHaveURL(/tab=design/);
  });

  test("Browse-all preserves the URL hash on reload", async ({ page }) => {
    await page.goto("/#/all-experiments");
    await page.reload();
    await expect(page).toHaveURL(/#\/all-experiments/);
  });

  test("back-button after dashboard → all-experiments restores landing", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Browse all experiments/i }).click();
    await expect(page).toHaveURL(/#\/all-experiments/);
    await page.goBack();
    await expect(page.getByRole("heading", { name: /^Tickets$/ })).toBeVisible();
  });
});
