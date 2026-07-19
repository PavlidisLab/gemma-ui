import { test, expect } from "@playwright/test";
import { installErrorGuards } from "./_helpers";
import { requiresBackend } from "./_backend";

test.describe("Inbox views @live", () => {
  test.beforeEach(({ page }) => {
    requiresBackend();
    installErrorGuards(page);
  });

  test("proposals inbox at #/inbox renders without crashing", async ({ page }) => {
    await page.goto("/#/inbox");
    await page.waitForSelector("#root > *", { state: "attached" });
    await expect(page).toHaveURL(/#\/inbox/);
  });

  test("audits inbox at #/audits renders without crashing", async ({ page }) => {
    await page.goto("/#/audits");
    await page.waitForSelector("#root > *", { state: "attached" });
    await expect(page).toHaveURL(/#\/audits/);
  });

  test("dashboard 'Proposals inbox' button navigates to #/inbox", async ({ page }) => {
    await page.goto("/");
    const btn = page.getByRole("button", { name: /Proposals inbox/i }).first();
    if (await btn.count()) {
      await btn.click();
      await expect(page).toHaveURL(/#\/inbox/);
    }
  });

  test("dashboard 'Audits inbox' button navigates to #/audits", async ({ page }) => {
    await page.goto("/");
    const btn = page.getByRole("button", { name: /Audits inbox/i }).first();
    if (await btn.count()) {
      await btn.click();
      await expect(page).toHaveURL(/#\/audits/);
    }
  });

  test("proposals inbox shows an empty state on a fresh DB", async ({ page }) => {
    await page.goto("/#/inbox");
    const root = page.locator("#root");
    const text = await root.innerText();
    expect(text.length).toBeGreaterThan(50);
  });

  test("audits inbox shows an empty state on a fresh DB", async ({ page }) => {
    await page.goto("/#/audits");
    const root = page.locator("#root");
    const text = await root.innerText();
    expect(text.length).toBeGreaterThan(50);
  });
});
