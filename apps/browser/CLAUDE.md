# CLAUDE.md — apps/browser (GemBrow React)

Orientation for this app. It lives at `apps/browser/` inside the
`gemma-ui` monorepo. Sister app: `apps/curation/` (curator workflow).

This is the GemBrow-Vue → React port (mostly done), aligned to the
Gemma 2.0 web surface.

## What this app is

The public-facing Gemma browse/search frontend. Lets users search and
filter the ~25K-experiment Gemma corpus by taxon, platform/technology
type, and ontology annotations, then preview individual datasets.

**Current state:** substantially complete React port. Working pages:
Home (multiple variants, pending final pick), Browser/search,
Platforms catalogue + detail, Dataset page. Typecheck clean.

**End state:** This app + `apps/curation/` under one shared shell — the
single Gemma 2.0 React frontend.

## Stack

React 18, TypeScript 5.6, Vite 5, TanStack Query 5, TanStack Router 1,
Tailwind 3.4. Path alias `@/` → `src/`. Dev server: port **5183**
(leaves 5173 for curation app). Typecheck: `npm run typecheck:browser`
from repo root (or `tsc -p tsconfig.app.json --noEmit` from this dir).

## Dev proxy

```
GEMMA_BASE_URL=<your Gemma 2.0 REST host>  # no built-in default — set explicitly
GEMMA_BASE_URL=http://localhost:9080    # local Gemma 2.0 server
```

Use port **9080** for a local Gemma 2.0 Java server — **not 8080** which
is reserved for the curation mock (run by `gemma-curation-agents/run_mock.sh`).

The dev server proxies `/rest/*` there, so client code fetches relative
`/rest/v2/...` paths and the browser sees them as same-origin — no
CORS, despite the port difference. **A production build has no such
proxy:** whatever serves `dist/` must answer the API on the same origin
too, at whatever prefix `VITE_GEMMA_API_URL` names (see Deployment).

Client code never hardcodes the API root — it goes through `apiBase` /
`restUrl` in `src/api/base.ts`. A literal `/rest/v2/...` in a fetch is
a bug: it breaks the moment the API sits at any other prefix.

## Deployment

The build is plain static files — no Tomcat, no container, no server
runtime. Publish with:

```sh
scripts/deploy-browser.sh --dry-run   # show what would change
scripts/deploy-browser.sh             # build + rsync --delete
```

Nothing about a specific target lives in the app source or in that
script. Config comes from `.env.production` — one file per deployment,
holding public URLs only, never secrets:

| Var | Drives |
|---|---|
| `VITE_BASE_PATH` | Vite's `base` — the sub-path the app is mounted at, baked into every asset URL. Unset = origin root |
| `VITE_GEMMA_API_URL` | `src/api/base.ts` — the REST root. Unset = `/rest/v2` same-origin, which is right whenever the app is served from the Gemma host itself |
| `VITE_GEMMA_BASE_URL` | absolute origin for links a *human* follows or copies: legacy JSP pages, gemmapy/curl snippets. Never a proxy prefix |
| `DEPLOY_DEST` | where `deploy-browser.sh` publishes to |

Two things that bite:

- **The app must be same-origin with the API.** Gemma's Tomcat CORS
  filter allow-lists exactly one origin — its own — and 403s the
  preflight from anywhere else. Serving the app from the Gemma host
  makes this free. Serving it from any other host means standing up a
  reverse proxy that strips `Origin`, then pointing
  `VITE_GEMMA_API_URL` at that proxy's prefix. There is no
  configuration that makes a plain cross-origin call work.
- **A wrong `base` fails loudly and late.** The build emits
  root-absolute asset URLs that 404 under a sub-path mount. The deploy
  script greps `dist/index.html` for the expected prefix and refuses
  rather than shipping it.

## Routing: the app uses hash routing

URLs are **`…/#/dataset/123`**, not `…/dataset/123`.

Not a preference — a workaround for servers we don't control. Deployed
as static files, a request for `/dataset/123` looks to the web server
like a request for a *file* of that name and 404s before any JS runs.
The cure is one directive telling the server to fall back to
`index.html` — Apache's `FallbackResource`, nginx's `try_files` — and
where this app is hosted we can't install it. The fragment is never
sent to the server, so hash routing sidesteps the problem entirely:
every route resolves against `index.html`, the one URL the server
reliably serves.

Consequences worth knowing before touching routing code:

- **No `basepath` on the router.** The fragment is its own path
  universe starting at `/`; a sub-path mount is not part of it.
  `createHashHistory` re-attaches the prefix by keeping the live
  `window.location.pathname`. Setting `basepath` would make the router
  hunt for `#/<mount>/browser` and match nothing.
- **`window.location.search` is empty.** Query params live *inside* the
  fragment. Read them from router state
  (`useRouterState(s => s.location.search)`), never from
  `window.location` — that's what `useUrlInitial` does.
- **The fragment is shared.** The Visualize tab keeps its gene
  selection there as a second `#`: `#/dataset/9#genes=1,2`. See
  `splitFragment` in `VisualizeTab.tsx`.
- **Never hand-roll an app URL.** Build share links through the router
  (`buildLocation().publicHref` + `history.createHref`) and in-app
  links with `<Link to>`, never a raw `<a href="/platforms">` — those
  skip both the mount prefix and the `#`.

`src/lib/hashRouting.test.ts` pins all of the above.

**To undo once a fallback directive is available:** drop `history:`
from `createRouter` and run that test file — it documents what
changes. Everything else already works in both modes.

## Where things live

| Area | Path |
|---|---|
| Shared AppShell + AppBar | `src/features/shared/` |
| Home page + variants | `src/features/home/`, `src/features/home/variants/` |
| Browser/search (main page) | `src/features/browser/` |
| Platforms catalogue + detail | `src/features/platforms/` |
| Dataset page | `src/features/dataset/` |
| API endpoints + query fns | `src/api/endpoints.ts`, `src/api/client.ts` |
| Filter logic | `src/lib/filter.ts` |
| Shared types | `src/lib/types.ts` |
| Gemma config (base URL, excluded categories) | `src/lib/gemmaConfig.ts` |
| Routes | `src/routeTree.tsx` |

## Backend

REST client. All calls to `/rest/v2/...` (proxied through Vite dev server).
Backend is the Gemma 2.0 REST server (Java) — **hands-off**. Backend
changes are filed against the Gemma repo, not made here.

The OpenAPI spec is at `gemma-rest/src/main/resources/restapidocs/` in the
Gemma repo. When the Gemma 2.0 server is running locally, fetch it for
typed-client codegen via `openapi-typescript`.

## Aesthetic direction

Design direction: warm amber/coral + teal/blue; spacey, calming,
curves, colour-rich. Avoid stock photos of smiling scientists, DNA
ladders, `01010101` overlays. Abstract data viz / SVG OK. Flat,
clean, modern — not stock shadcn.

**Home page variant not yet chosen.** The `?v=<key>` + localStorage
switcher flips between them at `http://localhost:5183/`. Need to pick
one before the base website ships.

## Mock system — do not touch

The curation app's dev proxy (`apps/curation/vite.config.ts`) routes to:
- `:8082` — local_api curation server (`dev-token-123`)
- `:8090` — proposer/audit service

These must stay working for offline curation. This app's proxy is
completely separate.
