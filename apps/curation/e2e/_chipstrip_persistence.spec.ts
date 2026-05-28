import { test, expect } from "@playwright/test";
import { SEED_EXPERIMENT_ID } from "./_helpers";

test("chip state survives tab switch", async ({ page }) => {
  // Open with explicit chip selection.
  await page.goto(
    `/#/experiments/${SEED_EXPERIMENT_ID}?tab=design&cmp=empty`,
  );
  await page.waitForSelector("#root > *", { state: "attached" });
  await page.waitForTimeout(1500);

  // Click the Sample details tab. ExperimentBanner's tab bar fires
  // onTabChange — under Gotcha #6 fix that callback now threads the
  // chip state through experimentRoute.
  await page.getByRole("button", { name: /sample details/i }).click();
  await page.waitForTimeout(400);

  // URL hash must still carry ?cmp=empty.
  const hash = await page.evaluate(() => window.location.hash);
  expect(hash).toContain("cmp=empty");
  expect(hash).toContain("tab=samples");
});
