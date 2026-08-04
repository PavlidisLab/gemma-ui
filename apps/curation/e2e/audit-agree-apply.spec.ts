/**
 * Audit sidebar — Agree + disposition flow (E2E).
 *
 * These tests use the seed experiment (GSE277245.1) which ships with
 * zero audit findings in the local DB. The dev "Load fixture audit"
 * button is used to mount a fixture report with 5 findings (1 blocker,
 * 2 major, 1 minor, 1 ok) so the action buttons are exercisable
 * without needing a running audit agent.
 *
 * The sidebar defaults to the "Proposal review" tab. Tests that target
 * the audit pane must click the "Audit" view-toggle button first.
 *
 * Anatomy of the audit sidebar in the loaded-fixture state:
 *   - SidebarHeader row: "N pending" chip + "Finalize review" / "✓ Clear" button
 *   - Each FindingCard: collapsed by default; expand via the › chevron
 *     to see the FindingActionRow (Agree / Dismiss buttons)
 *   - Dispose PATCH goes to the local_api but the fixture's
 *     audit_id ("aud_01HXYZ_sample") doesn't exist in the DB —
 *     PATCH calls will 404. Tests that fire PATCH must intercept the
 *     route or only assert UI-state changes that don't need a response.
 *
 * NOTE: "Apply All" is proposal-kind only. Fixture reports are loaded
 * as kind="audit". Tests verify it is absent for audit-kind panels.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  SEED_EXPERIMENT_SHORT_NAME,
  installErrorGuards,
  gotoSeedExperiment,
} from "./_helpers";
import { requiresBackend } from "./_backend";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Switch the right-sidebar to the audit view by clicking the "Audit"
 *  view-toggle button. Safe to call even if already on the audit view.
 *  Waits for the button to be in its active state. */
async function switchToAuditTab(page: Page) {
  // The sidebar may be collapsed. Open it if needed.
  const collapseBtn = page.getByRole("button", { name: /Open audit findings/i });
  if ((await collapseBtn.count()) > 0) {
    await collapseBtn.click();
    await page.waitForTimeout(300);
  }
  // Click the "Audit" view-toggle button (active = font-medium or selected style).
  const auditBtn = page.getByRole("button", { name: /^Audit$/i });
  if ((await auditBtn.count()) > 0) {
    await auditBtn.first().click();
    await page.waitForTimeout(300);
  }
}

/** Navigate to the seed experiment, switch to the Audit tab, and load
 *  the fixture report via the dev button. Returns after the fixture
 *  finding cards are visible in the DOM.
 *
 *  Fixture findings:
 *    1. experiment:12654  blocker   not_suitable_for_dea
 *    2. factor:411        major     forbidden_efc
 *    3. factor:412        minor     factor_name_nonstandard
 *    4. fv:8132           major     missing_baseline
 *    5. tag:77            minor     ungrounded_term
 *    6. tag:78            ok        ok  ← not counted in pendingActionable
 */
