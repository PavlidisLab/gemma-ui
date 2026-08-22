/**
 * Vitest config for the browser app.
 *
 * The app had no test runner at all — `src/lib/baseline.test.ts` sat
 * orphaned, and the pre-commit gate only ran `apps/curation`. vitest
 * and jsdom are already hoisted to the workspace root, so this needed
 * no new dependency.
 *
 * `environment: "node"` because everything under test here is a pure
 * function: filter construction, share-link codec, initial-settings
 * derivation. Nothing renders. If a render test ever lands, copy the
 * curation app's `environmentMatchGlobs` split rather than paying the
 * jsdom boot cost across the whole suite.
 */
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig({ command: "serve", mode: "test" }),
  defineConfig({
    test: {
      globals: true,
      environment: "node",
      exclude: ["**/node_modules/**", "**/dist/**"],
    },
  }),
);
