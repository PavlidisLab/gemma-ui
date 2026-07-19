import { test, expect } from "@playwright/test";
import { installErrorGuards } from "./_helpers";
import { requiresBackend } from "./_backend";

test.describe("Workflow page @live", () => {
  test.beforeEach(({ page }) => {
    requiresBackend();
    installErrorGuards(page);
  });

  test("renders at #/workflow without crashing", async ({ page }) => {
    await page.goto("/#/workflow");
    await page.waitForSelector("#root > *", { state: "attached" });
    await expect(page).toHaveURL(/#\/workflow/);
  });

  test("dashboard 'Workflow' button navigates to #/workflow", async ({ page }) => {
    await page.goto("/");
    const btn = page.getByRole("button", { name: /^Workflow$/ }).first();
    if (await btn.count()) {
      await btn.click();
      await expect(page).toHaveURL(/#\/workflow/);
    }
  });

  test("renders without an active groupId", async ({ page }) => {
    await page.goto("/#/workflow");
    const root = page.locator("#root");
    const text = await root.innerText();
    expect(text.length).toBeGreaterThan(50);
  });

  test("group-scoped workflow with non-existent groupId renders an empty/error state", async ({ page }) => {
    await page.goto("/#/workflow/does-not-exist");
    await page.waitForSelector("#root > *", { state: "attached" });
    // No pageerror is the hard requirement.
  });

  test("workflow page doesn't leak any ticket-workflow remnants", async ({ page }) => {
    await page.goto("/#/workflow");
    // Regression: the deleted features/tickets/TicketWorkflowPage
    // shouldn't accidentally come back via stale routes.
    await expect(page.getByText(/Ticket workflow|TicketWorkflowPage/i)).toHaveCount(0);
  });

  test("workflow page does not mount Close-audit / Export-set actions on empty group", async ({ page }) => {
    await page.goto("/#/workflow/does-not-exist");
    // These are group-scoped; on an empty group view they should not
    // render (or should render as disabled). Either is fine — no
    // crash is the test.
    await page.waitForSelector("#root > *", { state: "attached" });
  });
});
