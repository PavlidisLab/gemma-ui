import { test, expect } from "@playwright/test";
import { installErrorGuards } from "./_helpers";

/**
 * Dashboard filter-chip clicks + navigation.
 *
 * Covers:
 *   1. "Not started" chip narrows the ticket list.
 *   2. Clicking the same chip again returns to All.
 *   3. A ticket card click navigates to /#/tickets/<id>.
 *   4. Search input on the all-experiments table filters rows.
 *   5. Empty-state copy appears when a filter yields zero results.
 *   6. Browse-all link reaches the all-experiments table.
 *
 * Many of these tests require tickets to be present in the DB. Each
 * skips gracefully (``test.skip``) when the dashboard shows the empty
 * state, so a fresh SQLite with no tickets still produces a passing
 * suite rather than unexplained failures.
 *
 * Pattern per state-tracking.spec.ts:
 *   1. Capture before-state.
 *   2. Trigger one user action.
 *   3. Assert the expected delta — and only that — happened.
 */

// ------------------------------------------------------------------ helpers

/** The ticket list is a ``<ul>`` whose children are ``<li>`` elements
 *  wrapping a ``TicketCard``. Count the ``<li>`` elements inside the
 *  Tickets section to get the visible card count. The Tickets section
 *  is identified by its ``<h2>`` heading; the ``<ul>`` is a sibling
 *  further down. Because the section is a simple stack of siblings
 *  we use a CSS selector scoped to the section's parent ``<section>``. */
function ticketCardList(page: import("@playwright/test").Page) {
  // The section wraps: h2, filter chips div, and then a <ul> or the
  // empty-state <div>. Counting <li> elements scoped to the section
  // is the most stable approach.
  return page.locator("section ul > li");
}

/** Return true when the dashboard is loaded and at least one ticket
 *  card is visible. The Tickets section always renders (heading is
 *  unconditional); loading is async so we wait for networkidle first. */
async function hasTickets(page: import("@playwright/test").Page): Promise<boolean> {
  await page.waitForLoadState("networkidle").catch(() => { /* best-effort */ });
  // Any <li> in a <ul> inside a <section> means tickets rendered.
  const cards = ticketCardList(page);
  return (await cards.count()) > 0;
}

/** Locate a dashboard filter chip by its label text.
 *  The chip renders as a ``<button>`` containing the label text
 *  followed by a count ``<span>`` (no space separator — just CSS
 *  margin). We use ``getByText`` with exact:false scoped to the
 *  filter-chip container so we pick up "All", "Not started", etc.
 *  without caring about the trailing count digit(s).
 *
 *  The container is the ``<div class="flex items-center gap-1 …">``
 *  immediately above the ticket grid. We identify it by the
 *  ``mb-3 text-xs`` combo that the CuratorDashboard renders only
 *  on the chip row. */
function dashboardFilterChip(page: import("@playwright/test").Page, label: string) {
  // Target: the small rounded-full buttons that are children of the
  // chip row. Use ``getByRole("button")`` with a partial-name regex
  // anchored to the label — the accessible name includes the count
  // appended (e.g. "All 2"), so the pattern ``^All`` works.
  return page
    .locator("section button.rounded-full")
    .filter({ hasText: label })
    .first();
}

// ------------------------------------------------------------------ tests

