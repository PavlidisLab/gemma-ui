/**
 * Playwright spec — "Choose what to adopt" on a partition-mismatch card.
 *
 * The bug this whole surface exists to prevent is SILENT: the curator
 * clicks a verdict, the disposition records, and the design never
 * changes (GSE96826 / eid 15112, 2026-08-17). A unit test on the
 * planner can't catch that — the failure lives in the wiring between
 * the card, the dialog and the design draft. So every test here that
 * applies something asserts on the DESIGN EDITOR, not on the card.
 *
 * Anchor experiment: GSE165287 (id 40086), ticket-55, frozen in
 * ``e2e/hars/exp-40086.zip``. Its proposal carries a
 * ``calibration_factor_partition_mismatch`` on ``organism part``:
 * Gemma has 6 hemisphere-split values, the agent proposes 3 combined
 * ones over the same 60 samples. Both sides agree on the category, so
 * no Category row renders here — that is asserted, not assumed.
 *
 * Re-record with: PWHAR_UPDATE=1 npm run e2e -- e2e/_partition_adopt_picker.spec.ts --workers=1
 */
import { expect, test, type Page } from "@playwright/test";
import { mockExperiment } from "./_mocks";

const TARGET =
  "/#/experiments/40086?tab=design&ticket=55&base=polished%3Aconsensus_strict_consensus&cmp=agent_proposal";

/** The three values the agent's grouping combines Gemma's six into. */
const ADOPTED_SLUGS = ["frontal-cortex", "hippocampus", "striatum"];

/** The factor-value cards in the DESIGN EDITOR — `FactorValueCard`
 *  renders the only `<article data-audit-target>` in the app, so this
 *  never picks up the proposal card's comparison grid. That distinction
 *  is the whole point: the grid's "Currently" column reads the
 *  chip-strip baseline, while these read the draft, and only the draft
 *  proves an apply landed.
 *
 *  A value the draft dropped keeps a card as a struck-through
 *  TOMBSTONE (revertable until commit), so "how many values does this
 *  factor have" has to exclude those. Only a live card carries a
 *  Duplicate button. */
function designValueCards(page: Page) {
  return page
    .locator("article[data-audit-target]")
    .filter({ has: page.getByRole("button", { name: /^Duplicate$/ }) });
}

function designTombstones(page: Page) {
  return page
    .locator("article[data-audit-target]")
    .filter({ hasNot: page.getByRole("button", { name: /^Duplicate$/ }) });
}

/** Each live value card stamps `data-audit-target="fv:<factor>/<label>#<id>"`
 *  — the same slug the agent side addresses findings by. Reading the
 *  label out of it beats matching card text, because a card also shows
 *  the ORIGINAL GEO characteristic it came from: after adopting a
 *  relabel, the card legitimately still contains the old wording. */
