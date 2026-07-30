# apps/browser — GemBrow

The public-facing browse / search frontend for [Gemma](https://gemma.msl.ubc.ca).
Lets users search and filter the Gemma corpus by taxon,
platform/technology type, and ontology annotations, then preview
individual datasets. This is a React port of the original Vue 2
GemBrow — the Vue app's history is preserved in this repo's git log
via `git subtree`, but the app itself has been fully rewritten; there
is no Vue code left to run.

## Stack

Vite + React 18 + TypeScript + TanStack Query + TanStack Router +
Tailwind CSS. See [`CLAUDE.md`](./CLAUDE.md) for app-internal
orientation (where things live, backend routing, design direction).

## Running

```bash
cp .env.example .env.local     # one-time — set GEMMA_BASE_URL
npm install                    # one-time (installs both apps via workspaces)
npm run dev                    # → http://localhost:5183
```

`GEMMA_BASE_URL` must point at a running **Gemma 2.0** REST API —
older Gemma versions don't expose the `/rest/v2/...` surface this
app requires. There is no built-in default. The dev server proxies
`/rest/*` to it.

Other scripts (run from this directory, or via the root
`npm run <script>:browser` aliases):

```bash
npm run build       # tsc -b && vite build
npm run typecheck   # tsc -p tsconfig.app.json --noEmit
```

## Backend

REST client only — all calls go to `/rest/v2/...` (proxied through
the Vite dev server in development). The backend is the Gemma 2.0
REST server (Java); this app treats it as hands-off — backend
changes are filed against the Gemma project, not made here.

## License

Apache-2.0.
