import { test } from "@playwright/test";
import { SEED_EXPERIMENT_ID } from "./_helpers";
import { requiresBackend } from "./_backend";

/**
 * Visual capture pass. Run with:
 *   npm --workspace gemma-curation-ui run e2e -- e2e/_screenshots.spec.ts
 * Outputs to ``apps/curation/screenshots/``.
 */

const OUT = "screenshots";

test.describe.configure({ mode: "serial" });

test.beforeEach(() => requiresBackend());

test("dashboard @live", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#root > *", { state: "attached" });
  // Give react-query a beat to populate.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/01-dashboard.png`, fullPage: true });
});

test("dashboard — sets section detail @live", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#root > *", { state: "attached" });
  await page.waitForTimeout(1500);
  const sets = page.getByRole("heading", { name: /sets/i }).first().locator("..").locator("..");
  await sets.screenshot({ path: `${OUT}/02-dashboard-sets.png` });
});

test("dashboard — tickets section detail @live", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#root > *", { state: "attached" });
  await page.waitForTimeout(1500);
  const tickets = page.getByRole("heading", { name: /^Tickets$/ }).first().locator("..").locator("..");
  await tickets.screenshot({ path: `${OUT}/03-dashboard-tickets.png` });
});

test("all-experiments @live", async ({ page }) => {
  await page.goto("/#/all-experiments");
  await page.waitForSelector("#root > *", { state: "attached" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/04-all-experiments.png`, fullPage: true });
});

test("workflow page (no group) @live", async ({ page }) => {
  await page.goto("/#/workflow");
  await page.waitForSelector("#root > *", { state: "attached" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/05-workflow.png`, fullPage: true });
});

test("seed experiment overview @live", async ({ page }) => {
  await page.goto(`/#/experiments/${SEED_EXPERIMENT_ID}`);
  await page.waitForSelector("#root > *", { state: "attached" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/06-experiment-overview.png`, fullPage: true });
});

test("seed experiment design tab @live", async ({ page }) => {
  await page.goto(`/#/experiments/${SEED_EXPERIMENT_ID}?tab=design`);
  await page.waitForSelector("#root > *", { state: "attached" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/07-experiment-design.png`, fullPage: true });
});

test("audits inbox @live", async ({ page }) => {
  await page.goto("/#/audits");
  await page.waitForSelector("#root > *", { state: "attached" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/08-audits-inbox.png`, fullPage: true });
});

test("proposals inbox @live", async ({ page }) => {
  await page.goto("/#/inbox");
  await page.waitForSelector("#root > *", { state: "attached" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/09-proposals-inbox.png`, fullPage: true });
});
