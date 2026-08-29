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

## Which host is production?

Measured 2026-08-28 against `/rest/v2/datasets/count`:

| host | anonymous | as `administrator` | tier |
|---|---:|---:|---|
| `gemma.msl.ubc.ca` | 23,744 | 25,694 | production |
| `gemma2.msl.ubc.ca` | 23,547 | 25,695 | production |
| anything else | — | — | unverified |

🛑 **The count is a function of who is asking.** A logged-in
GROUP_ADMIN sees the non-public datasets an anonymous caller does not,
so a corpus size means nothing without the credential that produced it.
`REMOTE_CATALOGUE_CAP`'s 25,695 is the authenticated figure, because
that is the walk the UI actually does.

Both hosts carry the real corpus, and authenticated they are within one
dataset of each other. That similarity is not evidence of a safe copy —
it is what one database looks like under two names.
`staging-gemma.msl.ubc.ca` no longer serves `/rest/v2` at all (404).

The mode chip reads that list — `PROD_GEMMA_HOSTS` in
`apps/curation/src/lib/gemmaMode.ts` — and **fails closed**: a remote
host that is not on it takes the amber warning tier, never a mild one,
because a hostname cannot tell a sandbox from production.

**The chip does not promise a confirmation step, because none is
wanted.** No write path consults the mode or the tier, and the agent's
`require_gemma_write_base` guard cannot cover these — they never reach
the agent.

🛑 **This is not a risk list. Read the direction before the table.**
Paul, 2026-08-29: a curator **should** be able to make a dataset public
from this UI, and **we are moving away from the local store.** So
`/rest/v2` is where this app is heading, not where it is leaking to, and
`/curation/v1` is scaffolding for a service being retired rather than a
safe harbour. An earlier version of this section had that backwards and
described a curator capability as an exposure.

**Curator actions against the real Gemma in remote mode.** Working as
intended; listed so the surface is known, not so it gets gated:

| what | call |
|---|---|
| pipeline step dispatch | `POST /rest/v2/datasets/{id}/{step}` |
| GEEQ recalculate | `POST /rest/v2/datasets/{id}/geeq/recalculate` |
| DEA run | `POST /rest/v2/datasets/{id}/analyses/differential` |
| DEA redo | `POST .../analyses/differential/{id}/redo` |
| DEA delete | `DELETE .../analyses/differential/{id}` |
| curation details | `PUT /rest/v2/datasets/{id}/curationDetails?reviewer=` |
| outlier flag | `PUT /rest/v2/datasets/{id}/samples/{sampleId}/outlier` |
| quantitation-type preferred | `PATCH /rest/v2/datasets/{id}/quantitationTypes/{qtId}` |
| visibility | `POST /rest/v2/datasets/{id}/makePublic` / `makePrivate` |

**Still on the store today**, because the store still serves them, not
because reaching Gemma would be wrong:

| what | where |
|---|---|
| short name, publish | `/curation/v1/…` (`api/datasets.ts`). 🛑 "Publish" here writes the STORE and is NOT `makePublic` — two different verbs on two different services |
| curation sets / groups, candidates | `/curation/v1/…` |
| ticket target status, ticket create | already mapped to Gemma's own routes — `api/tickets.ts` |

**One thing IS deliberately refused**, and for a mechanical reason
rather than a policy one: the whole-design save
(`REMOTE_DESIGN_SAVE_REFUSED`, `api/design.ts`). It emits the store's
`Design` shape, and Gemma's `PUT /datasets/{dataset}/design` reads an
`ExperimentalDesignValueObject` — lifting the gate alone would send a
store payload at a Gemma route. Separately, **curation** writes
(annotations, design, drafts, locks) go through the agent per Paul's
2026-08-25 ruling. Neither of those covers the ops actions above.

🛑 **Say "the curation write path goes through the agent", never "the UI
does not write to Gemma".** The second is read as whole-app and is
false — the nine above say so, and they are supposed to be there.

🛑 **Three of these live in `api/workflow.ts`, not in the file named
after the noun** — outlier is not in `diagnostics.ts`, the QT edit is not
in `quantitation.ts` (which is GET-only), and visibility is not in a
`visibility.ts`. They are pipeline operations, so they sit with the
pipeline.

🛑 **And the way they went missing from an earlier version of this list
was not that** — it was `grep … | head -14` over `workflow.ts` itself.
The three sit at lines 466, 480 and 498; the output stopped short of
them, and nothing in a truncated result says whether you reached the end.

⇒ **An absence cannot be proved from a capped read.** For any claim of
the form "there is no write for X", the search must be uncapped or
counted, and the count reported next to the claim. A `head` on a search
for absence silently turns "I did not look" into "it is not there".

**So here is the count, and how to redo it.** 54 mutating `api.*` calls
in the curation app, of which **12** name a `/rest/v2` path. The path is
often on the line AFTER the call, so a single-line grep finds only two of
them — look ahead three lines:

```sh
cd apps/curation/src
git grep -nE -A3 'api\.(post|put|patch|delete)<' -- . \
  | awk '/api\.(post|put|patch|delete)</ {want=1; next}
         want && /\/rest\/v2\// {print; want=0}'
```

Twelve minus three that are not ops writes leaves the nine tabled above:

| excluded | why |
|---|---|
| `api/design.ts` whole-design PUT | gated — `REMOTE_DESIGN_SAVE_REFUSED` |
| `api/session.ts` login | authentication, not a data write |
| `api/workflow.ts` `POST /datasets/pipeline-status` | **a READ.** POST only because the id list is too long for a query string; it sits inside a `useQuery`. A verb-based grep will keep flagging it — it is not a write |

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
