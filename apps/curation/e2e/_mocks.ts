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
const BACKEND_RE = /\/(rest|local-api|curation)\/|\/find-(publication|term)/;

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
 * 🛑 **The store's paths in these HARs were repointed by script on
 * 2026-08-29, not re-recorded.** The store moved from `/rest/v2` to
 * `/curation/v1` and no backend was up to record against; the responses
 * are unchanged and only the recorded request URLs moved, which is what
 * a real re-record would have produced. Gemma's entries were left alone.
 * A shim that rewrote the URL at replay time does NOT work — the HAR
 * router handles the request before any later route, and aborts on a
 * path it has no entry for.
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
/**
 * The backend MODE the specs run in.
 *
 * 🛑 Same failure as the session pin above, one layer over. `mode` is a
 * capability flag read at boot: the design editor's commit is blocked in
 * remote mode (the whole-design PUT would go straight at Gemma), so the
 * bar renders "blocked" instead of "uncommitted" and six design-editor
 * specs stop finding it — again without a line of spec code changing.
 *
 * `resolveGemmaMode` gives runtime config precedence over build-time
 * env, so serving this pins the mode whatever the container was built
 * with. Local is the right pin: it is the mode the fixtures were
 * recorded in and the one whose full capability set the specs exercise.
 */
const RUNTIME_CONFIG = { mode: "local" };

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
    await page.route("**/curation/v1/__config__", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(RUNTIME_CONFIG),
      }),
    );
  }
}

/** A ticket as the routes below serve it. Loose on purpose — the specs
 *  set only what they assert on. */
export interface MockTicket {
  id: number;
  title: string;
  type: string;
  state?: string;
  acceptsTargets?: boolean;
  targets?: Array<{
    target_type: string;
    target_id: number;
    status?: string;
    display_label?: string;
  }>;
}

/**
 * The ticket routes, served from an in-memory store so a spec can
 * assert on what a CLICK did rather than only on what rendered.
 *
 * 🛑 Registered AFTER `mockExperiment` — Playwright matches handlers in
 * reverse registration order, so these win over the HAR router, which
 * would otherwise abort every ticket call as uncovered.
 *
 * Add and remove mutate the store, so the membership list genuinely
 * changes and a spec can prove the round trip instead of trusting a
 * spinner. Both are idempotent here for the same reason they are on the
 * server: a stale menu must not turn a second click into an error.
 *
 * Returns the store so a spec can inspect it after acting.
 */
