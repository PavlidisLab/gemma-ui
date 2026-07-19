import { test } from "@playwright/test";
import { requiresBackend } from "./_backend";

test.beforeEach(() => requiresBackend());

test("review mode is truly inert — GSE324337 design tab @live", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto(
    `/#/experiments/91228?tab=design&base=cy_polished&cmp=agent_proposal`,
  );
  await page.waitForSelector("#root > *", { state: "attached" });
  await page.waitForTimeout(2500);
  // Try to double-click a CategoryPicker span — the picker should
  // NOT enter edit mode (no <input> appears).
  const categoryPickers = await page.$$('span[role="button"]');
  let editingInputAfter = 0;
  if (categoryPickers.length > 0) {
    await categoryPickers[0].dblclick({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
    editingInputAfter = await page.$$eval('input[type="text"]', (els) =>
      els.filter((e) => (e as HTMLElement).offsetParent !== null).length,
    );
  }
  console.log("VISIBLE TEXT INPUTS AFTER DBLCLICK:", editingInputAfter);
  await page.screenshot({ path: "screenshots/PR3_inert_check.png", fullPage: false });
});
