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
export async function mockExperiment(page: Page, harName: string) {
  const update = !!process.env.PWHAR_UPDATE;
  // ``.zip`` keeps the whole recording (index + response bodies) in one
  // committed artifact instead of ~70 loose sidecar files.
  await page.routeFromHAR(`e2e/hars/${harName}.zip`, {
    url: BACKEND_RE,
    update,
    notFound: update ? "fallback" : "abort",
  });
}
