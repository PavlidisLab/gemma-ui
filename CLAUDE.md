# CLAUDE.md — GemBrow

Orientation for the GUI Claude working this repo. **Read
[`REACT_PORT_HANDOFF.md`](./REACT_PORT_HANDOFF.md) first** — it's the
plan-of-record. This file is repo-shape orientation.

## What this repo is

GemBrow — the public-facing browse/search frontend for
[Gemma](https://gemma.msl.ubc.ca). Lets users search and filter the
~25K-experiment Gemma corpus by taxon, platform/technology type, and
ontology annotations, then preview individual datasets and link out
to download endpoints.

**End state:** GemBrow and `~/Dev/gemma-curation-ui/` collapse into a
single React app covering public browse/search + curator workflows.
The React port done on this branch is the merge vehicle: build it on
the curation-ui stack so the two can later live under one root
(likely as `gemma-ui/` inside the Gemma monorepo).

## Branch model

- **`master`** — Vue 2.7 + Vuetify 2.7 (`v0.4.8`). Ships to
  production. **Do not develop new features here.** Bug-only.
- **`react-port`** (this branch, current) — full rewrite to
  React + TypeScript + Tailwind, converging on the
  `~/Dev/gemma-curation-ui/` stack. Greenfield within the same repo;
  the Vue source under `src/` is treated as **specification, not
  starting code** — read it to understand semantics, then re-implement.

## Stack target (match `~/Dev/gemma-curation-ui/`)

React 18, TypeScript 5.6, Vite 5, TanStack Query 5, TanStack Router 1,
Tailwind 3.4. Path alias `@/` → `src/`. Don't introduce divergent
versions — convergence with curation-ui is the point.

## Source files to port (Vue 2, in `src/`)

Listed in port order; line counts give a rough complexity budget.

| File | Lines | What it owns |
|---|---:|---|
| `views/Browser.vue` | 883 | Page shell. Results table, filter chips, paging, URL state, wires everything below. |
| `components/AnnotationSelector.vue` | 592 | **Heaviest.** Faceted filter UI over Gemma's ontology annotation tree. Per-category lazy fetch + selection. |
| `lib/filter.js` | 309 | **Load-bearing.** Builds the Gemma REST `filter` query string from `SearchSettings`. Semantics must match exactly. |
| `config/gemma.js` | 308 | Axios instance, baseURL, `excludedCategories` URI list, markdown helper. |
| `components/DatasetPreview.vue` | 252 | Popover that opens when a result row is clicked. Preserve as popover; don't promote to a page. |
| `components/CodeSnippet.vue` | 250 | Gemma.R / gemmapy snippet generator. |
| `components/AppBar.vue` | 234 | Top nav. |
| `components/SearchSettings.vue` | 193 | Search input + settings panel. |
| `components/TechnologyTypeSelector.vue` | 179 | Microarray vs RNA-seq filter. |
| `components/TaxonSelector.vue` | 134 | Taxon multi-select. |
| `components/DownloadButton.vue` | 132 | Bulk download UX. URL templates must round-trip verbatim. |
| `store/modules/vapi.js` | 131 | Vuex-REST endpoint registry — the canonical list of API endpoints in use. |
| `lib/models.js` | 124 | `SearchSettings`, `Taxon`, other shapes. |
| `lib/utils.js` | 103 | Category-id helper etc. |
| `components/Error.vue` | 110 | |
| `components/AboutDialog.vue` | 102 | |

`views/Dataset.vue` is a 51-line stub — **don't use it as the experiment-page reference**, it's not implemented.

Total: ~3.2K Vue lines → tractable.

## Routes (Vue side, semantics to preserve)

`/`, `/q/:query`, `/t/:initialTaxon`, `/t/:initialTaxon/q/:query`,
`/:preset` — all resolve to `Browser`. The preset path is a named
saved-filter shortcut. Port to TanStack Router with the same shapes.

## Backend

REST client. All calls go to `${VUE_APP_GEMMA_BASE_URL}/rest/v2/...`
with `withCredentials: true` and `paramsSerializer` using
`qs.stringify(..., { arrayFormat: "repeat" })`. Endpoints in use are
enumerated in `src/store/modules/vapi.js`.

**Backend changes are on the table.** The Gemma REST API lives at
`~/Dev/eclipseworkspace/Gemma/` (on its own renovations branch).
If the React port needs a new endpoint, a shape change, or a missing
field, file the ask in `REACT_PORT_HANDOFF.md` under "Open backend
gaps" and coordinate with the backend agent — don't edit that repo
directly, but don't treat the API as frozen either. The OpenAPI spec
lives at `gemma-rest/src/main/resources/restapidocs/` in that repo
and is regenerated each build; pull it for typed-client codegen
(`openapi-typescript`, as curation-ui does).

Base URLs:
- prod: `https://gemma.msl.ubc.ca`
- dev:  `https://dev.gemma.msl.ubc.ca`

API docs: https://gemma.msl.ubc.ca/resources/restapidocs/

## Repos in this constellation

- `~/Dev/GemBrow/` (here) — Vue today, React on this branch.
- `~/Dev/gemma-curation-ui/` — sibling React app. Stack source-of-truth.
  Read its `CLAUDE.md` for conventions (TanStack Query patterns,
  `useDesignDraft`-style hooks, hash routing, `tsc -p tsconfig.app.json
  --noEmit` for typecheck).
- `~/Dev/eclipseworkspace/Gemma/` — Java monorepo, backend. **Hands-off.**
- `~/Dev/eclipseworkspace/baseCode/`, `~/Dev/gsec/` — Gemma deps. **Hands-off.**

## Decisions already made (don't re-litigate)

- One React SPA covers home + browser + (eventually) experiment pages.
- No pixel fidelity to the Vue app — redesign freely.
- **Don't ship a stock shadcn/Tailwind look.** Paul wants to "get away
  from the samey look." Before finalizing visual direction (stage 6),
  present 2–3 distinct mocked-up directions and let Paul pick.
- Vue 2 GemBrow stays shippable on `master`; do not modify it expecting
  to ship.

## Port stages (one PR per stage; see HANDOFF for detail)

1. Scaffold + routes (empty pages for `/`, `/browser`, `/dataset/:id`)
2. Browser view — search box, results table, filter chips, paging
3. AnnotationSelector
4. DatasetPreview (popover, not page)
5. DownloadButton + ancillaries
6. Visual polish — **checkpoint with Paul on direction first**

## Build today (Vue side, for reference only)

`npm run serve` → vue-cli dev server. `npm run build` → `dist/`.
Configs in `.env.{development,staging,production}`. Don't extend
this build — the React port will use Vite, matching curation-ui.

## Memory

Session-persistent guidance lives in
`~/.claude/projects/-Users-pzoot-Dev-GemBrow/memory/`. `MEMORY.md`
is the index — auto-loaded each session. Save there anything that
should follow across sessions; this file is for repo-shape facts.