async function designValueSlugs(page: Page): Promise<string[]> {
  const targets = await designValueCards(page).evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-audit-target") ?? ""),
  );
  return targets
    .map((t) => t.replace(/^fv:[^/]*\//, "").replace(/#\d+$/, ""))
    .sort();
}

/** The Gemma FactorValue ids the design currently carries, from the
 *  same attribute. Adopting a grouping must PRESERVE these where a
 *  value's samples line up, so downstream references survive. */
async function designValueIds(page: Page): Promise<number[]> {
  const targets = await designValueCards(page).evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-audit-target") ?? ""),
  );
  return targets
    .map((t) => Number(t.match(/#(\d+)$/)?.[1] ?? NaN))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

async function expandAllCards(page: Page) {
  const cycle = page.getByRole("button", { name: /all cards collapsed/i });
  await cycle.waitFor({ state: "visible", timeout: 10000 });
  await cycle.click();
  await page.waitForTimeout(400);
}

async function openPicker(page: Page) {
  await page.getByRole("button", { name: /^Choose…$/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Every checkbox in the dialog, in render order:
 *  grouping, then (label, statement) per paired value. */
function boxes(dialog: ReturnType<Page["getByRole"]>) {
  return dialog.locator('input[type="checkbox"]');
}

test.describe("Partition adopt picker @critical", () => {
  test.beforeEach(async ({ page }) => {
    await mockExperiment(page, "exp-40086");
    // The disposition PATCH isn't in the HAR (it records read traffic
    // only) and an uncovered call ABORTS. Echo a report carrying the
    // disposition just sent, which is what the client asserts on.
    await page.route(/\/rest\/v2\/audits\/[^/]+$/, async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      const body = route.request().postDataJSON() as { target_id?: string };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          dispositions: [{ target_id: body?.target_id, status: "accepted" }],
        }),
      });
    });
    await page.addInitScript(() => window.localStorage.clear());
    await page.setViewportSize({ width: 1600, height: 1600 });
    await page.goto(TARGET);
    await page.waitForSelector("#root > *", { state: "attached" });
    await page.waitForTimeout(4500);
    await expandAllCards(page);
  });

  test("the partition card offers a third way between adopt-all and keep-all", async ({
    page,
  }) => {
    // The two whole-factor verbs stay; Choose… sits beside them.
    await expect(
      page.getByRole("button", { name: /adopt Auditor's fewer levels/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /don't change/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Choose…$/ }).first(),
    ).toBeEnabled();
  });

  test("the picker offers exactly the parts that differ, all ticked", async ({
    page,
  }) => {
    const dialog = await openPicker(page);
    await expect(dialog).toContainText('Choose what to adopt — factor "organism part"');

    // One grouping box + a label and a statement box for each of the
    // three paired values.
    await expect(boxes(dialog)).toHaveCount(7);
    const all = await boxes(dialog).all();
    for (const b of all) await expect(b).toBeChecked();

    // Both sides agree on the category here, so no Category row is
    // offered — the picker must not invite a change that isn't one.
    await expect(dialog.getByText("Category", { exact: true })).toHaveCount(0);
  });

  test("the picker states the cost of the regrouping before it is applied", async ({
    page,
  }) => {
    const dialog = await openPicker(page);
    await expect(dialog).toContainText("6 values");
    await expect(dialog).toContainText("3 values");
    // Half the samples land in a different value. Saying so up front is
    // the point — the alternative is discovering it in the validator.
    await expect(dialog).toContainText(/30 samples change value/);
    // The three values the agent's grouping drops say where their
    // samples went rather than vanishing from the list.
    await expect(
      dialog.getByText(/Dropped by the proposed grouping/),
    ).toHaveCount(3);
  });

  test("clearing every box disables Apply — an adopt that adopts nothing is the bug", async ({
    page,
  }) => {
    // Seven toggles, each a React re-render of the whole dialog. Fits
    // the default budget alone and doesn't under an 8-worker run.
    test.slow();
    const dialog = await openPicker(page);
    const apply = page.getByRole("button", { name: /^Apply selected$/ });
    await expect(apply).toBeEnabled();

    for (const b of await boxes(dialog).all()) await b.uncheck();
    await expect(apply).toBeDisabled();

    // One box back on is enough to make it a real change again.
    await boxes(dialog).first().check();
    await expect(apply).toBeEnabled();
  });

  test("taking one label alone relabels that value and touches nothing else", async ({
    page,
  }) => {
    test.slow(); // clears seven boxes before applying — see above
    const before = await designValueSlugs(page);
    expect(before).toHaveLength(6);

    const dialog = await openPicker(page);
    // Clear everything, then tick only the first value's Label row.
    for (const b of await boxes(dialog).all()) await b.uncheck();
    await boxes(dialog).nth(1).check(); // grouping is [0]; first label is [1]
    await page.getByRole("button", { name: /^Apply selected$/ }).click();
    await expect(dialog).toBeHidden();
    await expect(designValueCards(page)).toHaveCount(6);

    // Still six values, none dropped — the grouping was left alone.
    await expect(designTombstones(page)).toHaveCount(0);
    const after = await designValueSlugs(page);
    // Exactly one label moved, and it moved to the agent's wording.
    const gained = after.filter((s) => !before.includes(s));
    const lost = before.filter((s) => !after.includes(s));
    expect(gained).toEqual(["frontal-cortex"]);
    expect(lost).toEqual(["frontal-cortex-located-in-left-hemisphere"]);
  });

  test("taking the grouping rebinds the samples — six values become three", async ({
    page,
  }) => {
    // The headline regression: this used to record as accepted and
    // leave the design at six values.
    await expect(designValueCards(page)).toHaveCount(6);
    const idsBefore = await designValueIds(page);

    const dialog = await openPicker(page);
    await page.getByRole("button", { name: /^Apply selected$/ }).click();
    await expect(dialog).toBeHidden();
    await expect(designValueCards(page)).toHaveCount(3);

    expect(await designValueSlugs(page)).toEqual(ADOPTED_SLUGS);
    // Every surviving value reuses an id the design already had — the
    // adopt rewrites the factor in place, it does not drop and re-add.
    const idsAfter = await designValueIds(page);
    expect(idsAfter).toHaveLength(3);
    for (const id of idsAfter) expect(idsBefore).toContain(id);
    // The three values the grouping dropped stay on screen as
    // struck-through tombstones — the curator sees what left, and can
    // revert it, right up until commit.
    await expect(designTombstones(page)).toHaveCount(3);
  });

  test("the plain whole-factor adopt still mutates the design", async ({
    page,
  }) => {
    // The one-click verb, not the picker. It spent two months
    // recording dispositions over an untouched design because the
    // mutator re-resolved its landing factor from the AGENT's
    // category (fixed cb6ec8b, 2026-08-17). Nothing about that failure
    // was visible on the card, which is why the assertion is on the
    // design editor.
    await expect(designValueCards(page)).toHaveCount(6);
    await page
      .getByRole("button", { name: /adopt Auditor's fewer levels/i })
      .click();
    await expect(designValueCards(page)).toHaveCount(3);
    expect(await designValueSlugs(page)).toEqual(ADOPTED_SLUGS);
  });

  test("keeping the current design leaves it alone", async ({ page }) => {
    // The mirror of the test above: a keep must not run the adopt
    // mutator. Both verdicts land status=accepted on the wire, so the
    // draft is the only place the difference shows.
    await expect(designValueCards(page)).toHaveCount(6);
    const before = await designValueSlugs(page);
    await page.getByRole("button", { name: /don't change/i }).first().click();
    await page.waitForTimeout(800);
    expect(await designValueSlugs(page)).toEqual(before);
    await expect(designTombstones(page)).toHaveCount(0);
  });
});
