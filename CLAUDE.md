# CLAUDE.md — gemma-ui (root)

Orientation for me — the GUI Claude working this repo. Two React/TS
apps live under [`apps/`](./apps/):

- [`apps/curation/`](./apps/curation/) — curator workflow.
  Per-app orientation: [`apps/curation/CLAUDE.md`](./apps/curation/CLAUDE.md).
  Pairs with [`gemma-curation-agents`](../gemma-curation-agents) (Python)
  where **my brother** (the agent-side Claude) handles backend work.
- [`apps/browser/`](./apps/browser/) — public browse/search (GemBrow
  React port). Per-app orientation:
  [`apps/browser/CLAUDE.md`](./apps/browser/CLAUDE.md). Talks to the
  Gemma REST API.

Always say "my brother" — never "sibling Claude", "the agents-side
Claude", or any third-person framing.

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
│  │  ├─ CLAUDE.md     # per-app orientation
│  │  └─ *_HANDOFF.md  # feature wire contracts
│  └─ browser/         # GemBrow React port — own package.json, vite, tsconfig
│     ├─ src/
│     ├─ CLAUDE.md
│     └─ REACT_PORT_HANDOFF.md
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
  canonical**. Don't edit the Python repo; file asks in handoff docs
  inside that repo (or in `~/Dev/gemma-curation-agents-eval/docs/`
  where my brother now primarily lives).
- **Browser app ↔ Gemma REST API** (Java, `~/Dev/eclipseworkspace/Gemma/`):
  hands-off on the Java repo; file API asks in
  `apps/browser/REACT_PORT_HANDOFF.md`.

## Memory

Session-persistent guidance lives in
`~/.claude/projects/-Users-pzoot-Dev-gemma-curation-ui/memory/`.
(The Claude memory path is keyed to the on-disk repo directory; it
keeps the `-gemma-curation-ui` suffix from the pre-rename era — the
rename only changes the GitHub repo identity, not the local checkout
path.) `MEMORY.md` is the index — auto-loaded each session.

## History

This repo was previously `gemma-curation-ui`. Renamed to `gemma-ui`
2026-05-17 when GemBrow merged in as `apps/browser/`. Pre-merge
curation history lives on `main`'s left parent; GemBrow's React-port
history rides along via `git subtree add` from `~/Dev/GemBrow`
`react-port` branch.
