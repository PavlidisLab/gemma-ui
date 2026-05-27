import { test, expect } from "@playwright/test";

const OUT = "screenshots";
test.describe.configure({ mode: "serial" });

test("dashboard — sets retired, ticket with progress bar", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/20-dashboard-no-sets.png`, fullPage: true });
});

test("click ticket → opens detail page", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(1500);
  const card = page.getByText(/Tag audit — TGEMO_00208/).locator("..").locator("..");
  await card.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/21-ticket-detail.png`, fullPage: true });
  await expect(page).toHaveURL(/#\/tickets\/1/);
});

test("direct nav to /#/tickets/1", async ({ page }) => {
  await page.goto("/#/tickets/1");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/22-ticket-detail-direct.png`, fullPage: true });
  await expect(page.getByText(/Tag audit — TGEMO_00208/)).toBeVisible();
  await expect(page.getByText("0/20 done")).toBeVisible();
});

test("ticket detail shows all 20 targets as rows", async ({ page }) => {
  await page.goto("/#/tickets/1");
  await page.waitForTimeout(2000);
  // Count "not started" badges
  const badges = page.getByText(/^not started$/);
  await expect(badges.first()).toBeVisible();
  const count = await badges.count();
  expect(count).toBe(20);
});
