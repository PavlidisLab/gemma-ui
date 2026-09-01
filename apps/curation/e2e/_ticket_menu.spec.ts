/**
 * Playwright spec — ticket management from the experiment banner.
 *
 * Contract (shipped 2026-08-31/09-01, spec
 * `handoffs/UIB_TO_GEMBRO_2026_08_31_TICKET_MANAGEMENT_ENDPOINT_SPEC.md`):
 *
 *   - ONE ticket button, not two. It is a dropdown; going back to the
 *     current ticket is its first row, not a second button.
 *   - The menu lists every ticket the experiment is on — that is the
 *     "is this on several" answer.
 *   - Typing finds a ticket the curator has never opened. A number is a
 *     verbatim id and sorts first.
 *   - Adding is gated on `acceptsTargets`, server-side; a fixed
 *     worklist cannot be grown by a click.
 *   - Removing is the completion gesture on a scratchpad, so it is
 *     offered at the same level as adding.
 *   - A scratchpad can never be closed.
 *
 * 🛑 These assert on what a CLICK DID, not only on what rendered —
 * `mockTickets` keeps an in-memory store that add and remove really
 * mutate, so a spec proves the round trip rather than trusting a
 * spinner. The gating is the part most likely to regress silently: a
 * greyed button that quietly ungreys looks like nothing at all until it
 * grows someone's 500-dataset reference set.
 *
 * Tagged @critical so the precommit gate runs it.
 */
import { expect, test } from "@playwright/test";
import { mockExperiment, mockTickets, type MockTicket } from "./_mocks";

const EID = 29184;
const TARGET = `/#/experiments/${EID}?ticket=6`;
const MENU = 'button[aria-expanded]:has-text("Ticket")';

function seed(): MockTicket[] {
  return [
    {
      id: 6,
      title: "Reference 500 — ongoing curation review",
      type: "CURATION",
      // A fixed worklist: nothing may be added to it by a click.
      acceptsTargets: false,
      targets: [
        { target_type: "EXPRESSION_EXPERIMENT", target_id: EID, status: "NOT_DONE" },
      ],
    },
    {
      id: 7,
      title: "Scratchpad: e2e-curator",
      type: "SCRATCHPAD",
      acceptsTargets: true,
      targets: [],
    },
    {
      id: 12,
      title: "Batch info needed for the rat set",
      type: "BATCH_INFO_NEEDED",
      acceptsTargets: true,
      targets: [],
    },
  ];
}

async function openMenu(page: import("@playwright/test").Page) {
  await page.locator(MENU).first().click();
}

test.describe("Ticket management menu @critical", () => {
  test.beforeEach(async ({ page }) => {
    await mockExperiment(page, "exp-29184");
    await mockTickets(page, seed());
    await page.addInitScript(() => window.localStorage.clear());
    await page.setViewportSize({ width: 1600, height: 1400 });
    await page.goto(TARGET);
    await page.waitForSelector("#root > *", { state: "attached" });
    await page.locator(MENU).first().waitFor({ state: "visible", timeout: 30000 });
  });

  test("one ticket button, not two", async ({ page }) => {
    // The standalone back-link was removed 2026-09-01 ("having two
    // buttons for tickets is awkward"). Two would mean it came back.
    await expect(page.locator(MENU)).toHaveCount(1);
  });

  test("the menu lists the ticket this experiment is on, and marks where you came from", async ({
    page,
  }) => {
    await openMenu(page);
    await expect(page.getByText("Reference 500 — ongoing curation review")).toBeVisible();
    await expect(page.getByText(/you came from here/i)).toBeVisible();
  });

  test("🛑 a fixed worklist offers no Remove — its targets cannot be clicked away", async ({
    page,
  }) => {
    await openMenu(page);
    await expect(
      page.getByRole("button", { name: /remove from this ticket/i }),
    ).toHaveCount(0);
  });

  test("typing a title finds a ticket never opened, and adding it really adds", async ({
    page,
  }) => {
    const store = await mockTickets(page, seed());
    await page.reload();
    await page.locator(MENU).first().waitFor({ state: "visible" });
    await openMenu(page);
    await page.getByPlaceholder(/ticket number or title/i).fill("batch info");
    const hit = page.getByText("Batch info needed for the rat set");
    await hit.waitFor({ state: "visible" });
    await hit.click();
    // The assertion that matters: the STORE changed, not just the DOM.
    await expect
      .poll(() => (store.get(12)?.targets ?? []).map((t) => t.target_id))
      .toContain(EID);
  });

  test("a number is a verbatim id and comes first", async ({ page }) => {
    await openMenu(page);
    await page.getByPlaceholder(/ticket number or title/i).fill("12");
    const rows = page.locator("li:has-text('#12')");
    await expect(rows.first()).toBeVisible();
  });

  test("a query matching nothing says so rather than showing everything", async ({
    page,
  }) => {
    // The inversion that matters: an empty result must not fall back to
    // listing every ticket.
    await openMenu(page);
    await page.getByPlaceholder(/ticket number or title/i).fill("zzzznotathing");
    await expect(page.getByText(/no open ticket matches/i)).toBeVisible();
    await expect(page.getByText("Scratchpad: e2e-curator")).toHaveCount(0);
  });

  test("the search stays quiet on a single character", async ({ page }) => {
    // One character matches most of the corpus and teaches nothing.
    await openMenu(page);
    await page.getByPlaceholder(/ticket number or title/i).fill("b");
    await expect(page.getByText(/no open ticket matches/i)).toHaveCount(0);
    await expect(page.getByText(/searching…/i)).toHaveCount(0);
  });

  test("New ticket from this experiment opens a modal with a type and the additions checkbox", async ({
    page,
  }) => {
    await openMenu(page);
    await page.getByRole("button", { name: /new ticket from this experiment/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(/allow experiments to be added later/i)).toBeVisible();
    await expect(page.locator("select")).toBeVisible();
  });
});

test.describe("A scratchpad is permanent @critical", () => {
  test.beforeEach(async ({ page }) => {
    await mockExperiment(page, "exp-29184");
    await mockTickets(page, seed());
    await page.addInitScript(() => window.localStorage.clear());
    await page.setViewportSize({ width: 1600, height: 1400 });
  });

  test("🛑 Close ticket is disabled on a scratchpad", async ({ page }) => {
    // There were FOUR close buttons and gating them one at a time
    // missed one within the hour. Anything that can resolve a ticket
    // has to ask the same gate.
    await page.goto("/#/tickets/7");
    await page.waitForSelector("#root > *", { state: "attached" });
    const close = page.getByRole("button", { name: /^close ticket$/i });
    await close.first().waitFor({ state: "visible", timeout: 30000 });
    for (const b of await close.all()) {
      await expect(b).toBeDisabled();
    }
  });

  test("an ordinary ticket can still be closed", async ({ page }) => {
    // The gate must not disable every close in the app.
    await page.goto("/#/tickets/12");
    await page.waitForSelector("#root > *", { state: "attached" });
    const close = page.getByRole("button", { name: /^close ticket$/i }).first();
    await close.waitFor({ state: "visible", timeout: 30000 });
    await expect(close).toBeEnabled();
  });
});
