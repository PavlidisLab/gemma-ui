import { test, expect } from "@playwright/test";
import { installErrorGuards } from "./_helpers";
import { requiresBackend } from "./_backend";

/**
 * Smoke tests for the curator dashboard.
 *
 * These confirm the dashboard mounts cleanly against a fresh
 * ``local_curation.sqlite`` (1 seed design, 0 groups, 0 tickets).
 * Anything beyond "renders without crashing" lives in
 * feature-specific specs.
 */
test.describe("Curator dashboard @live", () => {
  test.beforeEach(async ({ page }) => {
    requiresBackend();
    // Use the shared helper so the suite's console-error filter list
    // stays one source of truth (the inline copy lacked the
    // 404 / "Failed to load resource" allowance the dev server emits
    // on its TanStack-query health probes — Paul 2026-06-16).
    installErrorGuards(page);
  });

  test("mounts to the landing route without crashing", async ({ page }) => {
    await page.goto("/");
    // The page title is set in index.html.
    await expect(page).toHaveTitle(/Gemma curation/i);
    // App root mounts a Curator Dashboard or LoginPage; either is a
    // clean mount. We don't allow a blank screen.
    await page.waitForSelector("#root > *", { state: "attached", timeout: 10_000 });
  });

  test("does not show the login page (local mode short-circuits useMe)", async ({ page }) => {
    await page.goto("/");
    // LoginPage renders a username/password form; the dashboard never
    // does. The presence of either is a useful boundary marker.
    await expect(page.locator("input[name='username']")).toHaveCount(0);
    await expect(page.locator("input[type='password']")).toHaveCount(0);
  });

  test("renders the Tickets section with the empty state on a fresh DB", async ({ page }) => {
    await page.goto("/");
    // The heading is unconditional.
    const ticketsHeader = page.getByRole("heading", { name: /^Tickets$/ });
    await expect(ticketsHeader).toBeVisible();
    // Fresh DB → no open tickets → the empty-state copy renders.
    await expect(page.getByText("No open tickets.")).toBeVisible();
  });

  test("renders the Sets section without crashing", async ({ page }) => {
    await page.goto("/");
    // SetsSection renders a heading on the landing page; we don't
    // assert its empty-state copy here (that's the SetsSection spec's
    // job once it lands).
    await expect(
      page.getByRole("heading", { name: /your sets|sets/i }),
    ).toBeVisible();
  });

  test("'Browse all experiments' navigates to the all-experiments view", async ({ page }) => {
    await page.goto("/");
    const browseLink = page.getByRole("button", {
      name: /Browse all experiments/i,
    });
    await expect(browseLink).toBeVisible();
    await browseLink.click();
    // Route change should land on the all-experiments view; the URL
    // hash flips to ``#/all-experiments``.
    await expect(page).toHaveURL(/#\/all-experiments/);
  });

  test("no MOCK_TICKETS fixture chip in the rendered dashboard", async ({ page }) => {
    // Regression test for the 2026-05-26 MOCK_TICKETS removal. The
    // dashboard used to render a "preview · mock data" chip next to
    // the Tickets heading. After removal, that chip must not appear.
    await page.goto("/");
    await expect(page.getByText(/preview\s·\smock\sdata/i)).toHaveCount(0);
    await expect(page.getByText(/in fixture/i)).toHaveCount(0);
    await expect(page.getByText(/from a placeholder fixture/i)).toHaveCount(0);
  });
});
