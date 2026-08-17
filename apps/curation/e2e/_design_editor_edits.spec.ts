/**
 * Playwright spec — the design editor's own edits, and their undo.
 *
 * Everything the proposer applies lands here, but the editor itself had
 * only @live smoke tests ("renders content (not blank)"). The
 * behaviours a curator actually depends on — a rename keeps the
 * value's identity, a delete is revertable rather than destructive,
 * each edit can be undone without disturbing its siblings — were
 * unpinned.
 *
 * Assertions run against the CommitBar's diff summary and the
 * `data-audit-target` stamp on each value card. Both are production
 * surfaces, not test hooks: the stamp is the same `fv:<factor>/<label>#<id>`
 * slug the agent side addresses findings by, so asserting on it also
 * pins the cross-repo identity contract.
 *
 * Anchor: GSE165287 (id 40086), ticket-55, frozen in
 * ``e2e/hars/exp-40086.zip`` — a 6-value `organism part` factor over
 * 60 samples.
 *
 * Re-record with: PWHAR_UPDATE=1 npm run e2e -- e2e/_design_editor_edits.spec.ts --workers=1
 */
import { expect, test, type Page } from "@playwright/test";
import { mockExperiment } from "./_mocks";

const TARGET =
  "/#/experiments/40086?tab=design&ticket=55&base=polished%3Aconsensus_strict_consensus&cmp=agent_proposal";

const FIRST_VALUE_ID = "91000000";

function commitBar(page: Page) {
  return page.getByText("uncommitted", { exact: true });
}

function draftSummary(page: Page) {
  return page
    .locator('[title*="deleted"], [title*="new "], [title*="modified"]')
    .first();
}

/** Live (non-tombstone) value cards — a deleted value keeps its
 *  article but loses the Duplicate button. */
function valueCards(page: Page) {
  return page
    .locator("article[data-audit-target]")
    .filter({ has: page.getByRole("button", { name: /^Duplicate$/ }) });
}

function tombstones(page: Page) {
  return page
    .locator("article[data-audit-target]")
    .filter({ hasNot: page.getByRole("button", { name: /^Duplicate$/ }) });
}

function stampsOf(page: Page): Promise<string[]> {
  return page
    .locator("article[data-audit-target]")
    .evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-audit-target") ?? ""),
    );
}

/** Rename a value in place. The label is an `InlineText` — a DOUBLE
 *  click swaps it for an input that commits on Enter. */
async function renameFirstValue(page: Page, to: string) {
  const card = valueCards(page).first();
  await card.locator("span.cursor-text").first().dblclick();
  const input = card.locator("input").first();
  await input.waitFor({ state: "visible" });
  await input.fill(to);
  await input.press("Enter");
  await expect(commitBar(page)).toBeVisible();
}

test.describe("Design editor — edits and their undo @critical", () => {
  test.beforeEach(async ({ page }) => {
    await mockExperiment(page, "exp-40086");
    await page.addInitScript(() => window.localStorage.clear());
    await page.setViewportSize({ width: 1600, height: 1600 });
    await page.goto(TARGET);
    await page.waitForSelector("#root > *", { state: "attached" });
    await page.waitForTimeout(4500);
    await expect(valueCards(page)).toHaveCount(6);
    await expect(commitBar(page)).toHaveCount(0);
  });

  test("a rename moves the slug and keeps the value's id", async ({ page }) => {
    await renameFirstValue(page, "left frontal cortex");

    await expect(draftSummary(page)).toHaveText(/1 modified FV\b/);
    const stamps = await stampsOf(page);
    // The slug follows the label …
    expect(stamps).toContain(
      `fv:organism-part/left-frontal-cortex#${FIRST_VALUE_ID}`,
    );
    // … and the id it carries — what every downstream reference is
    // keyed on — does not move.
    expect(
      stamps.filter((s) => s.endsWith(`#${FIRST_VALUE_ID}`)),
    ).toHaveLength(1);
    // A rename is not a replace.
    await expect(valueCards(page)).toHaveCount(6);
    await expect(tombstones(page)).toHaveCount(0);
  });

  test("the per-value Undo discards that edit and nothing else", async ({
    page,
  }) => {
    await renameFirstValue(page, "left frontal cortex");
    const card = valueCards(page).first();
    await card.getByRole("button", { name: /Undo/ }).click();

    // Clean draft — the chip is absent, not merely emptied.
    await expect(commitBar(page)).toHaveCount(0);
    expect(await stampsOf(page)).toContain(
      `fv:organism-part/frontal-cortex-located-in-left-hemisphere#${FIRST_VALUE_ID}`,
    );
    await expect(valueCards(page)).toHaveCount(6);
  });

  test("deleting a value confirms first, then leaves a revertable tombstone", async ({
    page,
  }) => {
    await valueCards(page)
      .first()
      .getByRole("button", { name: /^Delete$/ })
      .click();

    // A destructive edit goes through the shared confirm rather than
    // vanishing on one click.
    const confirm = page.getByRole("dialog");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: /^Delete$/ }).click();

    await expect(valueCards(page)).toHaveCount(5);
    await expect(tombstones(page)).toHaveCount(1);
    await expect(draftSummary(page)).toHaveText(/1 deleted FV\b/);
    // The deleted value stays on screen, marked, rather than
    // disappearing — nothing is actually lost until commit.
    await expect(tombstones(page)).toContainText("deleted (uncommitted)");

    await tombstones(page).getByRole("button", { name: /Undo/ }).click();
    await expect(valueCards(page)).toHaveCount(6);
    await expect(commitBar(page)).toHaveCount(0);
  });

  test("cancelling the delete confirm keeps the value", async ({ page }) => {
    await valueCards(page)
      .first()
      .getByRole("button", { name: /^Delete$/ })
      .click();
    await page.getByRole("dialog").getByRole("button", { name: /^cancel$/ }).click();

    await expect(valueCards(page)).toHaveCount(6);
    await expect(commitBar(page)).toHaveCount(0);
  });

  test("an added value arrives empty without stealing samples", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /^\+ value$/ }).click();

    await expect(valueCards(page)).toHaveCount(7);
    await expect(draftSummary(page)).toHaveText(/1 new FV\b/);
    // Every sample stays where it was — an added value must not
    // silently take any, and the factor's coverage is unchanged so no
    // "unassigned" warning is due either.
    await expect(page.getByText(/⚠ \d+ unassigned/)).toHaveCount(0);
  });

  test("the factor-level revert undoes every edit under it at once", async ({
    page,
  }) => {
    await renameFirstValue(page, "left frontal cortex");
    await page.getByRole("button", { name: /^\+ value$/ }).click();
    await expect(valueCards(page)).toHaveCount(7);

    // The factor row's own revert — "discard every uncommitted edit on
    // this factor (name, category, type, description, all FVs)".
    await page
      .locator('button[title^="discard every uncommitted edit on this factor"]')
      .first()
      .click();

    // It confirms first, and says plainly that it reaches past the
    // field the curator last touched. A bulk undo that fired on one
    // click would be the wrong default here.
    const confirm = page.getByRole("dialog");
    await expect(confirm).toContainText(
      /undoes any factor values you've added, edited, or removed/,
    );
    await confirm.getByRole("button", { name: /^revert factor$/ }).click();

    await expect(valueCards(page)).toHaveCount(6);
    await expect(commitBar(page)).toHaveCount(0);
    expect(await stampsOf(page)).toContain(
      `fv:organism-part/frontal-cortex-located-in-left-hemisphere#${FIRST_VALUE_ID}`,
    );
  });
});
