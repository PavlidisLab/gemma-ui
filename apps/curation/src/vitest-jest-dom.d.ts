/**
 * Make the ``@testing-library/jest-dom`` matcher types (``toBeInTheDocument``,
 * ``toHaveAttribute``, ``toHaveTextContent``, ``toContainElement``, …) visible
 * to ``tsc -p tsconfig.app.json``.
 *
 * At runtime the matchers are registered by ``test/setup.ts`` (which imports
 * ``@testing-library/jest-dom/vitest``), but that setup file is outside the
 * app tsconfig's ``include``, so its module augmentation of vitest's
 * ``Assertion`` interface was never reaching the render-test type-check.
 * This ambient re-import — living under ``src`` (which IS included) — pulls
 * the same augmentation into the app compilation without changing any runtime
 * behaviour.
 */
import "@testing-library/jest-dom/vitest";
