/**
 * Playwright spec — unified Reasoning panel across finding card types.
 *
 * Contract (design review 2026-06-16): every audit finding card — factor-match,
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
 * carries partition_mismatch + factor_match + remove_tag findings in
 * the audit sidebar so multiple card-component code paths render.
 *
 * Setup: cards default to collapsed. The audit sidebar has a 3-way
 * "expand all" cycle button (collapsed → expanded → fully); we click
 * it once to land in "expanded" so every card body + reasoning toggle
 * is rendered.
 */
import { expect, test } from "@playwright/test";
import { mockExperiment } from "./_mocks";

const TARGET =
  "/#/experiments/40086?tab=design&ticket=55&base=polished%3Aconsensus_strict_consensus&cmp=agent_proposal";

async function expandAllCards(page: import("@playwright/test").Page) {
  // The cycle button starts in "collapsed". One click → "expanded"
  // (bodies open; judgements panel still closed). That's what we
  // want — the reasoning toggle renders when the card body is open.
  const cycle = page.getByRole("button", {
    name: /all cards collapsed/i,
  });
  await cycle.waitFor({ state: "visible", timeout: 10000 });
  await cycle.click();
  // Give React a beat to repaint every card body.
  await page.waitForTimeout(400);
}

test.describe("Reasoning panel — unified shell @critical", () => {
  test.beforeEach(async ({ page }) => {
    // Data-mocked (see mockExperiment): shares the ticket-55 GSE165287
    // HAR with the factor-grid spec — tests the reasoning-toggle render,
    // not data access. Re-record with PWHAR_UPDATE=1.
    await mockExperiment(page, "exp-40086");
    await page.addInitScript(() => window.localStorage.clear());
    await page.setViewportSize({ width: 1600, height: 1400 });
    await page.goto(TARGET);
    await page.waitForSelector("#root > *", { state: "attached" });
    await page.waitForTimeout(4500);
  });

  test("expanding the audit sidebar reveals shared reasoning toggles", async ({
    page,
  }) => {
    await expandAllCards(page);
    const toggles = page.locator('[data-testid="finding-reasoning-toggle"]');
    const tcount = await toggles.count();
    expect(
      tcount,
      "expected at least one reasoning toggle after expanding cards",
    ).toBeGreaterThanOrEqual(1);
    // Canonical phrasing on every toggle — anything else is the
    // regression the reviewer caught when the buttons read "Auditor details".
    for (let i = 0; i < tcount; i++) {
      const label = (await toggles.nth(i).textContent())?.toLowerCase() ?? "";
      const ok =
        label.includes("reasoning") || label.includes("no reasoning");
      expect(ok, `toggle ${i} read as "${label}"`).toBeTruthy();
    }
  });

  test("clicking a reasoning toggle reveals + hides its body", async ({
    page,
  }) => {
    await expandAllCards(page);
    const toggle = page
      .locator('[data-testid="finding-reasoning-toggle"]:not([disabled])')
      .first();
    await expect(toggle).toBeVisible({ timeout: 5000 });
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

  test("reasoning toggle does NOT change the count of action buttons", async ({
    page,
  }) => {
    await expandAllCards(page);
    const toggle = page
      .locator('[data-testid="finding-reasoning-toggle"]:not([disabled])')
      .first();
    await expect(toggle).toBeVisible({ timeout: 5000 });
    // Action-row buttons are siblings of the reasoning panel, not
    // children — they must stay visible regardless of the toggle
    // state so the curator can act without re-expanding text.
    const buttonsRe = /^(adopt |keep|don't|accept|remove|change|add )/i;
    const before = await page
      .locator("button")
      .filter({ hasText: buttonsRe })
      .count();
    await toggle.click();
    await page.waitForTimeout(250);
    const afterOpen = await page
      .locator("button")
      .filter({ hasText: buttonsRe })
      .count();
    expect(afterOpen).toBe(before);
    await toggle.click();
    await page.waitForTimeout(250);
    const afterClosed = await page
      .locator("button")
      .filter({ hasText: buttonsRe })
      .count();
    expect(afterClosed).toBe(before);
  });
});
