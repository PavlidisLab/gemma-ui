import type { Page } from "@playwright/test";

/**
 * Backend DATA endpoints the curation UI reads on load — the vite-proxy
 * targets local_api / gemma-rest (``/rest/v2/…``, incl. the ontology-search
 * exception under ``/rest/v2/annotations``), the explicit
 * ``/local-api`` passthrough, and the publication/term lookups.
 *
 * Deliberately scoped to these prefixes only: NOT the app bundle (Vite
 * serves source modules from paths that contain ``/audit/`` etc., so a
 * loose ``/audit`` alternation would freeze the app's own code), and NOT
 * the ``/audit/{accession}/stream`` SSE or ``/propose`` action endpoints
 * (used to RUN an audit/proposal, never hit by a read-only render spec).
 */
const BACKEND_RE = /\/(rest|local-api)\/|\/find-(publication|term)/;

/**
 * Freeze a fixture experiment's backend traffic so a spec tests the UI,
 * not data access. Replays recorded responses from
 * ``e2e/hars/<harName>.har`` for every backend call; the app bundle
 * still loads live. Removes the pre-commit @critical gate's dependence
 * on the store having a given experiment loaded and on remote ontology-host
 * latency (the source of the parallel-run timeouts).
 *
 * Record / refresh — needs the backend up AND the fixture experiment
 * present in the store:
 *
 *   PWHAR_UPDATE=1 npm run e2e -- e2e/<spec>.spec.ts --workers=1
 *
 * That hits the live backend and rewrites the HAR; commit the result.
 *
 * Replay (default, offline): serves from the HAR. A backend call the
 * HAR doesn't cover ABORTS — failing the test loudly rather than
 * leaking to the live network — so a stale HAR is caught, never
 * silently served live. Re-record when the wire shape changes.
 *
 * Call in ``beforeEach`` BEFORE ``page.goto``.
 */
/**
 * The session the specs run as.
 *
 * 🛑 **Pinned so the gate does not depend on the dev server's MODE.**
 * `useMe()` returns a synthetic curator in local mode and fetches
 * `/rest/v2/me` in remote mode; against Gemma without a session that
 * 403s, `App` renders `<LoginPage/>` for every route, and every spec
 * then times out waiting for content behind a login screen. That is
 * exactly what happened on 2026-08-28 when the shared container at
 * :5175 was switched to remote — 36 specs went red without a line of
 * app code changing.
 *
 * Serving this makes the suite answer the same way in either mode,
 * which is what "data-mocked and deterministic" was always supposed to
 * mean. Registered AFTER the HAR route so it wins: Playwright matches
 * handlers in reverse registration order.
 */
const SESSION_USER = {
  username: "e2e-curator",
  full_name: "E2E Curator",
  email: "e2e@example.org",
  authorities: ["GROUP_ADMIN"],
};

export async function mockExperiment(page: Page, harName: string) {
  const update = !!process.env.PWHAR_UPDATE;
  // ``.zip`` keeps the whole recording (index + response bodies) in one
  // committed artifact instead of ~70 loose sidecar files.
  await page.routeFromHAR(`e2e/hars/${harName}.zip`, {
    url: BACKEND_RE,
    update,
    notFound: update ? "fallback" : "abort",
  });
  // Not recorded into the HAR: in local mode the app never asks, so
  // re-recording would not capture it, and the specs must work in both
  // modes rather than in whichever one the HAR happened to see.
  if (!update) {
    await page.route("**/rest/v2/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(SESSION_USER),
      }),
    );
  }
}
