import { test } from "@playwright/test";
import { requiresBackend } from "./_backend";

const OUT = "screenshots";
test.describe.configure({ mode: "serial" });

test.beforeEach(() => requiresBackend());

test("GSE31160 EE shell — audit should now show @live", async ({ page }) => {
  await page.goto("/#/experiments/8895?ticket=1");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/30-ee-with-audit-add.png`, fullPage: true });
});

test("GSE66870 EE shell — REMOVE audit @live", async ({ page }) => {
  await page.goto("/#/experiments/12799?ticket=1");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/31-ee-with-audit-remove.png`, fullPage: true });
});