export async function mockTickets(page: Page, seed: MockTicket[]) {
  const store = new Map<number, MockTicket>(
    seed.map((t) => [
      t.id,
      { state: "OPEN", acceptsTargets: false, targets: [], ...t },
    ]),
  );
  let nextId = Math.max(0, ...seed.map((t) => t.id)) + 1;

  const json = (body: unknown, status = 200) => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  const hasTarget = (t: MockTicket, id: number) =>
    (t.targets ?? []).some((x) => x.target_id === id);

  // Order matters within this block too: the more specific target
  // routes are registered last so they win over `/tickets/{id}`.
  await page.route("**/tickets/scratchpad", (route) =>
    route.fulfill(
      json({ data: [...store.values()].find((t) => t.type === "SCRATCHPAD") ?? null }),
    ),
  );

  await page.route("**/tickets/search**", (route) => {
    const q = (new URL(route.request().url()).searchParams.get("query") ?? "")
      .trim()
      .toLowerCase();
    // Digits-only is a verbatim id and sorts first — the server's rule,
    // mirrored so a spec can pin it.
    const byId = /^\d+$/.test(q) ? store.get(Number(q)) : undefined;
    const byTitle = [...store.values()].filter(
      (t) => t.id !== byId?.id && t.title.toLowerCase().includes(q),
    );
    const hits = [...(byId ? [byId] : []), ...byTitle].map((t) => ({
      id: t.id,
      title: t.title,
      state: t.state,
      type: t.type,
      targetCount: (t.targets ?? []).length,
      updatedAt: "2026-09-01T00:00:00Z",
    }));
    return route.fulfill(json({ data: hits }));
  });

  await page.route("**/datasets/*/tickets", (route) => {
    const m = route.request().url().match(/datasets\/(\d+)\/tickets/);
    const eid = m ? Number(m[1]) : NaN;
    return route.fulfill(
      json({ data: [...store.values()].filter((t) => hasTarget(t, eid)) }),
    );
  });

  await page.route(/\/tickets\/\d+$/, (route) => {
    const id = Number(route.request().url().match(/tickets\/(\d+)$/)![1]);
    const t = store.get(id);
    return t
      ? route.fulfill(json({ data: t }))
      : route.fulfill(json({ error: { code: 404 } }, 404));
  });

  await page.route(/\/tickets\/\d+\/targets$/, async (route) => {
    const id = Number(route.request().url().match(/tickets\/(\d+)\/targets/)![1]);
    const t = store.get(id);
    if (!t) return route.fulfill(json({ error: { code: 404 } }, 404));
    if (!t.acceptsTargets || t.state !== "OPEN") {
      return route.fulfill(json({ error: { code: 409 } }, 409));
    }
    const body = route.request().postDataJSON() as {
      targets?: Array<{ targetId?: number; target_id?: number }>;
    };
    const added: number[] = [];
    const alreadyPresent: number[] = [];
    for (const x of body.targets ?? []) {
      const tid = (x.targetId ?? x.target_id) as number;
      if (hasTarget(t, tid)) alreadyPresent.push(tid);
      else {
        t.targets!.push({
          target_type: "EXPRESSION_EXPERIMENT",
          target_id: tid,
          status: "NOT_DONE",
        });
        added.push(tid);
      }
    }
    return route.fulfill(json({ data: { added, alreadyPresent, ticket: t } }));
  });

  await page.route(/\/tickets\/\d+\/targets\/[A-Z_]+\/\d+$/, (route) => {
    const m = route
      .request()
      .url()
      .match(/tickets\/(\d+)\/targets\/[A-Z_]+\/(\d+)/)!;
    const t = store.get(Number(m[1]));
    if (!t) return route.fulfill(json({ error: { code: 404 } }, 404));
    const tid = Number(m[2]);
    const row = (t.targets ?? []).find((x) => x.target_id === tid);
    if (!row) return route.fulfill({ status: 204, body: "" });
    t.targets = t.targets!.filter((x) => x.target_id !== tid);
    return route.fulfill(
      json({ data: { targetType: "EXPRESSION_EXPERIMENT", targetId: tid, status: row.status, ticket: t } }),
    );
  });

  // The STORE shape of the same two lists. `useTicketsForExperiment`
  // asks Gemma for `/datasets/{id}/tickets` and the store for
  // `/tickets?target_id=…`, and `useMyTickets` asks for a plain
  // `/tickets` — so a spec that runs in local mode needs these or the
  // ticket menu comes up empty. Mocked from the same store as the
  // routes above so both modes answer identically, which is what this
  // file means by working in either mode.
  await page.route(/\/curation\/v1\/tickets(\?|$)/, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const url = new URL(route.request().url());
    const target = url.searchParams.get("target_id");
    const rows = [...store.values()].filter((t) =>
      target ? hasTarget(t, Number(target)) : true,
    );
    return route.fulfill(json({ data: rows }));
  });

  await page.route("**/curation/v1/tickets", (route) => handleCreate(route));
  await page.route(/\/rest\/v2\/tickets$/, (route) => handleCreate(route));

  function handleCreate(route: Parameters<Parameters<Page["route"]>[1]>[0]) {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const t: MockTicket = {
      id: nextId++,
      title: String(body.title ?? ""),
      type: String(body.type ?? "GENERIC"),
      state: "OPEN",
      acceptsTargets: body.acceptsTargets === true || body.accepts_targets === true,
      targets: (body.targets as MockTicket["targets"]) ?? [],
    };
    store.set(t.id, t);
    return route.fulfill(json({ data: t }));
  }

  return store;
}
