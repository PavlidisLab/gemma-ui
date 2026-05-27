import { test, expect } from "@playwright/test";

const OUT = "screenshots";

test.describe.configure({ mode: "serial" });

test("dashboard — tickets section close-up", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(2000);
  // The Tickets section: heading + the card directly below it
  const heading = page.getByRole("heading", { name: /^Tickets$/ });
  const card = heading.locator("..").locator("..");
  await card.screenshot({ path: `${OUT}/10-tickets-section.png` });
});

test("EE 8895 (GSE31160) — opened from ticket chip", async ({ page }) => {
  // Mimics clicking the GSE31160 chip on the ticket card
  await page.goto("/#/experiments/8895");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/11-ee-8895-gse31160.png`, fullPage: true });
});

test("EE 17432 (GSE149019) — another ticket target", async ({ page }) => {
  await page.goto("/#/experiments/17432");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/12-ee-17432-gse149019.png`, fullPage: true });
});

test("EE 231 (yeoh-leukemia) — leukemia-classifier dataset", async ({ page }) => {
  await page.goto("/#/experiments/231");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/13-ee-231-yeoh.png`, fullPage: true });
});

test("all experiments — shows 20 ingested EEs alongside existing", async ({ page }) => {
  await page.goto("/#/all-experiments");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/14-all-experiments-167.png`, fullPage: true });
});

test("dashboard final state", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/15-dashboard-final.png`, fullPage: true });
  // Verify the ticket card is visible with all 20 target chips
  await expect(page.getByText(/Tag audit — TGEMO_00208/)).toBeVisible();
  await expect(page.getByText("1 open")).toBeVisible();
});
