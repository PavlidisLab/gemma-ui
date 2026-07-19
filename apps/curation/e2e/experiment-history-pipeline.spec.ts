import { test, expect } from "@playwright/test";
import {
  installErrorGuards,
  gotoSeedExperiment,
  tabButton,
  expectTabActive,
} from "./_helpers";
import { requiresBackend } from "./_backend";

test.describe("Experiment shell — History tab @live", () => {
  test.beforeEach(({ page }) => {
    requiresBackend();
    installErrorGuards(page);
  });

  test("History tab deep-links via ?tab=history", async ({ page }) => {
    await gotoSeedExperiment(page, "history");
    await expect(page).toHaveURL(/tab=history/);
  });

  test("History tab body renders", async ({ page }) => {
    await gotoSeedExperiment(page, "history");
    await page.waitForSelector("#root > *", { state: "attached" });
    const text = await page.locator("#root").innerText();
    expect(text.length).toBeGreaterThan(80);
  });

  test("History tab does not leak ticket UI", async ({ page }) => {
    await gotoSeedExperiment(page, "history");
    await expect(page.getByText(/Open ticket page/i)).toHaveCount(0);
  });

  test("History → Overview switch works", async ({ page }) => {
    await gotoSeedExperiment(page, "history");
    await tabButton(page, "Overview").click();
    await expect(page).not.toHaveURL(/tab=history/);
  });
});

test.describe("Experiment shell — Pipeline tab @live", () => {
  test.beforeEach(({ page }) => {
    requiresBackend();
    installErrorGuards(page);
  });

  test("Pipeline tab deep-links via ?tab=pipeline", async ({ page }) => {
    await gotoSeedExperiment(page, "pipeline");
    await expect(page).toHaveURL(/tab=pipeline/);
  });

  test("Pipeline tab body renders", async ({ page }) => {
    await gotoSeedExperiment(page, "pipeline");
    await page.waitForSelector("#root > *", { state: "attached" });
    const text = await page.locator("#root").innerText();
    expect(text.length).toBeGreaterThan(80);
  });

  test("Pipeline tab tab-bar shows it selected", async ({ page }) => {
    await gotoSeedExperiment(page, "pipeline");
    await expectTabActive(page, "Pipeline");
  });

  test("Pipeline tab does not crash on empty pipeline state", async ({ page }) => {
    await gotoSeedExperiment(page, "pipeline");
    // No pageerror is the test.
    await page.waitForSelector("#root > *", { state: "attached" });
  });
});
