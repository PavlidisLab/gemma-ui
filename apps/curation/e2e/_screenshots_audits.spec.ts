import { test } from "@playwright/test";

const OUT = "screenshots";
test.describe.configure({ mode: "serial" });

test("GSE31160 EE shell — audit should now show", async ({ page }) => {
  await page.goto("/#/experiments/8895?ticket=1");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/30-ee-with-audit-add.png`, fullPage: true });
});

test("GSE66870 EE shell — REMOVE audit", async ({ page }) => {
  await page.goto("/#/experiments/12799?ticket=1");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/31-ee-with-audit-remove.png`, fullPage: true });
});
