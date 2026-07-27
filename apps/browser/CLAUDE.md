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
GEMMA_BASE_URL=<your Gemma REST host>  # no built-in default — set explicitly
GEMMA_BASE_URL=http://localhost:9080    # local Gemma 2.0 server
```

Use port **9080** for a local Gemma 2.0 Java server — **not 8080** which
is reserved for the curation mock (run by `gemma-curation-agents/run_mock.sh`).

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
Backend is the Gemma REST server (Java) — **hands-off**. Backend
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
