/**
 * Vitest setup file — loaded once per test process.
 *
 * Two responsibilities:
 *   1. Register ``@testing-library/jest-dom`` so render-test specs
 *      can use ``.toBeInTheDocument()`` / ``.toHaveTextContent()`` /
 *      etc. without re-importing per file.
 *   2. Reset the DOM + React Testing Library state between tests so
 *      one test's mount doesn't bleed into the next.
 *
 * Imported by ``vitest.config.ts``. Safe to no-op outside jsdom env
 * (the env-match-globs there gate which files boot jsdom).
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
