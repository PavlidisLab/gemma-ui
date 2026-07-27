# Curation e2e — two tiers: mocked (deterministic) vs `@live`

Playwright specs run against the app served at `http://localhost:5175`.
Split the data dependency deliberately:

## 1. Mocked specs — deterministic, run in the pre-commit gate

Test the **UI**, not data access. Freeze the backend traffic with a HAR
so the spec doesn't depend on the store having a given experiment loaded
or on a remote ontology host being reachable (that dependency was the source of the
parallel-run `@critical` timeouts).

```ts
import { mockExperiment } from "./_mocks";

test.beforeEach(async ({ page }) => {
  await mockExperiment(page, "exp-29184"); // replays e2e/hars/exp-29184.zip
  await page.goto("/#/experiments/29184");
});
```

- Only `/rest/**`, `/local-api/**`, `/find-*` are frozen; the app bundle
  still loads live. An un-recorded backend call **aborts** (loud failure),
  never leaks to the network.
- **Record / refresh a HAR** (needs the backend up + the fixture
  experiment present in the store):
  ```sh
  PWHAR_UPDATE=1 npm run e2e -- e2e/<spec>.spec.ts --workers=1
  ```
  Commit the updated `e2e/hars/<name>.zip`. Re-record when the wire shape
  changes (a stale HAR fails loudly, so you'll know).
- Tag these `@critical` (in the describe **title**, not a comment — that's
  what `--grep` matches) to include them in the pre-commit gate.

## 2. `@live` specs — real backend, run only when it's available

The integration tests we DO want, but that must not fail red when the
store is offline or block a commit.

```ts
import { requiresBackend } from "./_backend";

test.describe("… @live", () => {
  test.beforeEach(async ({ page }) => {
    requiresBackend();               // SKIPS when the backend is down
    await page.goto("/#/experiments/40086");
  });
});
```

- `global-setup.ts` probes the backend once per run; `requiresBackend()`
  reads the result and **skips** (yellow) rather than failing when down.
- Tag the describe `@live` so selection works.

## Commands

| script | runs |
|---|---|
| `npm run e2e:critical` | pre-commit gate — `@critical`, excludes `@live` (mocked, no backend) |
| `npm run e2e:live` | `@live` only — backend integration (skips if store down) |
| `npm run e2e:mocked` | everything except `@live` |
| `npm run e2e` | all specs (`@live` ones skip when the backend is down) |

The pre-commit hook runs `e2e:critical`'s selection, so a commit never
depends on a live backend.
