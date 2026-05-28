import { test } from "@playwright/test";

test("design tab honors baseline=cy_polished — GSE315354", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(
    `/#/experiments/91635?tab=design&base=cy_polished&cmp=agent_proposal`,
  );
  await page.waitForSelector("#root > *", { state: "attached" });
  await page.waitForTimeout(3000);
  await page.screenshot({
    path: "screenshots/PR3_design_tab_cy_baseline.png",
    fullPage: false,
  });
});
