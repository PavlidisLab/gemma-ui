import { expect, test } from "@playwright/test";

import { mockGemma, DATASET, SAMPLES } from "./_mocks";

/**
 * The dataset page end to end.
 *
 * Covers the two pieces of the page that landed most recently and had
 * nothing rendering under test: the header's library line, read off the
 * payload's own tallies, and the samples table's description column,
 * which shows GEO's own sentence about each sample and appears only
 * when some sample carries text.
 */
test.describe("dataset page @critical", () => {
  test.beforeEach(async ({ page }) => {
    await mockGemma(page);
  });

  test("names the dataset and what kind of data it is", async ({ page }) => {
    await page.goto("/#/dataset/1658");
    // The accession is a plain span beside the title's <h1> — see the
    // header's own note about why it is not a link.
    await expect(
      page.getByText(DATASET.shortName, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: DATASET.name }),
    ).toBeVisible();
    // From `libraryStrategies` on the payload, not from a per-sample
    // sweep — the samples fixture would give the same answer, so the
    // wire-level assertion for that lives in the render test.
    await expect(page.getByText("RNA-Seq").first()).toBeVisible();
  });

  test("the samples tab shows GEO's description of each sample", async ({
    page,
  }) => {
    await page.goto("/#/dataset/1658");
    await page.getByRole("button", { name: /^Samples/ }).click();
    // The accession appears twice per row — the name cell and the GEO
    // link — so this takes the first rather than asserting on a count
    // that is about layout, not about the description.
    await expect(
      page.getByText(SAMPLES[0].accession.accession).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Whole blood, patient 1, before the procedure"),
    ).toBeVisible();
  });

  test("an unknown dataset does not render an empty page", async ({ page }) => {
    // 🛑 Gemma answers a missing id with an EMPTY collection, not a
    // 404, so "no such dataset" and "the server has nothing to say
    // about this one" arrive identically. The page must say something
    // either way rather than render its chrome around a blank.
    await mockGemma(page, { dataset: undefined, datasets: [] });
    await page.route("**/rest/v2/datasets/999999*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [], totalElements: 0 }),
      }),
    );
    await page.goto("/#/dataset/999999");
    await expect(page.getByText(/not found|no dataset|couldn't|could not/i).first()).toBeVisible();
  });
});
