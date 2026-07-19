import { test, expect } from "@playwright/test";
import {
  installErrorGuards,
  gotoSeedExperiment,
  tabButton,
  expectTabActive,
} from "./_helpers";
import { requiresBackend } from "./_backend";

test.describe("Experiment Design tab @live", () => {
  test.beforeEach(({ page }) => {
    requiresBackend();
    installErrorGuards(page);
  });

  test("'Design setup' tab activates when clicked", async ({ page }) => {
    await gotoSeedExperiment(page);
    await tabButton(page, "Design setup").click();
    await expectTabActive(page, "Design setup");
  });

  test("Design tab renders content (not blank)", async ({ page }) => {
    await gotoSeedExperiment(page, "design");
    const root = page.locator("#root");
    const text = await root.innerText();
    expect(text.length).toBeGreaterThan(100);
  });

  test("Design tab does not crash on the seed experiment", async ({ page }) => {
    await gotoSeedExperiment(page, "design");
    // No pageerror is the test (installErrorGuards). Confirm root mounted.
    await page.waitForSelector("#root > *", { state: "attached" });
  });

  test("Design tab URL deep-link preserves tab=design", async ({ page }) => {
    await gotoSeedExperiment(page, "design");
    await expect(page).toHaveURL(/tab=design/);
  });

  test("Switching from Overview → Design changes URL hash", async ({ page }) => {
    await gotoSeedExperiment(page);
    await tabButton(page, "Design setup").click();
    await expect(page).toHaveURL(/tab=design/);
  });

  test("Switching Design → Overview clears tab=design from the URL", async ({ page }) => {
    await gotoSeedExperiment(page, "design");
    await tabButton(page, "Overview").click();
    // tab=overview or no tab param at all — either is fine.
    await expect(page).not.toHaveURL(/tab=design/);
  });

  test("Design tab does not leak ticket-context UI", async ({ page }) => {
    await gotoSeedExperiment(page, "design");
    await expect(page.getByText(/TAG RECOMMENDATION/i)).toHaveCount(0);
    await expect(page.getByText(/Open ticket page/i)).toHaveCount(0);
  });
});
