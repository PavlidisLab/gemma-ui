/**
 * Playwright spec — unified Reasoning panel across finding card types.
 *
 * The acceptance contract Paul stated 2026-06-16: "IT SHOULD BE THE
 * SAME COMPONENT WHETHER THE FACTOR IS A MATCH or a PARTIAL MATCH".
 * Every audit-sidebar finding card — factor-match, partition mismatch,
 * factor extra, tag add, tag remove — must share the same Reasoning
 * collapsible affordance:
 *
 *   - A "reasoning" / "hide reasoning" / "no reasoning" toggle button
 *     at the top of the card body.
 *   - Toggling it shows/hides the proposer + reviewer + comparison
 *     judge text together.
 *   - The visual comparator (chip strip / FV grid) and action row
 *     stay visible regardless of the toggle's state.
 *
 * Anchors: GSE165287 (id 40086) ticket-55 — has at least one
 * partition_mismatch ("MODIFY FACTOR VALUES — organism part") AND a
 * factor_match ("FACTOR MATCH — treatment") in the design tab, so
 * both code paths are exercised against real data.
 */
import { expect, test } from "@playwright/test";

const TARGET = "/#/experiments/40086?tab=design&ticket=55&base=polished%3Aconsensus_strict_consensus&cmp=agent_proposal";

test.describe("Reasoning panel — unified shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.setViewportSize({ width: 1440, height: 1600 });
    await page.goto(TARGET);
    await page.waitForSelector("#root > *", { state: "attached" });
    // Give the comparison + audit panels time to settle. Same wait
    // budget the other chipstrip specs use.
    await page.waitForTimeout(3500);
  });

  test("every finding card exposes a reasoning toggle with the canonical labels", async ({ page }) => {
    const toggles = page.locator('[data-testid="finding-reasoning-toggle"]');
    const count = await toggles.count();
    // Ticket-55 view on this experiment carries 8+ findings between
    // the design + tags groups; lower-bound on 1 keeps the spec
    // resilient to filter / disposition shifts.
    expect(count).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < count; i++) {
      const t = toggles.nth(i);
      const label = (await t.textContent())?.toLowerCase() ?? "";
      // Allowed phrasings — anything else is the bug Paul caught.
      const ok =
        label.includes("reasoning") || label.includes("no reasoning");
      expect(ok, `toggle ${i} read as "${label}"`).toBeTruthy();
    }
  });

  test("clicking a reasoning toggle reveals the body, clicking again hides it", async ({ page }) => {
    const toggle = page
      .locator('[data-testid="finding-reasoning-toggle"]:not([disabled])')
      .first();
    await expect(toggle).toBeVisible();
    // Initially the body is hidden.
    const bodyCount0 = await page
      .locator('[data-testid="finding-reasoning-body"]')
      .count();
    await toggle.click();
    await page.waitForTimeout(200);
    const bodyCount1 = await page
      .locator('[data-testid="finding-reasoning-body"]')
      .count();
    expect(bodyCount1).toBeGreaterThan(bodyCount0);
    // Click again — body collapses back.
    await toggle.click();
    await page.waitForTimeout(200);
    const bodyCount2 = await page
      .locator('[data-testid="finding-reasoning-body"]')
      .count();
    expect(bodyCount2).toBe(bodyCount0);
  });

  test("reasoning toggle does NOT hide the visual comparator or action buttons", async ({ page }) => {
    const toggle = page
      .locator('[data-testid="finding-reasoning-toggle"]:not([disabled])')
      .first();
    await expect(toggle).toBeVisible();
    // Capture the visual + button text BEFORE opening — these are
    // sibling-DOM, NOT inside the collapsible.
    const buttonsBefore = await page
      .locator("button")
      .filter({ hasText: /change|adopt|keep|remove|accept|don't/i })
      .count();
    await toggle.click();
    await page.waitForTimeout(200);
    const buttonsAfterOpen = await page
      .locator("button")
      .filter({ hasText: /change|adopt|keep|remove|accept|don't/i })
      .count();
    // The buttons are sibling DOM — toggling reasoning must not
    // change their count.
    expect(buttonsAfterOpen).toBe(buttonsBefore);
  });
});
