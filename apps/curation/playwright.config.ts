import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the curation UI.
 *
 * Tests run against the dev server that's already up at
 * ``http://localhost:5175`` (the curation-ui docker container).
 * If you're working outside the docker setup, start Vite manually
 * (``npm run dev:curation`` from repo root) before running.
 *
 * To run:    npm --workspace gemma-curation-ui run e2e
 * Single:    npm --workspace gemma-curation-ui run e2e -- e2e/dashboard.spec.ts
 * Headed:    npm --workspace gemma-curation-ui run e2e -- --headed
 */
export default defineConfig({
  testDir: "./e2e",
  // Probe the backend once; @live specs skip when it's down (see
  // e2e/global-setup.ts + e2e/_backend.ts). Mocked specs are unaffected.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  /**
   * 🛑 Capped, because every worker shares ONE dev server.
   *
   * Playwright's local default is `ncpu / 2` — eight browsers on this
   * machine — and they all load modules through the single Vite server
   * at :5175, which transforms them one at a time. Eight cold page
   * loads queue behind each other and the slowest few blow the 30 s
   * timeout, so the pre-commit gate fails a DIFFERENT handful of specs
   * on every run and each of them passes when run alone. That reads as
   * "the change broke something", which is the expensive kind of
   * flake.
   *
   * Measured 2026-08-18 on the same @critical set: 8 workers failed 7
   * then 8 of 36 in 2.2–2.4 min; 4 workers passed 36/36 in 1.9 min.
   * The cap is not a trade — it is faster as well as green, because
   * the contention was never doing work.
   *
   * CI keeps the default: a runner has its own machine and its own
   * `retries: 2`.
   */
  workers: process.env.CI ? undefined : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5175",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], colorScheme: "dark" },
    },
  ],
});
