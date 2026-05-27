import { test, expect } from "@playwright/test";
import {
  SEED_EXPERIMENT_ID,
  SEED_EXPERIMENT_SHORT_NAME,
  installErrorGuards,
  gotoSeedExperiment,
  tabButton,
  expectTabActive,
} from "./_helpers";

const TAB_LABELS = [
  "Overview",
  "Design setup",
  "Sample details",
  "Quality control",
  "Diagnostics",
  "Quantitation types",
  "History",
  "Pipeline",
];

test.describe("Experiment shell", () => {
  test.beforeEach(({ page }) => installErrorGuards(page));

  test("mounts when navigated by experiment id", async ({ page }) => {
    await gotoSeedExperiment(page);
    await expect(page).toHaveURL(new RegExp(`#/experiments/${SEED_EXPERIMENT_ID}`));
  });

  test("renders the accession in the banner", async ({ page }) => {
    await gotoSeedExperiment(page);
    await expect(page.getByText(SEED_EXPERIMENT_SHORT_NAME).first()).toBeVisible();
  });

  test("renders the GEO accession (without subseries suffix)", async ({ page }) => {
    await gotoSeedExperiment(page);
    await expect(page.getByText(/GSE277245/).first()).toBeVisible();
  });

  for (const label of TAB_LABELS) {
    test(`tab '${label}' is rendered in the tab bar`, async ({ page }) => {
      await gotoSeedExperiment(page);
      await expect(tabButton(page, label)).toBeVisible({ timeout: 10_000 });
    });
  }

  test("Overview is the default tab", async ({ page }) => {
    await gotoSeedExperiment(page);
    await expectTabActive(page, "Overview");
  });

  test("clicking 'Design setup' switches the active tab", async ({ page }) => {
    await gotoSeedExperiment(page);
    await tabButton(page, "Design setup").click();
    await expect(page).toHaveURL(/tab=design/);
  });

  test("URL ?tab= deep-link mounts the right tab", async ({ page }) => {
    await gotoSeedExperiment(page, "samples");
    await expectTabActive(page, "Sample details");
  });

  test("opening a non-existent experiment doesn't crash the app", async ({ page }) => {
    page.removeAllListeners("pageerror");
    page.removeAllListeners("console");
    // Reinstall a more permissive guard for this single test.
    page.on("pageerror", (e) => {
      throw new Error(`pageerror: ${e.message}`);
    });
    await page.goto("/#/experiments/99999999");
    // App should mount SOMETHING — either an empty/error state or
    // a partially-rendered shell. The hard requirement is no
    // pageerror.
    await page.waitForSelector("#root > *", { state: "attached", timeout: 10_000 });
  });
});