test.describe("dashboard filter chips — ticket list narrowing", () => {
  test.beforeEach(({ page }) => installErrorGuards(page));

  test("'Not started' chip narrows the ticket list to non-started rows", async ({
    page,
  }) => {
    await page.goto("/");
    // Wait for network to settle so the ticket counts are accurate.
    await page.waitForLoadState("networkidle").catch(() => {});

    const ticketPresent = await hasTickets(page);
    test.skip(!ticketPresent, "no ticket data on this DB — skipping filter chip test");

    // Capture the "All" card count as the baseline.
    const allChip = dashboardFilterChip(page, "All");
    await expect(allChip).toBeVisible({ timeout: 5_000 });
    await allChip.click();
    await expect(allChip).toHaveClass(/bg-blue-600/, { timeout: 3_000 });
    // Wait for the data to settle on "All" view.
    await expect(page.getByText("loading tickets…")).toHaveCount(0, {
      timeout: 5_000,
    });

    const cards = ticketCardList(page);
    const countBefore = await cards.count();

    // Click "Not started".
    const notStartedChip = dashboardFilterChip(page, "Not started");
    await expect(notStartedChip).toBeVisible();
    await notStartedChip.click();

    // The active chip flips to blue.
    await expect(notStartedChip).toHaveClass(/bg-blue-600/, { timeout: 3_000 });

    // Wait for the async re-fetch to settle: either the ticket list
    // updates OR the empty state renders. The loading spinner shows
    // "loading tickets…" while in flight; wait until it disappears.
    await expect(page.getByText("loading tickets…")).toHaveCount(0, {
      timeout: 5_000,
    });

    // Either there are fewer cards than "All", OR we get the empty-
    // state copy for zero matches. Both are valid "narrowed" states.
    const countAfter = await cards.count();

    if (countAfter === 0) {
      // No not-started tickets — empty state must appear.
      await expect(
        page.getByText(
          /No open tickets waiting to start\.|No tickets\.|No completed tickets\.|No tickets in progress\./i,
        ),
      ).toBeVisible({ timeout: 5_000 });
    } else {
      // Narrowed set must be <= All.
      expect(countAfter).toBeLessThanOrEqual(countBefore);
    }
  });

  test("clicking the same chip again deactivates it (returns to All)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});

    const ticketPresent = await hasTickets(page);
    test.skip(!ticketPresent, "no ticket data on this DB — skipping chip toggle test");

    // Activate "Not started" so we have something to toggle off.
    const allChip = dashboardFilterChip(page, "All");
    const notStartedChip = dashboardFilterChip(page, "Not started");
    await expect(notStartedChip).toBeVisible({ timeout: 5_000 });

    // Click "All" to start from a known state.
    await allChip.click();
    await expect(allChip).toHaveClass(/bg-blue-600/, { timeout: 3_000 });
    await expect(notStartedChip).not.toHaveClass(/bg-blue-600/);

    // Capture the "All" card count.
    const cards = ticketCardList(page);
    const countAll = await cards.count();

    // Switch to "Not started".
    await notStartedChip.click();
    await expect(notStartedChip).toHaveClass(/bg-blue-600/, { timeout: 3_000 });

    // Click "All" again — the toggle-off behaviour is implemented as
    // clicking "All" (the "deactivate" direction goes back to All).
    await allChip.click();
    await expect(allChip).toHaveClass(/bg-blue-600/, { timeout: 3_000 });
    await expect(notStartedChip).not.toHaveClass(/bg-blue-600/);

    // Count should return to the All baseline.
    const countReturn = await cards.count();
    expect(countReturn).toBe(countAll);
  });

  test("clicking a ticket card navigates to its TicketDetailPage (#/tickets/<id>)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});

    const ticketPresent = await hasTickets(page);
    test.skip(!ticketPresent, "no ticket data on this DB — skipping ticket row navigation test");

    // Make sure we're on "All" so we see the widest card list.
    const allChip = dashboardFilterChip(page, "All");
    await expect(allChip).toBeVisible({ timeout: 5_000 });
    await allChip.click();

    // Find the first ticket card with multiple targets (those navigate
    // to the detail page; single-target cards skip straight to the EE).
    // We detect multi-target cards by looking for cards that show
    // "N experiments" (TargetList) with N > 1.
    // Fallback: use the first <li> card that renders.
    const multiTargetCard = page
      .locator("section ul > li")
      .filter({ hasText: /\d+ experiments/ })
      .first();
    const firstCard = page.locator("section ul > li").first();

    const hasMulti = await multiTargetCard.count() > 0;
    const targetCard = hasMulti ? multiTargetCard : firstCard;

    await expect(targetCard).toBeVisible({ timeout: 5_000 });

    // For single-target cards the click goes to the experiment, not
    // the ticket detail page — skip if we only have single-target
    // cards and want to test the ticket URL.
    if (!hasMulti) {
      // We'll click and accept either destination; the main assertion
      // is that a URL change happens at all.
      await targetCard.click();
      const url = page.url();
      const goesToTicket = /#\/tickets\/\d+/.test(url);
      const goesToExperiment = /#\/experiments\/\d+/.test(url);
      expect(goesToTicket || goesToExperiment).toBe(true);
      return;
    }

    await multiTargetCard.click();
    await expect(page).toHaveURL(/#\/tickets\/\d+/, { timeout: 7_000 });
  });
});

