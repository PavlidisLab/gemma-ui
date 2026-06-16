/**
 * Vitest config — extends the dev-server config in ``vite.config.ts``
 * and adds the bits unit/render tests need.
 *
 * Two test environments coexist:
 *   - ``node`` — default; pure JS helpers (most existing
 *     ``*.test.ts`` files under ``src/features/audit/``).
 *   - ``jsdom`` — opted-in per-file via the
 *     ``@vitest-environment jsdom`` docblock at the top of each
 *     render test, OR by file-name suffix (``*.render.test.tsx``)
 *     via the ``environmentMatchGlobs`` rule below.
 *
 * Why both: the existing helper-test suite is fast on node; the new
 * component-render tests need a DOM. Splitting per-file keeps the
 * cheap-and-fast path cheap, and contains the jsdom boot cost to
 * the render tests that genuinely need it. The shared setup
 * (``test/setup.ts``) only runs in jsdom-env files — it imports
 * ``@testing-library/jest-dom`` which would noop on node anyway.
 */
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig({ command: "serve", mode: "test" }),
  defineConfig({
    test: {
      globals: true,
      // Default to node; opt jsdom in for render tests by suffix.
      environment: "node",
      environmentMatchGlobs: [
        ["**/*.render.test.tsx", "jsdom"],
        ["**/*.render.test.ts", "jsdom"],
      ],
      setupFiles: ["./test/setup.ts"],
      // Vitest auto-discovers ``*.spec.ts`` too; e2e/ houses
      // Playwright specs that share the suffix and must NOT load
      // here. Exclude them explicitly. Default exclude (node_modules
      // / dist / .next / etc.) plus our own.
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/e2e/**",
        "**/playwright-results/**",
        "**/test-results/**",
      ],
      // Vitest 4 sometimes loses workspace package resolutions; this
      // mirrors the dev-server's tsconfig paths so render tests can
      // import from ``@/`` and ``@gemma/*`` like the app.
      // (vite.config.ts already injects the same aliases.)
    },
  }),
);
