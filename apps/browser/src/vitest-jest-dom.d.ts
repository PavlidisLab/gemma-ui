/**
 * Make the ``@testing-library/jest-dom`` matcher types
 * (``toBeInTheDocument``, ``toHaveAttribute``, …) visible to
 * ``tsc -p tsconfig.app.json``.
 *
 * At runtime the matchers are registered by ``test/setup.ts``, which
 * imports ``@testing-library/jest-dom/vitest``. That file sits outside
 * the app tsconfig's ``include``, so its augmentation of vitest's
 * ``Assertion`` interface never reached the render tests' type-check
 * and every ``toBeInTheDocument`` was a TS2339. This ambient re-import
 * lives under ``src`` (which IS included) and pulls the same
 * augmentation in, changing nothing at runtime.
 *
 * Copied from `apps/curation/src/vitest-jest-dom.d.ts` — same problem,
 * same fix.
 */
import "@testing-library/jest-dom/vitest";
