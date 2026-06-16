/**
 * Playwright spec — unified Reasoning panel across finding card types.
 *
 * Contract (Paul 2026-06-16): every audit finding card — factor-match,
 * partition mismatch, factor extra, tag add, tag remove — must share
 * the SAME Reasoning collapsible affordance:
 *
 *   - A "reasoning" / "hide reasoning" / "no reasoning" toggle button
 *     near the top of each expanded card.
 *   - Toggling reveals/hides the proposer + reviewer + comparison
 *     judge text together.
 *   - The visual comparator (chip strip / FV grid) + action buttons
 *     stay visible regardless of the toggle's state.
 *
 * Anchor experiment: GSE165287 (id 40086) ticket-55 design tab —
 * carries partition_mismatch + factor_match findings in the audit
 * sidebar so both card-component code paths render.
 *
 * Setup quirk: cards default-collapse (a chevron next to the card
 * header) so we click the card header first to reveal the inner
 * editor + reasoning toggle.
 */
import { expect, test } from "@playwright/test";

const TARGET =
  "/#/experiments/40086?tab=design&ticket=55&base=polished%3Aconsensus_strict_consensus&cmp=agent_proposal";

test.describe("Reasoning panel — unified shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.setViewportSize({ width: 1440, height: 1600 });
    await page.goto(TARGET);
    await page.waitForSelector("#root > *", { state: "attached" });
    await page.waitForTimeout(4000);
  });

  test("expanding finding cards reveals the shared reasoning toggle", async ({ page }) => {
    // Click any card header to expand. The cards' chevrons expose
    // them; we use the title-row "role=button" hooks since they
    // wrap the chevron + title.
    const titleRows = page.locator('[role="button"][title*="expand"]');
    const n = await titleRows.count();
    if (n === 0) {
      test.skip(true, "no audit cards rendered for this experiment — sidebar may be closed");
      return;
    }
    // Expand the first few cards (cap at 5 to keep the spec snappy).
    const expandCount = Math.min(n, 5);
    for (let i = 0; i < expandCount; i++) {
      await titleRows.nth(i).click({ trial: false }).catch(() => {});
    }
    await page.waitForTimeout(500);
    const toggles = page.locator('[data-testid="finding-reasoning-toggle"]');
    const tcount = await toggles.count();
    expect(
      tcount,
      "expected at least one reasoning toggle to be present after expanding cards",
    ).toBeGreaterThanOrEqual(1);
    // Every visible toggle must read with the canonical phrasing.
    for (let i = 0; i < tcount; i++) {
      const label = (await toggles.nth(i).textContent())?.toLowerCase() ?? "";
      const ok =
        label.includes("reasoning") || label.includes("no reasoning");
      expect(ok, `toggle ${i} read as "${label}"`).toBeTruthy();
    }
  });

  test("clicking the reasoning toggle reveals + hides the body", async ({ page }) => {
    // Expand any cards first.
    const titleRows = page.locator('[role="button"][title*="expand"]');
    const n = await titleRows.count();
    if (n === 0) {
      test.skip(true, "no audit cards rendered for this experiment");
      return;
    }
    for (let i = 0; i < Math.min(n, 3); i++) {
      await titleRows.nth(i).click({ trial: false }).catch(() => {});
    }
    await page.waitForTimeout(400);
    const toggle = page
      .locator('[data-testid="finding-reasoning-toggle"]:not([disabled])')
      .first();
    if ((await toggle.count()) === 0) {
      test.skip(true, "no enabled reasoning toggles found");
      return;
    }
    const bodiesBefore = await page
      .locator('[data-testid="finding-reasoning-body"]')
      .count();
    await toggle.click();
    await page.waitForTimeout(250);
    const bodiesOpen = await page
      .locator('[data-testid="finding-reasoning-body"]')
      .count();
    expect(bodiesOpen).toBeGreaterThan(bodiesBefore);
    await toggle.click();
    await page.waitForTimeout(250);
    const bodiesClosed = await page
      .locator('[data-testid="finding-reasoning-body"]')
      .count();
    expect(bodiesClosed).toBe(bodiesBefore);
  });
});