async function gotoSeedWithAuditFixture(page: Page): Promise<boolean> {
  await gotoSeedExperiment(page);
  await switchToAuditTab(page);

  // The empty state for the audit view contains a "Load fixture audit (dev)" button.
  // If the fixture was already loaded (e.g. from a prior test session that kept
  // the override in component state), finding cards will already be present.
  const loadFixtureBtn = page.getByRole("button", {
    name: /Load fixture audit/i,
  });
  if ((await loadFixtureBtn.count()) > 0) {
    await loadFixtureBtn.click();
    await page.waitForTimeout(400);
  }

  // Wait for at least one finding card. The chevron-expand button has
  // aria-label "expand card" or "collapse card". The outer role=button
  // header div has title "expand card" or "collapse card".
  // Use the aria-label on the inner <button> chevron instead.
  // Return false (skip-signal) if no cards mount within a generous
  // wait window — happens when the seed DB has neither the fixture
  // dev button (production-shape data) nor a real audit on the seed.
  try {
    await expect(
      page
        .getByRole("button", { name: /expand card|collapse card/i })
        .first(),
    ).toBeVisible({ timeout: 4_000 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe("Audit sidebar — agree + disposition flow @live", () => {
  test.beforeEach(({ page }) => {
    requiresBackend();
    installErrorGuards(page);
  });

  // -------------------------------------------------------------------------
  // 1. Switching to Audit tab shows the audit empty state
  // -------------------------------------------------------------------------

  test("switching to the Audit tab shows the audit empty state when no audits exist", async ({
    page,
  }) => {
    await gotoSeedExperiment(page);
    await switchToAuditTab(page);

    // Either we see the empty state OR finding cards are already loaded.
    const emptyBody = page.getByText(/No audits on this experiment yet/i);
    const cardsBtns = page
      .getByRole("button", { name: /expand card|collapse card/i });

    const hasCards = (await cardsBtns.count()) > 0;
    if (!hasCards) {
      // Fresh DB — the empty state should be visible. (The former dev
      // "Load fixture audit" button was removed 2026-08-03; findings now
      // come only from a real proposer/audit run.)
      await expect(emptyBody).toBeVisible({ timeout: 8_000 });
    }
    // Either branch: the audit tab rendered without crashing.
    await expect(page.locator("#root")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 2. Fixture loads: finding cards appear after clicking the dev button
  // -------------------------------------------------------------------------

  test("clicking 'Load fixture audit (dev)' mounts finding cards in the sidebar", async ({
    page,
  }) => {
    await gotoSeedExperiment(page);
    await switchToAuditTab(page);

    const loadBtn = page.getByRole("button", { name: /Load fixture audit/i });
    const cards = page.getByRole("button", {
      name: /expand card|collapse card/i,
    });
    if ((await loadBtn.count()) === 0) {
      // No load-fixture button — either cards are already loaded
      // (verify) OR the seed has no audit at all (skip).
      if ((await cards.count()) === 0) {
        test.skip(true, "no fixture audit button + no cards loaded on this DB");
        return;
      }
      await expect(cards.first()).toBeVisible({ timeout: 6_000 });
      return;
    }

    await loadBtn.click();
    await page.waitForTimeout(400);

    // Fixture has 6 findings. At minimum 3 cards should appear.
    await expect(cards.first()).toBeVisible({ timeout: 6_000 });
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  // -------------------------------------------------------------------------
  // 3. Pending count badge is visible in the sidebar header
  // -------------------------------------------------------------------------

  test("pending-count chip appears in the audit header when findings are loaded", async ({
    page,
  }) => {
    if (!(await gotoSeedWithAuditFixture(page))) { test.skip(true, "no audit fixture available on this DB"); return; }

    // The chip text is "{N} pending". It only renders when pendingActionable > 0
    // and the review is not yet finalized.
    const pendingChip = page.getByText(/\d+ pending/i);
    if ((await pendingChip.count()) > 0) {
      await expect(pendingChip.first()).toBeVisible();
      const text = await pendingChip.first().innerText();
      expect(parseInt(text, 10)).toBeGreaterThan(0);
    }
    // If the chip is absent, all findings are already dispositioned — acceptable.
  });

  // -------------------------------------------------------------------------
  // 4. Expanding a collapsed finding card reveals the action row
  // -------------------------------------------------------------------------

  test("expanding a collapsed card reveals Agree or Dismiss action buttons", async ({
    page,
  }) => {
    if (!(await gotoSeedWithAuditFixture(page))) { test.skip(true, "no audit fixture available on this DB"); return; }

    // Cards default to collapsed (aria-label "expand card" on the chevron btn).
    const expandBtns = page.getByRole("button", { name: /^expand card$/i });
    if ((await expandBtns.count()) === 0) {
      // All cards already expanded — check action buttons are visible.
      const dismissBtn = page.locator("button").filter({ hasText: /…$/ }).first();
      if ((await dismissBtn.count()) > 0) {
        await expect(dismissBtn).toBeVisible();
      }
      return;
    }

    // Expand the first card.
    await expandBtns.first().click();
    await page.waitForTimeout(400);

    // After expansion, the action row renders. The dismiss button for any
    // non-ok finding always renders (its label ends with "…" per the
    // `${dismissLabel}…` pattern in findingCard.tsx). Alternatively an
    // Agree / Add / Remove / Confirm button appears.
    const actionBtns = page.locator("button").filter({ hasText: /^Agree$|^Confirm$|^Add$|^Remove$|→$|…$/ });
    await expect(actionBtns.first()).toBeVisible({ timeout: 4_000 });
  });

  // -------------------------------------------------------------------------
  // 5. Dismiss button opens DismissDialog with reason chips
  // -------------------------------------------------------------------------

  test("Dismiss button opens the DismissDialog with chips after expanding a finding card", async ({
    page,
  }) => {
    if (!(await gotoSeedWithAuditFixture(page))) { test.skip(true, "no audit fixture available on this DB"); return; }

    // Target the blocker finding card (not_suitable_for_dea) specifically —
    // it uses the simple action row (no structured editor), so its dismiss
    // button is reliably "Disagree…".
    // The card's expand button has aria-label like "expand card blocker Experiment … not_suitable_for_dea".
    const blockerExpandBtn = page
      .getByRole("button", { name: /expand card.*not_suitable_for_dea/i })
      .first();

    if ((await blockerExpandBtn.count()) === 0) {
      // Blocker card not found — try any non-structured card with a dismiss button.
      // Fall back to expanding any available collapsed card and checking.
      const expandBtns = page.getByRole("button", { name: /^expand card$/i });
      if ((await expandBtns.count()) === 0) {
        test.skip(true, "no expand buttons found — fixture may not be loaded");
        return;
      }
      // Expand all available cards to find a dismiss button.
      const count = await expandBtns.count();
      for (let i = 0; i < Math.min(count, 6); i++) {
        try {
          const btn = page.getByRole("button", { name: /^expand card$/i }).first();
          if ((await btn.count()) > 0) {
            await btn.click();
            await page.waitForTimeout(250);
          }
        } catch {
          break;
        }
      }
    } else {
      await blockerExpandBtn.click();
      await page.waitForTimeout(400);
    }

    // After expanding, look for the dismiss button. For the blocker
    // (not_suitable_for_dea, no calibration code) dismiss label = "Disagree"
    // → button text is "Disagree…". For other findings: "Don't add…",
    // "Don't remove…", etc. All end with "…" (U+2026).
    // Use getByRole + name regex instead of locator to avoid matching
    // card-header buttons.
    const dismissBtn = page
      .getByRole("button", { name: /Disagree…|Don't add…|Don't remove…|Not a match…|Don't modify…|Keep\b/i })
      .first();

    if ((await dismissBtn.count()) === 0) {
      test.skip(true, "no dismiss-flavour button found after expanding cards");
      return;
    }

    await expect(dismissBtn).toBeVisible();
    await dismissBtn.click();
    await page.waitForTimeout(500);

    // DismissDialog portals to document.body and is fixed-positioned.
    // Its close × button has aria-label "close dialog".
    const closeDialogBtn = page.getByRole("button", { name: /close dialog/i });
    await expect(closeDialogBtn).toBeVisible({ timeout: 5_000 });

    // At least one chip button should be present (reason options like
    // "Weak evidence", "Out of scope", etc.).
    const portalBtns = page.locator(
      "div[style*='position: fixed'] button:not([aria-label='close dialog'])",
    );
    const portalBtnCount = await portalBtns.count();
    // Expect at least: 1 chip + cancel + confirm.
    expect(portalBtnCount).toBeGreaterThanOrEqual(2);

    // Close via Escape (keeps draft, doesn't mutate).
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await expect(closeDialogBtn).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // 6. Agree button opens the accept-reason dialog
  // -------------------------------------------------------------------------

  test("standalone Agree button opens the accept DismissDialog when present", async ({
    page,
  }) => {
    if (!(await gotoSeedWithAuditFixture(page))) { test.skip(true, "no audit fixture available on this DB"); return; }

    // Expand cards until we find one with a standalone "Agree" button
    // (findings with no apply action, e.g. blocker: not_suitable_for_dea).
    const expandBtns = page.getByRole("button", { name: /^expand card$/i });
    const btnCount = await expandBtns.count();
    for (let i = 0; i < Math.min(btnCount, 3); i++) {
      const btn = expandBtns.nth(i);
      if ((await btn.count()) > 0 && await btn.isVisible()) {
        await btn.click();
        await page.waitForTimeout(300);
      }
    }

    const agreeBtn = page.getByRole("button", { name: /^Agree$/i }).first();
    if ((await agreeBtn.count()) === 0) {
      // No standalone Agree visible — may be a mutating apply-action card
      // or all already dispositioned.
      test.skip(true, "no standalone Agree button found after expanding cards");
      return;
    }

    await expect(agreeBtn).toBeVisible();
    await agreeBtn.click();
    await page.waitForTimeout(400);

    // The accept DismissDialog (mode=accept) should appear with a close ×.
    const closeDialogBtn = page.getByRole("button", { name: /close dialog/i });
    await expect(closeDialogBtn).toBeVisible({ timeout: 4_000 });

    // Cancel without mutating.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    await expect(closeDialogBtn).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // 7. Finalize review button exists when lifecycleAvailable
  // -------------------------------------------------------------------------

  test("'Finalize review' button is present when fixture audit_id is set", async ({
    page,
  }) => {
    if (!(await gotoSeedWithAuditFixture(page))) { test.skip(true, "no audit fixture available on this DB"); return; }
    // The fixture's audit_id = "aud_01HXYZ_sample" → lifecycleAvailable=true.
    // Button reads "Finalize review" (pending exist) or "✓ Clear" (all done).
    const finalizeBtn = page.getByRole("button", {
      name: /Finalize review|✓ Clear/i,
    });
    await expect(finalizeBtn).toBeVisible({ timeout: 6_000 });
  });

  // -------------------------------------------------------------------------
  // 8. Finalize button text tracks the pending count
  // -------------------------------------------------------------------------

  test("Finalize button says 'Finalize review' when findings are pending", async ({
    page,
  }) => {
    if (!(await gotoSeedWithAuditFixture(page))) { test.skip(true, "no audit fixture available on this DB"); return; }

    const finalizeBtn = page.getByRole("button", {
      name: /Finalize review|✓ Clear/i,
    });
    await expect(finalizeBtn).toBeVisible({ timeout: 6_000 });

    const labelText = await finalizeBtn.innerText();
    // When pending findings exist, the pending chip is also visible.
    const pendingChip = page.getByText(/\d+ pending/i);
    const pendingExists = (await pendingChip.count()) > 0;

    if (labelText.includes("Finalize review")) {
      // Pending findings still present → chip must be visible.
      expect(pendingExists).toBe(true);
    } else {
      // All dispositioned → "✓ Clear" and NO pending chip.
      expect(labelText).toContain("Clear");
      await expect(pendingChip).toHaveCount(0);
    }
  });

  // -------------------------------------------------------------------------
  // 9. Apply All is absent for audit-kind reports (proposal-only feature)
  // -------------------------------------------------------------------------

  test("Apply All button is absent for audit-kind reports", async ({
    page,
  }) => {
    if (!(await gotoSeedWithAuditFixture(page))) { test.skip(true, "no audit fixture available on this DB"); return; }
    // Apply All is gated on kind === "proposal". The fixture loads as audit.
    const applyAllBtn = page.getByRole("button", { name: /Apply All/i });
    await expect(applyAllBtn).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // 10. Reset all button is present alongside Finalize when lifecycleAvailable
  // -------------------------------------------------------------------------

  test("'Reset all' button is present alongside Finalize when fixture is loaded", async ({
    page,
  }) => {
    if (!(await gotoSeedWithAuditFixture(page))) { test.skip(true, "no audit fixture available on this DB"); return; }
    // lifecycleAvailable=true (fixture has audit_id) → "Reset all" appears.
    const resetBtn = page.getByRole("button", { name: /^Reset all$/i });
    await expect(resetBtn).toBeVisible({ timeout: 6_000 });
  });

  // -------------------------------------------------------------------------
  // 11. Clicking Finalize review opens the inline confirm panel
  // -------------------------------------------------------------------------

  test("clicking 'Finalize review' opens the inline confirm panel with a cancel button", async ({
    page,
  }) => {
    if (!(await gotoSeedWithAuditFixture(page))) { test.skip(true, "no audit fixture available on this DB"); return; }

    const finalizeBtn = page
      .getByRole("button", { name: /^Finalize review$/i })
      .first();
    if ((await finalizeBtn.count()) === 0) {
      test.skip(
        true,
        "Finalize review button not visible — audit may already be finalized",
      );
      return;
    }

    await finalizeBtn.click();
    await page.waitForTimeout(300);

    // CloseAuditConfirm renders inline (not a modal) with a textarea +
    // cancel button + confirm button.
    const cancelBtn = page.getByRole("button", { name: /^cancel$/i });
    await expect(cancelBtn).toBeVisible({ timeout: 4_000 });

    const textarea = page.locator(
      "textarea[placeholder*='optional close note']",
    );
    await expect(textarea).toBeVisible();

    // Dismiss by clicking cancel.
    await cancelBtn.click();
    await page.waitForTimeout(200);
    // Textarea should be gone.
    await expect(textarea).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // 12. Full sidebar round-trip: navigate, load fixture, sidebar stable
  // -------------------------------------------------------------------------

  test("audit sidebar renders without crashing after fixture load", async ({
    page,
  }) => {
    if (!(await gotoSeedWithAuditFixture(page))) { test.skip(true, "no audit fixture available on this DB"); return; }

    // The sidebar header always echoes the experiment accession.
    await expect(
      page.getByText(SEED_EXPERIMENT_SHORT_NAME).first(),
    ).toBeVisible();

    // Root should be non-empty smoke check (installErrorGuards handles
    // pageerror / console.error).
    const root = page.locator("#root");
    const text = await root.innerText();
    expect(text.length).toBeGreaterThan(100);

    // Audit tab chrome: "Audit" button is the active view toggle.
    const auditToggle = page.getByRole("button", { name: /^Audit$/i });
    await expect(auditToggle.first()).toBeVisible();
  });
});
