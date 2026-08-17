/**
 * Playwright spec — the proposal-review pane, from card to draft.
 *
 * The proposer surface had no mocked coverage at all: the @critical
 * gate checked how factor cards LOOK (`_factor_grid_unified`) and how
 * the reasoning panel expands, but nothing checked that pressing a
 * verdict changes the design. That is the failure mode this app keeps
 * hitting — the disposition records, the card greys out, and the draft
 * is untouched (GSE9649 partition_mismatch 2026-06-14, the near-match
 * adopt 2026-08-09, the partition adopt 2026-08-17). Every one of
 * those was invisible on the card and obvious on the draft.
 *
 * So the assertions here are on the CommitBar, which states the whole
 * uncommitted diff in one line ("3 new FVs · 6 deleted FVs · 3 deleted
 * tags") and disappears when the draft is clean. A verdict that
 * changes nothing leaves it absent, whatever the card does.
 *
 * Anchor: GSE165287 (id 40086), ticket-55, frozen in
 * ``e2e/hars/exp-40086.zip``. Its proposal carries five findings —
 * three tag removals, one exact factor match, one partition mismatch.
 *
 * Re-record with: PWHAR_UPDATE=1 npm run e2e -- e2e/_proposal_review_apply.spec.ts --workers=1
 */
import { expect, test, type Page } from "@playwright/test";
import { mockExperiment } from "./_mocks";

const TARGET =
  "/#/experiments/40086?tab=design&ticket=55&base=polished%3Aconsensus_strict_consensus&cmp=agent_proposal";

/** The uncommitted-changes chip. Absent entirely on a clean draft, so
 *  `toHaveCount(0)` is the "nothing happened" assertion. */
function commitBar(page: Page) {
  return page.getByText("uncommitted", { exact: true });
}

/** The diff summary beside it — "3 new FVs · 6 deleted FVs · …". */
function draftSummary(page: Page) {
  return page.locator('[title*="deleted"], [title*="new "], [title*="modified"]');
}

async function expandAllCards(page: Page) {
  const cycle = page.getByRole("button", { name: /all cards collapsed/i });
  await cycle.waitFor({ state: "visible", timeout: 10000 });
  await cycle.click();
  await page.waitForTimeout(400);
}

test.describe("Proposal review — card to draft @critical", () => {
  test.beforeEach(async ({ page }) => {
    await mockExperiment(page, "exp-40086");
    // The HAR records reads only, and an uncovered call ABORTS. Echo
    // the disposition back so the apply path completes as it would
    // against a live store.
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

  test("every finding lands as a card with a live action — no dead ends", async ({
    page,
  }) => {
    // Three tag removals, each offering both directions.
    await expect(page.getByRole("button", { name: /^remove$/ })).toHaveCount(3);
    await expect(
      page.getByRole("button", { name: /^don't remove$/ }),
    ).toHaveCount(3);
    // The exact factor match: adopt the proposal, or say which flavour
    // of "keep mine" applies.
    await expect(
      page.getByRole("button", { name: /Proposal is better/ }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: /≈ equivalent/ }),
    ).toBeEnabled();
    // The partition mismatch: keep, adopt, or pick it apart.
    await expect(
      page.getByRole("button", { name: /adopt Auditor's fewer levels/i }),
    ).toBeEnabled();
    // Both factor cards offer the partial adopt, so there are two.
    await expect(page.getByRole("button", { name: /^Choose…$/ })).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: /^Choose…$/ }).first(),
    ).toBeEnabled();
    // A card that states a disagreement and offers no resolution is
    // worse than no card: nothing on this page may be inert.
    const actions = page.getByRole("button", {
      name: /^(remove|don't remove|Proposal is better|adopt Auditor's fewer levels|Choose…)$/i,
    });
    for (const b of await actions.all()) await expect(b).toBeEnabled();
  });

  test("an untouched draft shows no uncommitted-changes chip", async ({
    page,
  }) => {
    // The baseline every other test here reads against. If this chip
    // is present on load, every "it applied" assertion below is
    // meaningless.
    await expect(commitBar(page)).toHaveCount(0);
  });

  test("accepting a tag removal asks for a reason before it touches the draft", async ({
    page,
  }) => {
    await expect(commitBar(page)).toHaveCount(0);
    await page.getByRole("button", { name: /^remove$/ }).first().click();

    // The chip picker, not an immediate mutation: a removal has to say
    // WHY, and the chip set is the shared vocabulary (dispositionChips)
    // rather than a free-text box.
    await expect(page.getByRole("button", { name: "Current wrong" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Current redundant" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Save$/ })).toBeVisible();
    // Nothing has moved yet — the picker is a gate, not a confirmation
    // of something already done.
    await expect(commitBar(page)).toHaveCount(0);

    await page.getByRole("button", { name: "Current redundant" }).click();
    await page.getByRole("button", { name: /^Save$/ }).click();

    await expect(commitBar(page)).toBeVisible();
    await expect(draftSummary(page).first()).toHaveText(/1 deleted tag\b/);
    // Exactly one tag, and nothing else moved — no FV or factor counts.
    await expect(draftSummary(page).first()).not.toHaveText(/FV/);
  });

  test("cancelling the reason picker leaves the draft untouched", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /^remove$/ }).first().click();
    await expect(page.getByRole("button", { name: /^cancel$/ })).toBeVisible();
    await page.getByRole("button", { name: /^cancel$/ }).click();
    await page.waitForTimeout(800);
    await expect(commitBar(page)).toHaveCount(0);
  });

  test("declining a tag removal changes nothing at all", async ({ page }) => {
    // "don't remove" records a verdict. It must not touch the design —
    // keep and adopt both land status=accepted on the wire, so the
    // draft is the only place they can be told apart.
    await page.getByRole("button", { name: /^don't remove$/ }).first().click();
    await page.waitForTimeout(1000);
    await expect(commitBar(page)).toHaveCount(0);
  });

  test("Apply All chains every pending verdict into one draft", async ({
    page,
  }) => {
    const applyAll = page.getByRole("button", { name: /Apply All/ });
    await expect(applyAll).toBeVisible();
    await applyAll.click();

    await expect(commitBar(page)).toBeVisible();
    // The whole proposal in one line: the partition mismatch rebuilt
    // the organism-part factor (6 out, 3 in) and all three tag
    // removals landed. Counting them here is what proves the chain
    // ran to the end rather than stopping at the first card.
    const summary = draftSummary(page).first();
    await expect(summary).toHaveText(/3 new FVs/);
    await expect(summary).toHaveText(/6 deleted FVs/);
    await expect(summary).toHaveText(/3 deleted tags/);
  });

  test("undo returns the draft to clean after an Apply All", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Apply All/ }).click();
    await expect(commitBar(page)).toBeVisible();

    await page.getByRole("button", { name: /^undo$/ }).first().click();
    // Clean draft ⇒ no chip. A stuck chip here means an "undo" that
    // reverted the cards but not the design.
    await expect(commitBar(page)).toHaveCount(0);
  });
});
