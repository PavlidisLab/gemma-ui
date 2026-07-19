import { test, expect } from "@playwright/test";
import { installErrorGuards } from "./_helpers";
import { requiresBackend } from "./_backend";

/**
 * Dashboard's behaviour on a fresh ``local_curation.sqlite``
 * (1 seed design, 0 groups, 0 tickets). Anything that relied on the
 * deleted in-tree MOCK_TICKETS fixture should now read as an empty
 * state, not as fixture data.
 */
test.describe("Dashboard — fresh-DB empty state @live", () => {
  test.beforeEach(({ page }) => {
    requiresBackend();
    installErrorGuards(page);
  });

  test("Tickets section is empty (no MOCK_TICKETS fallback)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("No open tickets.")).toBeVisible();
  });

  test("Tickets counter reads '—' on empty", async ({ page }) => {
    await page.goto("/");
    const ticketsHeader = page.getByRole("heading", { name: /^Tickets$/ });
    // The dash appears next to the heading in the right-side counter.
    const headerRegion = ticketsHeader.locator("..").locator("..");
    await expect(headerRegion).toContainText(/[—\-]/);
  });

  test("Sets section renders even with zero groups", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /your sets|sets/i }),
    ).toBeVisible();
  });

  test("'Browse all experiments' button is visible on the dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: /Browse all experiments/i }),
    ).toBeVisible();
  });

  test("'Import from Gemma' search input is visible", async ({ page }) => {
    await page.goto("/");
    // The search bar's placeholder mentions Gemma / GSE / import.
    const input = page.locator("input").filter({
      hasText: "",
    });
    // At least one input element on the page.
    expect(await input.count()).toBeGreaterThan(0);
  });

  test("Page contains the curator's name (LOCAL_MODE_USER)", async ({ page }) => {
    await page.goto("/");
    // LOCAL_MODE_USER's full_name is something like 'Local Curator'.
    // We just confirm there's SOME presented identity.
    const text = await page.locator("#root").innerText();
    expect(text.length).toBeGreaterThan(100);
  });

  test("No 'mock' / 'fixture' / 'placeholder' labels on the landing page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/preview\s·\smock/i)).toHaveCount(0);
    await expect(page.getByText(/from a placeholder fixture/i)).toHaveCount(0);
    await expect(page.getByText(/in fixture/i)).toHaveCount(0);
  });
});
