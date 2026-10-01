/**
 * Vitest config for the browser app.
 *
 * Two environments, split by file name — the pattern copied from
 * `apps/curation/vitest.config.ts`:
 *   - ``node`` (default) for the pure-function suites: filter
 *     construction, share-link codec, initial-settings derivation.
 *   - ``jsdom`` for the render tests, which mount real pages against a
 *     stubbed `fetch` (see `test/renderRoute.tsx` and
 *     `test/gemmaFetch.ts`). Opted in per file by the
 *     ``@vitest-environment jsdom`` docblock at the top — vitest 4
 *     dropped `environmentMatchGlobs`, so the docblock is the only
 *     switch, and a render test without it fails on "document is not
 *     defined".
 *
 * The split is what keeps the cheap path cheap: jsdom boots only for
 * the files that need a DOM, and `test/setup.ts` (jest-dom matchers,
 * the observer / canvas shims) runs with it.
 *
 * vitest, jsdom, @testing-library/* and @playwright/test are hoisted to
 * the workspace root and declared in this app's package.json.
 */
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig({ command: "serve", mode: "test" }),
  defineConfig({
    test: {
      globals: true,
      environment: "node",
      setupFiles: ["./test/setup.ts"],
      // Playwright specs share the `*.spec.ts` suffix vitest
      // auto-discovers and must not load here.
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/e2e/**",
        "**/playwright-results/**",
        "**/test-results/**",
      ],
      // `npm run test:coverage`. Off by default so `npm test` and the
      // pre-commit gate don't pay for instrumentation.
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts", "src/main.tsx"],
        reporter: ["text-summary", "html"],
        reportsDirectory: "coverage",
      },
    },
  }),
);
