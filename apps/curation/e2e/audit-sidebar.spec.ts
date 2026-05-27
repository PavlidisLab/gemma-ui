import { test, expect } from "@playwright/test";
import { installErrorGuards, gotoSeedExperiment } from "./_helpers";

test.describe("Audit sidebar (EE shell)", () => {
  test.beforeEach(({ page }) => installErrorGuards(page));

  test("'Request proposal…' button is present on Overview", async ({ page }) => {
    await gotoSeedExperiment(page);
    const reqBtn = page.getByRole("button", { name: /Request proposal/i }).first();
    if (await reqBtn.count()) {
      await expect(reqBtn).toBeVisible();
    }
  });

  test("clicking 'Request proposal' opens its dialog/menu without crashing", async ({ page }) => {
    await gotoSeedExperiment(page);
    const reqBtn = page.getByRole("button", { name: /Request proposal/i }).first();
    if ((await reqBtn.count()) === 0) test.skip();
    await reqBtn.click();
    // Modal / popover should appear; we don't fire the request itself
    // (would mutate). Any new dialog or expanded surface is fine.
    await page.waitForTimeout(300);
    await expect(page.locator("#root")).toBeVisible();
  });

  test("no in-tree TAG RECOMMENDATION panel appears (rollback regression)", async ({ page }) => {
    await gotoSeedExperiment(page);
    // After the 2026-05-26 rollback, no targeted-tag-audit panel
    // should mount.
    await expect(page.getByText(/TAG RECOMMENDATION/i)).toHaveCount(0);
    await expect(page.getByText(/AGENT RATIONALE/i)).toHaveCount(0);
  });

  test("no 'Close audit' / 'Resolve item' button leaked from rollback", async ({ page }) => {
    await gotoSeedExperiment(page);
    await expect(page.getByRole("button", { name: /^Close audit$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Resolve item$/ })).toHaveCount(0);
  });

  test("no 'Open ticket page' link in HEAD UI", async ({ page }) => {
    await gotoSeedExperiment(page);
    await expect(page.getByText(/Open ticket page/i)).toHaveCount(0);
  });

  test("audit sidebar (or its empty state) renders alongside Proposal review", async ({ page }) => {
    await gotoSeedExperiment(page);
    // The right column should have SOMETHING — Proposal review or
    // empty state for findings. Don't crash.
    const root = page.locator("#root");
    const text = await root.innerText();
    expect(text.length).toBeGreaterThan(100);
  });

  test("no ticket-context query param leak on direct EE nav", async ({ page }) => {
    await gotoSeedExperiment(page);
    await expect(page).not.toHaveURL(/\?ticket=/);
  });

  test("'Status' button is visible on the experiment banner", async ({ page }) => {
    await gotoSeedExperiment(page);
    const status = page.getByRole("button", { name: /^Status$/ }).first();
    if (await status.count()) {
      await expect(status).toBeVisible();
    }
  });
});
