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
  fullyParallel: true,
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
