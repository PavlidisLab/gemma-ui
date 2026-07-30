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

## Is this useful to you?

Both apps are tightly coupled to [Gemma](https://gemma.msl.ubc.ca)'s
specific REST API, data model, and curation workflow — they are not
a general-purpose dataset browser or annotation tool. Realistically
there's little reason to run this code unless you operate (or plan
to operate) your own private instance of Gemma **2.0** and want a
frontend for it — the REST API these apps speak is Gemma 2.0's;
older Gemma versions won't work. If that's you: the **browser** app
is the more self-contained starting point (it only needs a running
Gemma 2.0 REST API); the
**curation** app additionally needs the
[`gemma-curation-agents`](https://github.com/PavlidisLab/gemma-curation-agents)
backend service for the agent-assisted curation workflow. This code is shared as-is,
in case it's useful as a reference or a starting point — it isn't
packaged as a turnkey product for other Gemma-like datasets.

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
  conventions and cross-repo wire shapes.
- [`apps/browser/README.md`](./apps/browser/README.md) +
  [`apps/browser/CLAUDE.md`](./apps/browser/CLAUDE.md) — browser app
  orientation, Vue→React migration status.

## Cross-repo wire

The curation app talks to the agent service in
[`gemma-curation-agents`](../gemma-curation-agents) (Python). Wire
shapes live in that repo's Pydantic models; the TS mirrors live in
[`apps/curation/src/api/*.ts`](./apps/curation/src/api/). When shapes
disagree, **the Python is canonical**.

The browser app talks to the Gemma 2.0 REST API (Java backend).

## History

This repo was previously `gemma-curation-ui`; renamed 2026-05-17
when GemBrow merged in. The pre-merge curation history lives on
`main`'s left parent; GemBrow's React-port history rides along via
`git subtree add` from the GemBrow `react-port` branch.
