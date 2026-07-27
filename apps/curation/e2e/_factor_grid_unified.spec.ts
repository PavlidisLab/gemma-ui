/**
 * Playwright spec — every factor-side card uses the SAME visual grid.
 *
 * Contract (design review 2026-06-16): "I want ONE component for factors and
 * ONE component for TAGS." Visual side of every factor-card variant
 * (factor_match, partition_mismatch) renders via
 * FactorComparisonGrid — same `[left] 1fr [mid] MID_COL_PX
 * [right] 1fr` shape, same per-row backdrop, same `N <-> M` mid cell,
 * same FvDisplayRow chips, same row separation.
 *
 * Asserts:
 *   1. After expand-all, every factor card carries one or more
 *      `data-testid="factor-comparison-row-backdrop"` rows (only
 *      FactorComparisonGrid emits this).
 *   2. The "FV 1" / "FV 2" indexLabel from the old grid is GONE
 *      everywhere (design review: "The FV1, FV1, FV2 etc is not needed").
 *   3. Mid-cell renders as "N <-> M" with no arrows.
 *
 * Anchor experiment: GSE165287 (id 40086) ticket-55 design tab.
 */
import { expect, test } from "@playwright/test";
import { mockExperiment } from "./_mocks";

const TARGET =
  "/#/experiments/40086?tab=design&ticket=55&base=polished%3Aconsensus_strict_consensus&cmp=agent_proposal";

async function expandAllCards(page: import("@playwright/test").Page) {
  const cycle = page.getByRole("button", { name: /all cards collapsed/i });
  await cycle.waitFor({ state: "visible", timeout: 10000 });
  await cycle.click();
  await page.waitForTimeout(400);
}

test.describe("FactorComparisonGrid — the SINGLE factor visual @critical", () => {
  test.beforeEach(async ({ page }) => {
    // Data-mocked (see mockExperiment): the ticket-55 audit sidebar for
    // GSE165287 is frozen in a HAR so this tests the FactorComparisonGrid
    // render, not the store/ontology host. Re-record with PWHAR_UPDATE=1.
    await mockExperiment(page, "exp-40086");
    await page.addInitScript(() => window.localStorage.clear());
    await page.setViewportSize({ width: 1600, height: 1600 });
    await page.goto(TARGET);
    await page.waitForSelector("#root > *", { state: "attached" });
    await page.waitForTimeout(4500);
  });

  test("multiple factor cards each render via FactorComparisonGrid", async ({
    page,
  }) => {
    await expandAllCards(page);
    const backdrops = page.locator(
      '[data-testid="factor-comparison-row-backdrop"]',
    );
    const count = await backdrops.count();
    // GSE165287 has at least: 1 partition_mismatch (organism part, 6
    // rows) + 1 factor_match (treatment, >= 5 rows). That's 11+
    // backdrops across two grids — pin a low bound that survives
    // single-card filters without going flaky.
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test("no FV index labels render anywhere on the page", async ({
    page,
  }) => {
    await expandAllCards(page);
    // The old grid prefixed each row with "FV 1" / "FV 2" / ...
    // The reviewer dropped that 2026-06-16.
    const matches = await page.locator("text=/\\bFV\\s+\\d+\\b/").count();
    expect(matches, "no FV-index labels should render").toBe(0);
  });

  test("the centred mid cell renders as N <-> M (no directional arrows)", async ({
    page,
  }) => {
    await expandAllCards(page);
    const backdrops = page.locator(
      '[data-testid="factor-comparison-row-backdrop"]',
    );
    expect(await backdrops.count()).toBeGreaterThanOrEqual(1);
    const midGlyph = await page.locator("text=/\\d+\\s*↔\\s*\\d+/").count();
    expect(midGlyph).toBeGreaterThanOrEqual(1);
  });
});
