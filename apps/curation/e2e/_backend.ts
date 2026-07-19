import { test } from "@playwright/test";

/**
 * Gate for specs that genuinely hit the live curation backend (the
 * store at :8095 + gemma-rest + frink ontology) — the integration
 * tests we DO want, but only when the backend is up (Paul 2026-07-18:
 * "we do need tests that hit the backend, but they have to be run when
 * the backend is available").
 *
 * Call at the top of a ``@live`` spec's ``beforeEach``. When the
 * once-per-run backend probe in ``global-setup.ts`` found the store
 * unreachable, the spec SKIPS (yellow) instead of failing (red). Tag
 * the describe ``@live`` too so ``npm run e2e:live`` can select them and
 * the pre-commit gate (``--grep-invert @live``) never runs them.
 *
 * Deterministic UI specs don't call this — they mock their data with
 * ``mockExperiment`` (see ``_mocks.ts``) and run in the pre-commit gate.
 */
export function requiresBackend() {
  test.skip(
    process.env.CURATION_BACKEND_UP === "0",
    "backend not available — @live spec skipped (run when the curation store is up)",
  );
}
