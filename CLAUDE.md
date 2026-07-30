# CLAUDE.md — gemma-ui (root)

Orientation for this repo. Two React/TS apps live under
[`apps/`](./apps/):

- [`apps/curation/`](./apps/curation/) — curator workflow.
  Per-app orientation: [`apps/curation/CLAUDE.md`](./apps/curation/CLAUDE.md).
  Pairs with [`gemma-curation-agents`](https://github.com/PavlidisLab/gemma-curation-agents)
  (Python), the agents-side service that handles backend work.
- [`apps/browser/`](./apps/browser/) — public browse/search (GemBrow
  React port). Per-app orientation:
  [`apps/browser/CLAUDE.md`](./apps/browser/CLAUDE.md). Talks to the
  Gemma 2.0 REST API (older Gemma versions aren't compatible).

## Stack (both apps)

React 18, TypeScript 5.6, Vite 5, TanStack Query 5, TanStack Router 1,
Tailwind 3.4. Path alias `@/` → each app's own `src/`. Don't introduce
divergent versions between the two apps unless there's a real reason.

## Layout

```
gemma-ui/
├─ apps/
│  ├─ curation/        # curation workflow — own package.json, vite, tsconfig
│  │  ├─ src/
│  │  └─ CLAUDE.md     # per-app orientation
│  └─ browser/         # GemBrow React port — own package.json, vite, tsconfig
│     ├─ src/
│     └─ CLAUDE.md
├─ package.json        # npm workspaces; aggregates dev/build/typecheck
├─ README.md
└─ CLAUDE.md           # (this file) — orientation, two-app layout
```

## Common commands

Run from repo root:

```sh
npm install                # installs both apps' deps via workspaces
npm run dev:curation       # curation dev server (port 5173)
npm run dev:browser        # browser dev server
npm run typecheck          # both apps
npm run typecheck:curation # one app at a time
npm run build              # both apps
```

Or `cd apps/<app>` and run scripts there directly — each app's
scripts are unchanged from when it was a standalone repo.

## Don't make new UI components

**Default = reuse. Building a new component is the exception.**

Duplicate implementations of something that already exists
(TicketBadge vs. PriorityPill / TicketContextChip;
ThinExperimentScreener vs. PreboardingDetailPage) are a recurring
hazard. Drift across surfaces is the harm — the same visual idea,
two different palettes / behaviours / spacings, and curators stop
trusting the chrome.

Before authoring **any** new chip / pill / badge / picker / mask /
dialog / card / panel / banner / table-column variant:

1. **Grep the repo.** Search the literal name AND the visual idea
   — `chip`, `pill`, `badge`, `mask`, `picker`, `screener`, etc.
2. **Check shared first.** `packages/ui/` → `apps/<app>/src/components/ui/` →
   `apps/<app>/src/features/`. Component exists somewhere? Use it.
3. **If close-but-not-quite:** extend it (add a prop, a variant,
   a slot). Don't fork.
4. **If it's in the wrong app:** promote to `packages/ui/`.
5. **Only if nothing exists, even after extension:** write the new
   one. State the rationale first ("checked X, Y, Z and the shape
   doesn't fit because …") so it can be reviewed.

This rule overrides the urge to ship fast. Forking compounds drift;
shipping a wrong component is worse than shipping nothing while the
right one is found.

## Working inside a feature

Most session work happens inside `apps/curation/src/features/*` (or
`apps/browser/src/...` for browser features). Feature-internal work
moves cleanly across future restructurings; cross-app or
root-touching work needs more care.

When the user gives a path like `src/features/audit/Foo.tsx`, they
mean `apps/curation/src/features/audit/Foo.tsx` (the curation app)
unless they qualify it.

## Cross-repo wire

- **Curation app ↔ `gemma-curation-agents`** (Python): wire shapes
  live in that repo's Pydantic models; TS mirrors at
  `apps/curation/src/api/*.ts`. When shapes disagree, **Python is
  canonical**. Don't edit the Python repo; file asks against that
  repo.
- **Browser app ↔ Gemma 2.0 REST API** (Java): hands-off on the Java
  repo; file API asks against the Gemma backend.

## History

This repo was previously `gemma-curation-ui`. Renamed to `gemma-ui`
2026-05-17 when GemBrow merged in as `apps/browser/`. Pre-merge
curation history lives on `main`'s left parent; GemBrow's React-port
history rides along via `git subtree add`.
