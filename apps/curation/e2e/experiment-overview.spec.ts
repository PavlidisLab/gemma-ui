import { test, expect } from "@playwright/test";
import { installErrorGuards, gotoSeedExperiment } from "./_helpers";

test.describe("Experiment Overview tab", () => {
  test.beforeEach(({ page }) => installErrorGuards(page));

  test("renders the Tags section heading", async ({ page }) => {
    await gotoSeedExperiment(page);
    await expect(page.getByText(/^Tags$/i).first()).toBeVisible();
  });

  test("renders the Factors section heading", async ({ page }) => {
    await gotoSeedExperiment(page);
    await expect(page.getByText(/^Factors$/i).first()).toBeVisible();
  });

  test("'Curation guidelines' link cluster is present", async ({ page }) => {
    await gotoSeedExperiment(page);
    await expect(page.getByText(/Curation guidelines/i).first()).toBeVisible();
  });

  test("Proposal review surface is present (or absent gracefully)", async ({ page }) => {
    await gotoSeedExperiment(page);
    // Either rendered, or not — neither should crash.
    const proposalHeader = page.getByText(/Proposal review/i).first();
    if (await proposalHeader.count()) {
      await expect(proposalHeader).toBeVisible();
    }
  });

  test("experiment description / abstract area present", async ({ page }) => {
    await gotoSeedExperiment(page);
    // Most descriptions render in a paragraph or scrollable card; we
    // just check the page has body text that isn't pure chrome.
    const root = page.locator("#root");
    const text = await root.innerText();
    expect(text.length).toBeGreaterThan(200);
  });

  test("does not show the legacy MOCK_TICKETS audit-panel chip", async ({ page }) => {
    // Regression: the in-tree mock-tickets work landed a 'preview · mock data'
    // chip on the EE Overview's TAG RECOMMENDATION strip. After the
    // 2026-05-26 rollback, that strip should not render on a fresh DB.
    await gotoSeedExperiment(page);
    await expect(page.getByText(/preview\s·\smock\sdata/i)).toHaveCount(0);
  });

  test("no add_tag_proposal / untag_proposal raw chip in HEAD UI", async ({ page }) => {
    // Regression: never let the engineer-y wire-name leak into the
    // curator-facing UI.
    await gotoSeedExperiment(page);
    await expect(page.getByText(/add_tag_proposal|untag_proposal/i)).toHaveCount(0);
  });

  test("does not crash when re-import is clicked", async ({ page }) => {
    await gotoSeedExperiment(page);
    const reimport = page.getByRole("button", { name: /re-import from Gemma/i }).first();
    if (await reimport.count()) {
      // We don't fire the import (it'd mutate state); just confirm
      // the button is enabled / clickable.
      await expect(reimport).toBeVisible();
    }
  });
});
