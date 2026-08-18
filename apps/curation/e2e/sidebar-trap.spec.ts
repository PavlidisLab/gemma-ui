/** Sidebar / chip-strip interactivity regressions.
 *
 *  Design review 2026-05-29: "the proposal tab refuses to stay open when the
 *  comparator is empty; it's fine to close it by default but don't
 *  trap it. We need more tests of site interactivity."
 *
 *  Covers:
 *   - Sidebar auto-closes ONCE on the transition comparator→empty,
 *     then stays open if the user manually re-opens it.
 *   - Comparator dropdown still offers ``(empty)`` — only the
 *     baseline lattice was pruned per the same review session.
 *   - Baseline dropdown does NOT offer ``(empty)``.
 */
import { test, expect } from "@playwright/test";
import { installErrorGuards, SEED_EXPERIMENT_ID } from "./_helpers";
import { requiresBackend } from "./_backend";

test.describe("Sidebar + chip strip — interactivity traps @live", () => {
  test.beforeEach(({ page }) => {
    requiresBackend();
    installErrorGuards(page);
  });

  test("sidebar reopen sticks even when comparator stays empty", async ({
    page,
  }) => {
    // Land with a real comparator pair. Critical: the trap reproduces
    // ONLY when comparator transitions non-empty → empty within a
    // single mount; ``page.goto`` would remount and reset the
    // ``prevComparatorRef`` that suppresses repeat auto-close. Use an
    // in-page hash mutation that the chip-state hook re-reads via
    // ``hashchange`` without unmounting.
    await page.goto(
      `/#/experiments/${SEED_EXPERIMENT_ID}?tab=design&base=preboard&cmp=agent_proposal`,
    );
    await page.waitForSelector("#root > *", { state: "attached" });
    await page.waitForTimeout(500);

    await expect(
      page.getByRole("button", { name: /HIDE/i }).first(),
    ).toBeVisible({ timeout: 5000 });

    // Transition comparator agent_proposal → empty by clicking the
    // comparator chip and selecting (empty). This is a real
    // user-driven state change (no remount), which exercises the
    // ``prevComparatorRef`` transition detection.
    const chipStrip = page.getByRole("region", {
      name: /Comparison source selection/i,
    });
    // Target the dropdown by its popup role, not by index. The strip
    // used to hold two dropdowns and this was ``nth(1)``; the baseline
    // became a read-only label on 2026-08-17, so an index here silently
    // re-points at whatever button happens to sit second.
    const chipButtons = chipStrip.locator('button[aria-haspopup="listbox"]');
    await chipButtons.first().click(); // comparator
    const comparatorListbox = page.getByRole("listbox").first();
    await expect(comparatorListbox).toBeVisible({ timeout: 2000 });
    await comparatorListbox.getByText("(empty)", { exact: true }).click();
    await page.waitForTimeout(500);

    // Auto-close should have fired on the transition. The
    // collapsed-state button carries a ``title`` attribute (Open
    // audit findings / Open proposal review); locate via title
    // rather than accessible name (which is the inner chevron + tab
    // label text).
    const openBtn = page
      .getByTitle(/Open (audit findings|proposal review)/i)
      .first();
    await expect(openBtn).toBeVisible({ timeout: 5000 });

    // User manually re-opens the sidebar.
    await openBtn.click();
    await page.waitForTimeout(400);

    // It must STAY open — comparator is still empty but the ref now
    // says "previous was empty too", so no further auto-close fires.
    await expect(
      page.getByRole("button", { name: /HIDE/i }).first(),
    ).toBeVisible({ timeout: 2000 });
  });

  test("baseline dropdown does not list (empty); comparator dropdown does", async ({
    page,
  }) => {
    await page.goto(
      `/#/experiments/${SEED_EXPERIMENT_ID}?tab=design&base=preboard&cmp=agent_proposal`,
    );
    await page.waitForSelector("#root > *", { state: "attached" });

    // Wait for the chip-strip region to mount.
    const chipStrip = page.getByRole("region", {
      name: /Comparison source selection/i,
    });
    await expect(chipStrip).toBeVisible({ timeout: 10_000 });

    // Both chip dropdown triggers are <button> children of the
    // ChipStrip region. Index 0 = baseline; index 1 = comparator
    // (their render order in ChipStrip.tsx).
    const chipButtons = chipStrip.getByRole("button");
    const baselineChip = chipButtons.nth(0);
    const comparatorChip = chipButtons.nth(1);

    await baselineChip.click();
    const baselineListbox = page.getByRole("listbox", {
      name: /Baseline source/i,
    });
    await expect(baselineListbox).toBeVisible({ timeout: 2000 });
    // Baseline must NOT offer (empty) — Design review 2026-05-29 filter.
    await expect(
      baselineListbox.getByText("(empty)", { exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    await comparatorChip.click();
    const comparatorListbox = page.getByRole("listbox", {
      name: /(Comparator|Audit|Proposal|Regression check) source/i,
    });
    await expect(comparatorListbox).toBeVisible({ timeout: 2000 });
    // Comparator KEEPS (empty) — legitimate "no comparison" state.
    await expect(
      comparatorListbox.getByText("(empty)", { exact: true }),
    ).toHaveCount(1);
  });
});