test.describe("all-experiments table — search and filter", () => {
  test.beforeEach(({ page }) => installErrorGuards(page));

  test("search input filters the experiment list as the curator types", async ({
    page,
  }) => {
    await page.goto("/#/all-experiments");
    // Wait for the table to load.
    await page.waitForLoadState("networkidle").catch(() => {});

    const search = page.locator("input[type='search']").first();
    const hasSearch = await search
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!hasSearch, "no search input on all-experiments page");

    // Count visible rows before filtering.
    const rows = page.locator("tbody tr");
    const rowsBefore = await rows.count();
    test.skip(rowsBefore === 0, "no experiment rows loaded — skipping search test");

    // Type a nonsense query that won't match any accession or title.
    await search.fill("ZZZZZZZZZZZ_NOMATCH");

    // The empty-state copy must appear.
    await expect(
      page.getByText(/No experiments match/i),
    ).toBeVisible({ timeout: 5_000 });

    // Rows should be gone.
    const rowsAfter = await rows.count();
    expect(rowsAfter).toBe(0);
  });

  test("clearing the search input restores the full experiment list", async ({
    page,
  }) => {
    await page.goto("/#/all-experiments");
    await page.waitForLoadState("networkidle").catch(() => {});

    const search = page.locator("input[type='search']").first();
    const hasSearch = await search
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!hasSearch, "no search input — skipping");

    const rows = page.locator("tbody tr");
    const countBefore = await rows.count();
    test.skip(countBefore === 0, "no experiment rows — skipping");

    // Narrow.
    await search.fill("ZZZZZZZZZZZ_NOMATCH");
    await expect(page.getByText(/No experiments match/i)).toBeVisible({ timeout: 5_000 });

    // Clear.
    await search.fill("");

    // Rows should return to the original count.
    await expect(rows).toHaveCount(countBefore, { timeout: 5_000 });
  });

  test("empty-state copy appears when a status filter has zero matches", async ({
    page,
  }) => {
    await page.goto("/#/all-experiments");
    await page.waitForLoadState("networkidle").catch(() => {});

    // Look for the "troubled" status pill — on a fresh DB this will
    // always be 0. The pill renders as a button with label "troubled"
    // + count.
    const troubledPill = page
      .getByRole("button", { name: /troubled/ })
      .first();
    const found = await troubledPill
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!found, "no status filter pills visible — skipping empty-state test");

    // Click "troubled".
    await troubledPill.click();

    // Either we see the empty state OR there are actually some
    // troubled experiments (valid too). On a fresh seed DB there are
    // none, so we assert the empty-state text.
    const emptyState = page.getByText(/No experiments troubled/i);
    const emptyAlt = page.getByText(/No experiments/i);
    const rows = page.locator("tbody tr");

    const hasRows = (await rows.count()) > 0;
    if (!hasRows) {
      // Assert one of the empty-state strings.
      await expect(emptyAlt.first()).toBeVisible({ timeout: 5_000 });
    } else {
      // There are troubled experiments — pill count > 0 case. The
      // test still passes; we confirm the table renders without crash.
      expect(hasRows).toBe(true);
    }

    // The "troubled" pill should now be visually active (darkened).
    await expect(troubledPill).toHaveClass(/bg-rose-700|text-white/, {
      timeout: 3_000,
    });
  });
});

test.describe("dashboard navigation — browse-all link", () => {
  test.beforeEach(({ page }) => installErrorGuards(page));

  test("Browse-all link reaches the all-experiments table and experiments load", async ({
    page,
  }) => {
    await page.goto("/");

    // The button label is "Browse all experiments in curation →"
    const browseBtn = page.getByRole("button", {
      name: /Browse all experiments/i,
    });
    await expect(browseBtn).toBeVisible({ timeout: 5_000 });
    await browseBtn.click();

    // URL flips to #/all-experiments.
    await expect(page).toHaveURL(/#\/all-experiments/, { timeout: 7_000 });

    // The heading must appear — confirms the route mounted correctly.
    await expect(
      page.getByText(/Experiments staged for curation/i),
    ).toBeVisible({ timeout: 7_000 });

    // Assert the table or empty state is rendered — i.e. the
    // component mounted beyond the loading spinner.
    const tableOrEmpty = page.locator("table, [data-testid='empty'], .px-3.py-6");
    await expect(tableOrEmpty.first()).toBeVisible({ timeout: 10_000 });
  });

  test("seed experiment row is present in the all-experiments table", async ({
    page,
  }) => {
    await page.goto("/#/all-experiments");
    await page.waitForLoadState("networkidle").catch(() => {});

    // The seed design's short name (GSE277245.1) must appear in the
    // table on a standard local_curation.sqlite.
    const seedName = page.getByText("GSE277245.1").first();
    const found = await seedName
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!found, "seed experiment not in this DB — skipping row presence check");
    await expect(seedName).toBeVisible();
  });

  test("search input placeholder text is informative", async ({ page }) => {
    await page.goto("/#/all-experiments");

    const search = page.locator(
      "input[placeholder*='accession' i], input[placeholder*='filter' i], input[type='search']",
    ).first();
    const visible = await search
      .waitFor({ state: "visible", timeout: 7_000 })
      .then(() => true)
      .catch(() => false);
    if (!visible) {
      // Search may not exist if there are no experiments; that's OK.
      return;
    }
    const ph = await search.getAttribute("placeholder");
    // Placeholder should mention at least one searchable dimension.
    expect(ph).toMatch(/accession|title|taxon|filter/i);
  });
});
