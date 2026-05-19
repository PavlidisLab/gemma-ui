# CLAUDE.md — apps/browser (GemBrow React)

Orientation for me — the GUI Claude working this app. This app lives at
`apps/browser/` inside the `gemma-ui` monorepo (root at
`~/Dev/gemma-curation-ui/`). Sister app: `apps/curation/` (curator workflow).

Read [`GEMMA_WEB_2_0.md`](./GEMMA_WEB_2_0.md) for the Gemma 2.0 alignment
plan. Read [`REACT_PORT_HANDOFF.md`](./REACT_PORT_HANDOFF.md) for the
original GemBrow-Vue → React port history (mostly done).

## What this app is

The public-facing Gemma browse/search frontend. Lets users search and
filter the ~25K-experiment Gemma corpus by taxon, platform/technology
type, and ontology annotations, then preview individual datasets.

**Current state (2026-05-19):** substantially complete React port.
Working pages: Home (14 variants, pending final pick), Browser/search,
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
GEMMA_BASE_URL=https://staging-gemma.msl.ubc.ca  # default
GEMMA_BASE_URL=http://localhost:9080              # local Gemma 2.0 server
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
Backend is `~/Dev/eclipseworkspace/Gemma/` — **hands-off**. If a backend
change is needed, file it in `GEMMA_WEB_2_0.md` under "P3 — Backend gaps".

The OpenAPI spec is at `gemma-rest/src/main/resources/restapidocs/` in the
Gemma repo. When the Gemma 2.0 server is running locally, fetch it for
typed-client codegen via `openapi-typescript`.

## Aesthetic direction

Paul likes: **Bloom, Cosmos, Tidepool, Brutalist-v2** (warm amber/coral +
teal/blue; spacey, calming, curves, colour-rich).  
Paul dislikes: Library catalog, Specimen plate, old-timey.  
Avoid: stock photos of smiling scientists, DNA ladders, `01010101` overlays.
Abstract data viz / SVG OK. Flat, clean, modern — not stock shadcn.

**Home page variant not yet chosen.** The `?v=<key>` + localStorage switcher
lets Paul flip between them at `http://localhost:5183/`. Need to pick one
before the base website ships.

## Mock system — do not touch

The curation app's dev proxy (`apps/curation/vite.config.ts`) routes to:
- `:8080` — mock REST server (`dev-token-123`)
- `:8090` — proposer/audit service

These must stay working for offline curation. This app's proxy is
completely separate.

## Memory

Session-persistent guidance lives in
`~/.claude/projects/-Users-pzoot-Dev-gemma-curation-ui/memory/`.
`MEMORY.md` is the index — auto-loaded each session.
