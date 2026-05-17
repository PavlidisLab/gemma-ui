# gemma-ui

User-facing frontends for [Gemma](https://gemma.msl.ubc.ca). One repo,
two apps:

| App | Path | Purpose |
|---|---|---|
| **curation** | [`apps/curation/`](./apps/curation/) | Curator workflow — wires the curation write-API, integrates agent proposals + audit findings, drives the experiment-design / FV / tags / samples editing surface. |
| **browser** | [`apps/browser/`](./apps/browser/) | Public-facing browse / search frontend. React port of the long-standing Vue 2 GemBrow (history preserved via `git subtree`). |

Both apps share the same React 18 + TypeScript + Vite + TanStack Query
+ Tailwind stack. They are independent — each has its own
`package.json`, `vite.config.ts`, `tsconfig*.json`, `tailwind.config.js`.
npm workspaces installs deps once at the root.

## Setup

```sh
npm install            # installs deps for both apps via workspaces
npm run dev:curation   # http://localhost:5173 (curation UI)
npm run dev:browser    # GemBrow port (port set in apps/browser/vite.config.ts)
npm run typecheck      # both apps
```

## Per-app docs

- [`apps/curation/README.md`](./apps/curation/README.md) +
  [`apps/curation/CLAUDE.md`](./apps/curation/CLAUDE.md) — curation
  conventions, handoff docs, cross-repo wire shapes.
- [`apps/browser/README.md`](./apps/browser/README.md) +
  [`apps/browser/CLAUDE.md`](./apps/browser/CLAUDE.md) +
  [`apps/browser/REACT_PORT_HANDOFF.md`](./apps/browser/REACT_PORT_HANDOFF.md)
  — browser port plan, Vue→React migration status.

## Cross-repo wire

The curation app talks to the agent service in
[`gemma-curation-agents`](../gemma-curation-agents) (Python). Wire
shapes live in that repo's Pydantic models; the TS mirrors live in
[`apps/curation/src/api/*.ts`](./apps/curation/src/api/). When shapes
disagree, **the Python is canonical**.

The browser app talks to the Gemma REST API (Java backend at
`~/Dev/eclipseworkspace/Gemma/`).

## History

This repo was previously `gemma-curation-ui`; renamed 2026-05-17
when GemBrow merged in. The pre-merge curation history lives on
`main`'s left parent; GemBrow's React-port history rides along via
`git subtree add` from `~/Dev/GemBrow` `react-port` branch.
