import { expect, test } from "@playwright/test";

import { mockGemma, DATASET, OTHER_DATASET } from "./_mocks";

/**
 * The browse page end to end — the app as built and served, with the
 * backend pinned.
 *
 * What this adds over the jsdom render test of the same page: the real
 * router with real hash URLs, real CSS (so a row that renders but is
 * not visible fails here and passes there), and the navigation into the
 * dataset page, which is the one path every visitor takes.
 */
test.describe("browse @critical", () => {
  test.beforeEach(async ({ page }) => {
    await mockGemma(page);
  });

  test("lists the datasets the server returned", async ({ page }) => {
    await page.goto("/#/browser");
    await expect(page.getByText(DATASET.shortName)).toBeVisible();
    await expect(page.getByText(OTHER_DATASET.shortName)).toBeVisible();
    await expect(page.getByText(OTHER_DATASET.name)).toBeVisible();
  });

  test("a typed query goes to the server as query=", async ({ page }) => {
    const calls: string[] = [];
    await mockGemma(page, { calls });
    await page.goto("/#/browser");
    await expect(page.getByText(DATASET.shortName)).toBeVisible();

    await page.getByPlaceholder(/search/i).first().fill("coronary");
    await page.keyboard.press("Enter");

    await expect
      .poll(() =>
        calls.some((u) => /\/rest\/v2\/datasets\?/.test(u) && u.includes("query=coronary")),
      )
      .toBe(true);
  });

  test("a row opens the dataset page", async ({ page }) => {
    await page.goto("/#/browser");
    await page.getByText(DATASET.shortName).first().click();
    // The hash IS the route here (see CLAUDE.md, "Routing"), so a
    // navigation that lost the fragment would land on the home page
    // with no error anywhere.
    await expect(page).toHaveURL(/#\/dataset\/1658/);
    await expect(
      page.getByText(DATASET.shortName, { exact: true }).first(),
    ).toBeVisible();
  });
});
