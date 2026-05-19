# GemBrow → React port (handoff)

Filed 2026-05-17 by the Spring/Hibernate renovations agent.

## What you're doing

Rewrite GemBrow — the public-facing browse/search frontend for
[Gemma](https://gemma.msl.ubc.ca) — from Vue 2 + Vuetify to React +
TypeScript + Tailwind, to converge on the same stack as
`~/Dev/gemma-curation-ui` (the curator review UI). End state: a
single React app that covers the home page, the browser/search,
and (later) experiment pages.

This is happening in parallel with a Spring 3 → Spring 5 →
Spring 6 backend renovation in `~/Dev/eclipseworkspace/Gemma`. The
backend agent is not touching this repo. Stay out of theirs.

## Repos and where things go

- `~/Dev/GemBrow/` — this repo. Vue 2.7 + Vuetify 2.7, v0.4.8. About
  3.2K lines of Vue across `src/`. **Source of truth for what to
  preserve.** Continues to ship to production until the React port
  lands.
- `~/Dev/gemma-curation-ui/` — React + TS + Tailwind, the
  destination stack. Has substantial existing surface area
  (audit/calibration/curation flows). Read its `CLAUDE.md` and
  `*_HANDOFF.md` files for the patterns in use.
- `~/Dev/eclipseworkspace/Gemma/` — the Java monorepo. Hands off
  the REST API the React app consumes. **Do not touch.** The
  renovations branch lives there with its own state.

Paul has stated the new React app will eventually be absorbed into
the Gemma monorepo (likely as `gemma-ui/` alongside `gemma-rest/`),
and that GemBrow + `gemma-curation-ui` will collapse into a **single
React app** — public browse/search + curator workflows under one
shell. Build the port on the curation-ui stack so that merge is
mechanical later.

For now: develop on the `react-port` branch in this repo (Vue 2
master stays shippable). Sibling-repo or in-place merge with
curation-ui is a later call.

## Decisions already made (don't re-litigate)

- **One React app, not many.** Home + browser + experiment pages
  all under a single SPA. Multiple SPAs were considered and
  rejected — too much shell duplication.
- **Built on the `gemma-curation-ui` foundation.** Same React
  version, TypeScript, Tailwind, build setup.
- **Pixel fidelity to GemBrow is not a goal.** You may redesign
  freely; the bar is "preserve information density and filter
  semantics, redo the visuals."
- **Look-and-feel matters.** Paul has flagged that he wants to
  "get away from the samey look" of default Tailwind designs. Do
  not ship anything that looks like a stock shadcn/Tailwind theme.
  Before you finalize a visual direction, surface options to Paul
  and get his call. This is not a place to be opinionated alone.
- **Vue 2 GemBrow stays in production** during the transition. The
  React port is greenfield, not in-place. Don't modify the Vue
  code expecting it to ship.

## What's in GemBrow today

```
src/
├── App.vue
├── main.js
├── router.js                  # 2 routes: Browser, Dataset
├── store/                     # Vuex modules
├── plugins/                   # Vuetify init
├── config/
├── lib/
├── assets/
├── views/
│   ├── Browser.vue            # 883 lines — the main view
│   ├── Dataset.vue            # 51 lines — stub, do NOT use
│   │                          # as the experiment page reference
│   └── NotFound.vue           # 54 lines
└── components/
    ├── AnnotationSelector.vue # 592 lines — heaviest component;
    │                          # faceted filtering over the
    │                          # ontology annotation tree
    ├── DatasetPreview.vue     # 252 lines — the popover that
    │                          # appears on click in the results
    │                          # table (the real "preview")
    ├── CodeSnippet.vue        # 250 lines — code-block helper
    │                          # for Gemma.R / gemmapy snippets
    ├── AppBar.vue             # 234 lines — top nav
    ├── SearchSettings.vue     # 193 lines
    ├── TechnologyTypeSelector.vue
    ├── TaxonSelector.vue
    ├── DownloadButton.vue     # 132 lines — links to bulk
    │                          # download endpoints
    ├── Error.vue
    ├── AboutDialog.vue
    ├── DocumentationWindow.vue
    ├── AnnotationSelector.vue
    └── SearchSettings.vue
```

Total ~3.2K Vue lines. Tractable to port faithfully.

Heavy/load-bearing pieces (read these first to understand the
data flow):

1. `views/Browser.vue` — the page. Owns the results table, the
   filter chips, paging, and the wiring between everything else.
2. `components/AnnotationSelector.vue` — the faceted filter UI
   over Gemma's ontology annotations. Most complex single
   component. Read its store interactions in `src/store/`.
3. `components/DatasetPreview.vue` — what shows when a user clicks
   a result. Currently a popover, not a dedicated page. The new
   experiment page (planned for a later phase) **expands on**
   this content; for the port itself, preserve the popover.
4. `components/DownloadButton.vue` — preserves the dataset bulk
   download UX. The download endpoints are stable; copy the URL
   templates verbatim.

## Backend (changes ARE on the table — coordinate)

GemBrow is a REST client of the Gemma REST API at `/rest/v2/...`.
Use the endpoints GemBrow already calls as the starting set — grep
`src/store/modules/vapi.js` and the `axios` instances under `src/`
to enumerate them.

**Backend changes are allowed.** If the React port needs a new
endpoint, a shape tweak, or a field that doesn't exist yet, file it
below under "Open backend gaps" with the use case. Don't edit
`~/Dev/eclipseworkspace/Gemma/` directly — the backend agent owns
that — but don't accept the current API as a hard constraint either.

The OpenAPI spec is bundled in the Gemma repo at
`gemma-rest/src/main/resources/restapidocs/` and is regenerated on
every backend build. Pull it for typed-client codegen — `gemma-curation-ui`
already uses `openapi-typescript` against `http://localhost:8080/openapi.json`;
mirror that pattern.

## Stack expectations (pin where curation-ui pins)

Match `~/Dev/gemma-curation-ui/package.json` versions where they
overlap. Don't introduce divergent versions of React, TypeScript,
Tailwind, the router, the form library, the query/cache library,
etc. The point of the port is convergence; new version churn
defeats that.

Specifically:
- React 18 (whatever curation-ui is on)
- TypeScript: same minor version
- Tailwind: same minor version, same plugin set
- Router: `react-router-dom` (or whatever curation-ui uses)
- HTTP client: prefer the existing pattern (TanStack Query +
  fetch, or axios — match curation-ui)
- State: prefer React Query for server state +
  `useState`/`useReducer` for local. **Don't introduce Redux**
  unless curation-ui already has it.

## Staging suggested (one PR per stage)

1. **Scaffold + routes** in curation-ui (or sibling). Empty
   pages for `/` (home stub), `/browser`, `/dataset/:id`.
   Get build + lint + deploy story working.
2. **Browser view** — Faithful port of the data flow: search
   box, results table, filter chips, paging. Visual design can
   be rough; functional parity is the goal.
3. **AnnotationSelector** — Heaviest. Allow yourself a couple of
   sessions on this one.
4. **DatasetPreview** — Popover behavior, not a full page.
5. **DownloadButton + ancillary components** — Cleanup.
6. **Polish pass** — Visual design refinement (with Paul's
   input), accessibility, perf.

Each stage should be in a working state when you hand off mid-stream.

## Open backend gaps

Full inventory filed 2026-05-19 in [`GEMMA_1X_PARITY_GAPS.md`](./GEMMA_1X_PARITY_GAPS.md).

Quick summary of backend-only items (no REST endpoint exists yet):
- `GET /rest/v2/summary` — per-taxon dataset/sample counts + weekly deltas (home page)
- `GET /rest/v2/datasets/{id}/sampleCorrelation` — N×N matrix for QC heatmap
- `GET /rest/v2/datasets/{id}/meanVariance` — mean/variance arrays for QC scatter
- `q=` free-text search on `GET /rest/v2/datasets` (needs search backend)
- `manufacturer` field on `ArrayDesignValueObject`
- `gene=` filter param on `GET /rest/v2/platforms/{id}/elements`
- `include=genes` opt-in on the elements bulk list

## Visual identity — explicit checkpoint before stage 6

Paul: "we'll come back to that" on visual design. Before you
finalize colors/typography/component density, **present 2–3
distinct visual directions** (mocked-up screens, not just
swatches) and let him pick. Until that decision: keep the visual
work loose and theme-tokenized so it can be re-skinned.

The lab has plot/figure style conventions documented in
`~/.claude/CLAUDE.md`'s "Figures, plots, data display" section —
read those for color and typography signals (Tailwind-style flat
modern minimal, Helvetica/Arial/DejaVu Sans, specific palette
tokens). They're for static figures, not UI, but they tell you
what the aesthetic neighborhood looks like.

## Coordination with the backend agent

- **Don't modify** `~/Dev/eclipseworkspace/Gemma/`,
  `~/Dev/gsec/`, or `~/Dev/eclipseworkspace/baseCode/`.
- If you need a backend change, file an "Open backend gap" above.
  Don't reach into those repos to fix it.
- The Gemma REST API surface is documented at
  `https://gemma.msl.ubc.ca/resources/restapidocs/` (live) and
  the OpenAPI spec is bundled in the Gemma repo under
  `gemma-rest/src/main/resources/restapidocs/`. The backend
  agent regenerates this on every build.
- Gemma's `RENOVATIONS.md` is the source of truth for what's
  changing on the backend. Skim it once for context but don't
  expect the schema to shift under you in a way that affects
  GemBrow's read-only API consumption.

## Status

- 2026-05-17 — handoff filed, port not yet started.
