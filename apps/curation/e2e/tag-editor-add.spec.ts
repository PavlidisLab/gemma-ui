import { test, expect, type Page } from "@playwright/test";
import { installErrorGuards, gotoSeedExperiment } from "./_helpers";
import { requiresBackend } from "./_backend";

/**
 * Regression: adding a tag via the Overview "+ tag" editor
 * (``StatementEditModal``) must not lose already-entered fields when
 * the surrounding ``TagBar`` re-renders mid-edit.
 *
 * The bug (2026-07-19, Paul: "I just put in a predicate, and it erased
 * my category and subject" while adding a *treatment · cell derived
 * from MMTV mouse strain* tag): the modal re-seeded its internal draft
 * on every change of the ``initial`` prop *identity*. In add mode the
 * parent handed a fresh object literal on every render, so any
 * background re-render of ``TagBar`` (a TanStack-Query refocus refetch,
 * a draft-context tick) while the modal was open wiped the curator's
 * in-progress category / subject / pairs back to empty.
 *
 * The fix seeds the draft only on the closed→open rising edge. This
 * spec drives the real add-tag flow and forces a background re-render
 * between filling the subject and touching the predicate — the exact
 * interleaving that used to wipe the fields.
 *
 * ``@live``: exercises the real Overview shell against the seed
 * experiment in the store (the editable, non-review TagBar only exists
 * with real design-draft data). Skips when the backend is down.
 */

/** Force the incidental ``TagBar`` re-render that the mid-edit wipe
 *  rode on. In real use it came from a background query settling; here
 *  we bump a benign hash param, which App.tsx turns into a
 *  ``startTransition(setRoute(parseRoute()))`` — re-rendering the whole
 *  experiment shell (and TagBar) in place, without remounting (same
 *  experiment id keeps the open modal alive). ``parseRoute`` ignores
 *  the extra param, so nothing else in the app reacts to it. */
async function forceBackgroundRerender(page: Page) {
  await page.evaluate(() => {
    const h = window.location.hash;
    const bumped = h.includes("_r=")
      ? h.replace(/_r=\d+/, (m) => `_r=${Number(m.slice(3)) + 1}`)
      : h + (h.includes("?") ? "&" : "?") + "_r=1";
    window.location.hash = bumped;
  });
  await page.waitForTimeout(300);
}

test.describe("Overview add-tag editor @live", () => {
  test.beforeEach(({ page }) => {
    requiresBackend();
    installErrorGuards(page);
  });

  test("keeps category + subject after touching the predicate", async ({
    page,
  }) => {
    await gotoSeedExperiment(page);

    // Open the add-tag modal from the TagBar.
    const addBtn = page.getByRole("button", { name: /\+ tag/ }).first();
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    const modal = page.getByText("Add tag").first();
    await expect(modal).toBeVisible();

    // Category — double-click the placeholder span to edit, type, Enter.
    await page.getByText("category", { exact: true }).first().dblclick();
    const catInput = page.getByPlaceholder("category");
    await catInput.fill("treatment");
    await catInput.press("Enter");
    await expect(page.getByText("treatment").first()).toBeVisible();

    // Subject — single click opens the term picker; commit free text on blur.
    await page.getByText("subject", { exact: true }).first().click();
    const subjInput = page.getByPlaceholder("subject");
    await subjInput.fill("cell derived from MMTV mouse strain");
    // Blur commits (100ms deferred) — click the neutral modal title.
    await modal.click();
    await expect(
      page.getByText("cell derived from MMTV mouse strain").first(),
    ).toBeVisible();

    // The interleaving that used to wipe the draft: a background
    // re-render lands while the modal is open, BEFORE the predicate edit.
    await forceBackgroundRerender(page);

    // Touch the predicate: reveal the pair row and pick a relation.
    await page.getByRole("button", { name: /add predicate/ }).first().click();
    const predicate = page.getByRole("combobox").first();
    await expect(predicate).toBeVisible();
    // Pick the first real predicate (index 1 — index 0 is the "predicate"
    // placeholder option).
    const options = predicate.locator("option");
    const secondLabel = (await options.nth(1).textContent())?.trim() ?? "";
    await predicate.selectOption({ index: 1 });

    // The regression assertion: category + subject survive the predicate
    // edit and the background re-render.
    await expect(page.getByText("treatment").first()).toBeVisible();
    await expect(
      page.getByText("cell derived from MMTV mouse strain").first(),
    ).toBeVisible();

    // And Save is enabled (subject is non-empty) — the editor is usable.
    await expect(page.getByRole("button", { name: /^Save$/ })).toBeEnabled();
    // Predicate really took (sanity that we exercised it).
    expect(secondLabel.length).toBeGreaterThan(0);
  });
});
