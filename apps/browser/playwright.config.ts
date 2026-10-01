import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the browser app.
 *
 * Specs run against a dev server that is already up — the `browser-ui`
 * docker container at ``http://localhost:5183``. Outside the docker
 * setup, start Vite first (`npm run dev:browser` from the repo root).
 * Nothing here starts a server: the same choice the curation config
 * makes, and for the same reason — the container is the server the
 * curator already has.
 *
 *   npm --prefix apps/browser run e2e
 *   npm --prefix apps/browser run e2e:critical
 *   PLAYWRIGHT_BASE_URL=http://localhost:5184 npm --prefix apps/browser run e2e
 *
 * 🛑 Every spec pins the backend with `mockGemma` (see `e2e/_mocks.ts`).
 * This app reads a live Gemma, so an unpinned spec asserts on whatever
 * the corpus holds today — a dataset gets re-annotated and a green
 * suite goes red having found nothing wrong. Pinning also means the
 * suite runs with no Gemma reachable at all.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  /** Capped for the same reason as curation's: every worker loads
   *  modules through ONE Vite server, and eight cold page loads queue
   *  behind each other until the slowest blow their timeout. */
  workers: process.env.CI ? undefined : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5183",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
