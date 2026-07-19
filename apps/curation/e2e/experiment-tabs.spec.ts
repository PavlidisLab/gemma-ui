import { test, expect } from "@playwright/test";
import {
  installErrorGuards,
  gotoSeedExperiment,
  tabButton,
  expectTabActive,
} from "./_helpers";
import { requiresBackend } from "./_backend";

const TABS_WITH_HASHES: { id: string; label: string }[] = [
  { id: "design", label: "Design setup" },
  { id: "samples", label: "Sample details" },
  { id: "qc", label: "Quality control" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "quantitation", label: "Quantitation types" },
  { id: "history", label: "History" },
  { id: "pipeline", label: "Pipeline" },
];

test.describe("Experiment shell — per-tab smoke @live", () => {
  test.beforeEach(({ page }) => {
    requiresBackend();
    installErrorGuards(page);
  });

  for (const { id, label } of TABS_WITH_HASHES) {
    test(`'${label}' tab mounts via deep-link without crashing`, async ({ page }) => {
      await gotoSeedExperiment(page, id);
      await expectTabActive(page, label);
      await page.waitForSelector("#root > *", { state: "attached" });
    });

    test(`'${label}' tab mounts via click without crashing`, async ({ page }) => {
      await gotoSeedExperiment(page);
      await tabButton(page, label).click();
      await expect(page).toHaveURL(new RegExp(`tab=${id}`));
    });
  }

  test("'History' tab renders an events container (or empty state)", async ({ page }) => {
    await gotoSeedExperiment(page, "history");
    // History tab should mount; we don't require N events on a fresh DB.
    const root = page.locator("#root");
    const text = await root.innerText();
    expect(text.length).toBeGreaterThan(50);
  });

  test("'Pipeline' tab renders the pipeline-step UI shell", async ({ page }) => {
    await gotoSeedExperiment(page, "pipeline");
    const root = page.locator("#root");
    const text = await root.innerText();
    expect(text.length).toBeGreaterThan(50);
  });

  test("'Quality control' tab renders even with no QC data", async ({ page }) => {
    await gotoSeedExperiment(page, "qc");
    const root = page.locator("#root");
    const text = await root.innerText();
    expect(text.length).toBeGreaterThan(50);
  });
});
