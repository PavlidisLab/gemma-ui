# Configuration — which backend am I talking to?

How the curation UI decides where its requests go, what `local` and
`remote` mode actually change, and the variables that control both.

Written 2026-08-28, after a day in which pointing the backends at gemma2
did not move the UI, flipping the UI to remote broke three surfaces, and
the e2e gate went red without a line of app code changing. Each of those
is explained below rather than left to be rediscovered.

## 🛑 Mode is a capability flag. The PROXY decides routing.

The single most misleading thing here: **`VITE_GEMMA_MODE` does not
route anything.**

`api/client.ts` calls `fetch(path)` with a RELATIVE path on every
request and never uses `baseUrl`. Where a call actually lands is decided
entirely by the proxy table in `apps/curation/vite.config.ts`. So:

* pointing the backend containers at a different Gemma does **not** move
  the UI out of local mode; and
* flipping the mode does **not** move any request that the proxy table
  does not already send there.

What the mode *does* change is capability and presentation: local mode
serves a synthetic curator from `useMe()` (so sign-out is a no-op), and
hides the SVD diagnostics and the Gemma audit-event history client-side.

## The proxy table

Everything is relative, so this is the whole routing story:

| path | target | notes |
|---|---|---|
| `/rest/…` | local_api (**local**) · Gemma (**remote**) | catch-all |
| `/rest/v2/datasets/*/{svd,sample-correlation,mean-variance}` | `GEMMA_REST_URL` | diagnostics |
| `/rest/v2/annotations/{search,term,children,relations}`, `/rest/v2/genes` | `GEMMA_ONTOLOGY_URL` | ontology |
| `/rest/v2/datasets/{id}/auditEvents` | `GEMMA_REST_URL` | audit trail |
| `/local-api/…` | local_api | explicit bypass of the above |
| `/curation-draft`, `/curation-lock`, `/curation-preflight`, `/curation-commit`, `/curation-sign` | proposer (agent) | writes |
| `/propose`, `/find-term`, `/find-publication`, `/validate-terms` | proposer (agent) | |

🛑 The agent routes have their own top-level prefix on purpose, NOT a
`/rest/v2/...` exception. `/rest` is a catch-all to the store, so a
`/rest/v2/datasets/{id}/curation-draft` would land on the store no
matter what the route was named. Naming cannot defend against that; a
distinct prefix can. Do not add a sixth `/rest/v2/...` exception — the
existing split is recorded as a thing to unwind, not to copy.

⚠️ In **remote mode** `/rest` targets Gemma, so anything store-shaped
(tickets, groups, candidates, audits, curation-proposals) has no backend
at all. Those surfaces degrade; they do not have reduced data.

## Variables

Set at `docker compose up` time. **There is no `.env` file** — values
come from the invoking shell, and anything unset silently takes the
compose default.

| variable | what it does |
|---|---|
| `VITE_GEMMA_MODE` | `local` (default) or `remote`. Capability flag, read once at boot. |
| `VITE_GEMMA_BASE_URL` | Shown by the mode chip. Remote mode refuses to default it and renders `(unset)` rather than pointing somewhere nobody asked for. Set it whenever you set the mode. |
| `VITE_BROWSER_URL` | Where the header's Browse / Admin tabs point. Must serve the BROWSER APP — `Admin` resolves to `<url>/#/admin/system`, a route in our browser app, not a Gemma REST path. |
| `GEMMA_REST_URL` | Diagnostics + audit-trail upstream. |
| `GEMMA_ONTOLOGY_URL` | Ontology search/term upstream. Unset disables that exception. |
| `GEMMA_CURATION_UI_BACKEND` | Repoints the `/rest` catch-all. **Local-mode knob** — in remote mode `/rest` is Gemma unconditionally. |
| `GEMMA_BASE_URL` | The backends' own Gemma. Declared `:?` on `proposer`, i.e. **required** — see the gotcha below. |
| `GEMMA_WRITE_TARGET` | Arms the agent's Gemma writes. Empty = refused. Only set it together with `GEMMA_BASE_URL`, to the same host. |
| `ANTHROPIC_API_KEY` | The proposer's LLM key. No default; blank means every propose/audit fails on auth. |

## Recreating the UI container

```sh
cd docker/local-mode
GEMMA_BASE_URL=https://gemma2.msl.ubc.ca \
GEMMA_REST_URL=https://gemma2.msl.ubc.ca \
GEMMA_ONTOLOGY_URL=https://gemma2.msl.ubc.ca \
VITE_GEMMA_MODE=remote \
VITE_GEMMA_BASE_URL=https://gemma2.msl.ubc.ca \
VITE_BROWSER_URL=https://gemma2.msl.ubc.ca \
docker compose up -d --force-recreate curation-ui
```

🛑 **`GEMMA_BASE_URL` is required even when recreating only the UI.**
Compose interpolates the WHOLE file before it looks at which service you
named, and `proposer` declares it `${GEMMA_BASE_URL:?…}`. Omit it and the
command fails before doing anything.

🛑 **A bare `--force-recreate` silently changes credentials.** With no
`.env`, `GEMMA_USERNAME` / `GEMMA_PASSWORD` fall back to
`groupadmin/groupadmin` and `ANTHROPIC_API_KEY` to a blank string.
Recreate the proposer with its key:

```sh
ANTHROPIC_API_KEY=$(security find-generic-password -s ANTHROPIC_API_KEY -w) \
GEMMA_BASE_URL=https://gemma2.msl.ubc.ca \
docker compose up -d --force-recreate proposer
```

## Scale: Gemma is not the store

The store holds ~600 datasets and caps `limit` at 1000, so the
experiment list pulls the whole catalogue and filters client-side.
**Gemma holds ~25,700 and caps `limit` at 100** — a full walk is 257
sequential requests, which hangs the page. Remote mode therefore takes a
bounded prefix (`REMOTE_CATALOGUE_CAP`) and the list says so. The real
fix is server-side search, or scoping the list to datasets actually
under curation.

## Tests must not depend on any of this

The `@critical` Playwright specs replay every backend call from a HAR
**and** pin the session in `e2e/_mocks.ts`, so they answer the same way
in either mode. That pinning exists because it was missing: switching
the shared `:5175` container to remote turned all 36 specs red —
`useMe()` 403'd, `App` rendered `<LoginPage/>` for every route, and each
spec timed out behind a login screen.

To drive a different server — a second container on another port, a
host-run dev server, a deployed build — one variable:

```sh
PLAYWRIGHT_BASE_URL=http://localhost:5176 npm run e2e
```
