import { test, expect } from "@playwright/test";
import { installErrorGuards, gotoSeedExperiment } from "./_helpers";

/**
 * Form-field and dialog interaction tests.
 *
 * Each test is self-contained: navigate → interact → assert. No shared
 * state between tests. Tests skip gracefully when the required surface
 * cannot be reached on the current seed DB (e.g. no pending audit
 * findings, no screening group present).
 *
 * Bucket: form-fields-and-dialogs
 */

// ---------------------------------------------------------------------------
// 1. LoginPage username input + submit button
//    Local mode short-circuits useMe and skips the login screen entirely.
//    This test confirms the skip is clean — no login form leaks through.
// ---------------------------------------------------------------------------

test.describe("LoginPage — local-mode skip", () => {
  test.beforeEach(({ page }) => installErrorGuards(page));

  test("login form is NOT rendered in local mode (useMe returns synthetic user)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForSelector("#root > *", { state: "attached", timeout: 10_000 });
    // In local mode the UI bypasses the login page entirely. Confirm
    // that no username field or sign-in button is present.
    await expect(page.locator("input[type='text'][placeholder*='Gemma username']")).toHaveCount(0);
    await expect(page.locator("input[type='password']")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^sign in$/i })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// 2. DismissDialog — notes textarea + confirm button
//    Requires at least one pending audit finding. Skip if none.
// ---------------------------------------------------------------------------

test.describe("DismissDialog — notes textarea + confirm", () => {
  test.beforeEach(({ page }) => installErrorGuards(page));

  test("opening any audit finding card and typing in the dismiss dialog", async ({
    page,
  }) => {
    // The seed experiment (89342) doesn't have audit findings on a fresh
    // DB. Navigate to an experiment that's likely to have findings from
    // the curation_review table. Experiment 20005 / GSE1024 has audits.
    await page.goto("/#/experiments/20005");
    // Wait for shell to mount.
    const shellMounted = await page
      .locator("#root > *")
      .waitFor({ state: "attached", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!shellMounted) {
      test.skip(true, "experiment 20005 not in this DB — skipping");
      return;
    }

    // Look for a dismiss-family button (label varies by issue_code:
    // "Disagree…", "Don't remove…", "Don't add…", etc.). All end in
    // "…" when the disposition is pending.
    const dismissBtn = page
      .getByRole("button", { name: /\.\.\.$/ })
      .first();
    const found = await dismissBtn
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);

    test.skip(!found, "no pending dismiss-family button visible — no audit findings");

    // Click the dismiss button to open the dialog.
    await dismissBtn.click();

    // The DismissDialog mounts via a portal; its textarea is always
    // present once the dialog is open.
    const textarea = page.locator('textarea[placeholder="note (optional)"]').first();
    await expect(textarea).toBeVisible({ timeout: 5_000 });

    // Type a note.
    const noteText = "e2e test note " + Date.now();
    await textarea.fill(noteText);
    await expect(textarea).toHaveValue(noteText);

    // The confirm button is always enabled (notes and chips are optional
    // in the DismissDialog when chips.length === 0, or when a chip is
    // already pre-selected). Click the X to cancel without mutating.
    const closeBtn = page.getByRole("button", { name: /close dialog/i }).first();
    if (await closeBtn.count()) {
      // Escape closes without clearing the draft store; click ×
      // to cancel+clear so the next test doesn't see stale state.
      await closeBtn.click();
    } else {
      await page.keyboard.press("Escape");
    }

    // Dialog should be gone.
    await expect(textarea).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// 3. DismissDialog draft survives Escape and is restored on reopen
//    Opens a dismiss dialog, types a draft, presses Escape (preserves
//    draft per the draftStore), reopens, asserts text is still there.
// ---------------------------------------------------------------------------

test.describe("DismissDialog — draft survives Escape and reopens", () => {
  test.beforeEach(({ page }) => installErrorGuards(page));

  test("draft typed before Escape is restored when the dialog is reopened", async ({
    page,
  }) => {
    await page.goto("/#/experiments/20005");
    const shellMounted = await page
      .locator("#root > *")
      .waitFor({ state: "attached", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!shellMounted) {
      test.skip(true, "experiment 20005 not in this DB — skipping");
      return;
    }

    // Find the first dismiss-family button.
    const dismissBtn = page.getByRole("button", { name: /\.\.\.$/ }).first();
    const found = await dismissBtn
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!found, "no pending dismiss-family button visible");

    // Open dialog, type a draft, press Escape (preserves draft store).
    await dismissBtn.click();
    const textarea = page.locator('textarea[placeholder="note (optional)"]').first();
    await expect(textarea).toBeVisible({ timeout: 5_000 });
    const draft = "draft-survives-escape-" + Date.now();
    await textarea.fill(draft);
    await page.keyboard.press("Escape");
    await expect(textarea).toHaveCount(0); // dialog closed

    // Reopen the same button.
    await dismissBtn.click();
    const reopenedTextarea = page.locator('textarea[placeholder="note (optional)"]').first();
    await expect(reopenedTextarea).toBeVisible({ timeout: 5_000 });
    // Draft should be restored from the in-memory draftStore.
    await expect(reopenedTextarea).toHaveValue(draft);

    // Clean up — cancel to clear the draft.
    const closeBtn = page.getByRole("button", { name: /close dialog/i }).first();
    if (await closeBtn.count()) {
      await closeBtn.click();
    } else {
      await page.keyboard.press("Escape");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Bulk-intake accession textarea parses comma-separated accessions
//    The ScreeningQueue.BulkIntakeForm counts tokens from its textarea
//    and reflects the count in the submit button label.
//    Requires a screening group in the DB. Skip if none.
// ---------------------------------------------------------------------------

test.describe("Bulk intake — accession textarea token count", () => {
  test.beforeEach(({ page }) => installErrorGuards(page));

  test("pasting 3 accessions updates the 'Add N candidates' button label", async ({
    page,
  }) => {
    // Navigate to workflow — a screening group exposes the Bulk intake UI.
    // If no screening group exists the test skips gracefully.
    await page.goto("/#/workflow");
    await page.waitForSelector("#root > *", { state: "attached", timeout: 10_000 });

    // Look for any group link that might be screening type. The workflow
    // page lists groups; a screening group surfaces "Bulk intake" button.
    // We navigate by URL as well — try /workflow/<any-group-id>.
    const bulkIntakeToggle = page.getByRole("button", { name: /\+ Bulk intake/i }).first();
    const workflowHasBulk = await bulkIntakeToggle
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!workflowHasBulk, "no screening group visible in workflow — skipping bulk-intake test");

    // Open the BulkIntakeForm.
    await bulkIntakeToggle.click();

    // Fill in a batch label so the submit button can be enabled.
    const batchInput = page.locator('input[placeholder="Batch label…"]').first();
    await expect(batchInput).toBeVisible({ timeout: 5_000 });
    await batchInput.fill("e2e-test-batch");

    // Fill the accessions textarea with 3 accessions.
    const accessionTextarea = page
      .locator("textarea")
      .filter({ hasText: "" })
      .first();
    await accessionTextarea.fill("GSE1, GSE2, GSE3");

    // The submit button label should now read "Add 3 candidates".
    await expect(
      page.getByRole("button", { name: /^Add 3 candidates$/i }),
    ).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// 5. NotesDrawer textarea draft persists across open/close before save
//    Open the Status / notes drawer for the seed experiment, type a
//    draft, close (without saving), reopen — confirm draft is still there
//    via localStorage-backed cache in NotesDrawer.
// ---------------------------------------------------------------------------

test.describe("NotesDrawer — draft persists across open/close", () => {
  test.beforeEach(({ page }) => installErrorGuards(page));

  test("typing a draft note, closing, and reopening restores the draft", async ({
    page,
  }) => {
    await gotoSeedExperiment(page);

    // The "Status" button opens the NotesDrawer.
    const statusBtn = page.getByRole("button", { name: /^Status$/i }).first();
    await expect(statusBtn).toBeVisible({ timeout: 8_000 });
    await statusBtn.click();

    // The drawer's textarea has id="curation-note-textarea".
    const noteTextarea = page.locator("#curation-note-textarea");
    await expect(noteTextarea).toBeVisible({ timeout: 8_000 });

    // Read the current server-saved value.
    const savedValue = await noteTextarea.inputValue();

    // Type a unique draft (separate from the saved value so the cache
    // fires — NotesDrawer only caches when draft !== saved).
    const draftText = "e2e-draft-" + Date.now();
    const draftValue = savedValue ? savedValue + "\n" + draftText : draftText;
    await noteTextarea.fill(draftValue);
    await expect(noteTextarea).toHaveValue(draftValue);

    // Verify localStorage write happened (the persist useEffect writes on
    // every noteDraft change). Poll until the key appears — the effect is
    // async and fires after the next paint.
    const localStorageKey = "gca:note-draft:89342";
    await expect
      .poll(
        async () => page.evaluate((k) => localStorage.getItem(k), localStorageKey),
        { timeout: 5_000 },
      )
      .toBe(draftValue);

    // Close the drawer without saving (click the × button).
    const closeBtn = page
      .getByRole("button", { name: /^close$/i })
      .first();
    await closeBtn.click();
    // Drawer should be gone.
    await expect(noteTextarea).toHaveCount(0, { timeout: 3_000 });

    // Reopen.
    await statusBtn.click();
    const reopenedTextarea = page.locator("#curation-note-textarea");
    await expect(reopenedTextarea).toBeVisible({ timeout: 8_000 });

    // KNOWN BUG: The NotesDrawer has a React effect ordering bug.
    //
    // On second mount, `noteDraft` starts at "" (initial state). Both
    // the init useEffect and the persist useEffect share `saved?.curation_note`
    // as a dependency. When `saved` loads (with `curation_note = ""`),
    // React runs the effects in declaration order:
    //   1. Init effect runs: reads localStorage cache → finds our draft →
    //      calls `setNoteDraft(draft)`. But the state update is batched —
    //      `noteDraft` is still "" in the current render.
    //   2. Persist effect runs: `noteDraft ("") === saved.curation_note ("")`
    //      → calls `clearCachedNote`. The draft is deleted from localStorage.
    //   3. State update commits: next render has `noteDraft = draft`.
    //   4. Persist effect fires again: `draft !== ""` → `writeCachedNote`.
    //      But init effect does NOT fire again (its deps haven't changed).
    //   5. Final state: localStorage has draft; textarea still shows draft.
    //
    // The net visible result: the textarea NEVER shows the draft on second
    // open because step 1 sets the state to draft, but steps 2+3 clear
    // localStorage so the NEXT init-effect trigger can't restore it, and
    // step 4 re-writes but init effect doesn't re-fire. The textarea stays "".
    //
    // Fix would be to move the draft restore logic inside the persist effect
    // OR guard the persist effect so it doesn't clear the cache when the
    // local-state draft is still at its initial value (i.e., before the
    // init effect has had a chance to set the draft).
    //
    // Leave this test FAILING as a regression detector for the bug.
    await expect
      .poll(
        async () => reopenedTextarea.inputValue(),
        { timeout: 8_000 },
      )
      .toBe(draftValue);

    // Clean up: revert to server value to avoid polluting other tests.
    const revertBtn = page.getByRole("button", { name: /^revert$/i }).first();
    if (await revertBtn.isEnabled()) {
      await revertBtn.click();
    }
    // Close the drawer.
    const closeBtn2 = page.getByRole("button", { name: /^close$/i }).first();
    await closeBtn2.click();
  });
});

// ---------------------------------------------------------------------------
// 6. ConfirmModal cancel does NOT delete the factor
//    Navigate to the Design tab, open the delete-factor confirm modal by
//    clicking the trash icon on the first factor, then click Cancel.
//    Assert the factor is still in the table.
// ---------------------------------------------------------------------------

test.describe("ConfirmModal — cancel does not perform destructive action", () => {
  test.beforeEach(({ page }) => installErrorGuards(page));

  test("clicking cancel on the delete-factor modal leaves the factor intact", async ({
    page,
  }) => {
    await gotoSeedExperiment(page, "design");

    // Wait for the factors table to appear.
    const factorTable = page.locator("table").first();
    const tableVisible = await factorTable
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!tableVisible, "factors table not visible — seed experiment may have no factors");

    // Count factors before triggering the modal.
    const factorRows = page.locator("tbody tr");
    const rowsBefore = await factorRows.count();
    if (rowsBefore === 0) {
      test.skip(true, "no factor rows — cannot test delete-modal cancel");
      return;
    }

    // The delete icon is a Trash2 icon (Lucide). The aria-label is
    // `Delete "<factor-name>"`. Use a broad title-attribute approach.
    // Find the first delete button by its aria-label pattern.
    const firstDeleteBtn = page
      .getByRole("button", { name: /^Delete "/ })
      .first();
    const deleteBtnFound = await firstDeleteBtn
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!deleteBtnFound, "delete button not visible — possibly read-only mode");

    // Record the factor name from the aria-label for later assertion.
    const ariaLabel = await firstDeleteBtn.getAttribute("aria-label") ?? "";
    const match = ariaLabel.match(/^Delete "(.+)"$/);
    const factorName = match ? match[1] : null;

    // Click the delete icon — should open ConfirmModal.
    await firstDeleteBtn.click();

    // ConfirmModal renders with role="dialog".
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // The confirm button should be "delete factor" (destructive).
    await expect(
      page.getByRole("button", { name: /^delete factor$/i }),
    ).toBeVisible();

    // Click "cancel" — the ghost button in the modal footer.
    await page.getByRole("button", { name: /^cancel$/i }).click();

    // Modal should be gone.
    await expect(modal).toHaveCount(0, { timeout: 3_000 });

    // Row count must be unchanged.
    const rowsAfter = await factorRows.count();
    expect(rowsAfter).toBe(rowsBefore);

    // If we captured the name, confirm it's still in the table.
    if (factorName) {
      await expect(page.getByText(factorName).first()).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// 7. LoginPage form — field behaviour (rendered directly when not in local mode)
//    This surface is only reachable when useMe returns null (not in local
//    mode). We can still assert the form's static HTML contract by
//    navigating directly to the login route — but in local mode the
//    component never mounts, so we assert the absence of the form
//    and verify the dashboard loads instead.
// ---------------------------------------------------------------------------

test.describe("LoginPage — form field behaviour (local-mode boundary)", () => {
  test.beforeEach(({ page }) => installErrorGuards(page));

  test("root loads the dashboard (not the login form) in local mode", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForSelector("#root > *", { state: "attached", timeout: 10_000 });

    // No username input present — local mode short-circuits to the curator dashboard.
    await expect(page.locator("input[placeholder*='Gemma username']")).toHaveCount(0);

    // Dashboard renders a recognisable heading.
    const hasDashboard = await page
      .getByRole("heading", { name: /Tickets|Sets|all experiments/i })
      .first()
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    expect(hasDashboard).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. NotesDrawer — save note button disabled when textarea matches server value
//    Open the drawer; without editing, the "save note" button must be
//    disabled (no dirty state). Typing changes enables it.
// ---------------------------------------------------------------------------

test.describe("NotesDrawer — save-note button disabled state", () => {
  test.beforeEach(({ page }) => installErrorGuards(page));

  test("'save note' is disabled on open, enabled after typing", async ({ page }) => {
    await gotoSeedExperiment(page);

    const statusBtn = page.getByRole("button", { name: /^Status$/i }).first();
    await expect(statusBtn).toBeVisible({ timeout: 8_000 });
    await statusBtn.click();

    const noteTextarea = page.locator("#curation-note-textarea");
    await expect(noteTextarea).toBeVisible({ timeout: 8_000 });

    const saveBtn = page.getByRole("button", { name: /^save note$/i }).first();
    await expect(saveBtn).toBeVisible();

    // On first open, draft equals the saved value → button disabled.
    await expect(saveBtn).toBeDisabled();

    // Type something to make the draft dirty.
    await noteTextarea.press("End");
    await noteTextarea.type(" e2e-dirty");

    // Now the save button should be enabled.
    await expect(saveBtn).toBeEnabled();

    // Revert so we don't leave dirty state.
    const revertBtn = page.getByRole("button", { name: /^revert$/i }).first();
    await revertBtn.click();
    await expect(saveBtn).toBeDisabled();

    // Close.
    const closeBtn = page.getByRole("button", { name: /^close$/i }).first();
    await closeBtn.click();
  });
});
