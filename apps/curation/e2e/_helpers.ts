import { Page, Locator, expect } from "@playwright/test";

/** The single seed design in ``local_curation.sqlite.fresh.bak``. */
export const SEED_EXPERIMENT_ID = 89342;
export const SEED_EXPERIMENT_SHORT_NAME = "GSE277245.1";

/** Wrap `page` with the standard error-guard hooks every spec wants:
 *  ``pageerror`` throws, and ``console.error`` throws unless the
 *  message is a known harmless React-dev / Vite warning. */
export function installErrorGuards(page: Page) {
  page.on("pageerror", (e) => {
    throw new Error(`pageerror: ${e.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Known-harmless dev-mode noise. Add tightly when needed.
    if (
      text.includes("Warning: ") ||
      text.includes("React Router") ||
      text.includes("[vite]") ||
      // TanStack-query dev: 404s on missing data aren't UI bugs.
      text.match(/Failed to load resource/) ||
      text.match(/the server responded with a status of 404/)
    ) {
      return;
    }
    throw new Error(`console.error: ${text}`);
  });
}

/** Tab buttons in the experiment shell are plain ``<button>``s, not
 *  ARIA ``role="tab"``. The active-tab style adds ``font-medium`` to
 *  the button's class. */
export function tabButton(page: Page, label: string): Locator {
  return page.getByRole("button", { name: new RegExp(`^${label}$`) }).first();
}

export async function expectTabActive(page: Page, label: string) {
  await expect(tabButton(page, label)).toHaveClass(/font-medium/);
}

export async function expectTabInactive(page: Page, label: string) {
  await expect(tabButton(page, label)).not.toHaveClass(/font-medium/);
}

/** Navigate to the seed experiment's shell. */
export async function gotoSeedExperiment(page: Page, tab?: string) {
  const hash = tab
    ? `#/experiments/${SEED_EXPERIMENT_ID}?tab=${tab}`
    : `#/experiments/${SEED_EXPERIMENT_ID}`;
  await page.goto("/" + hash);
  // Banner with the accession is the indicator the shell has mounted.
  await expect(page.getByText(SEED_EXPERIMENT_SHORT_NAME).first()).toBeVisible({
    timeout: 10_000,
  });
}
