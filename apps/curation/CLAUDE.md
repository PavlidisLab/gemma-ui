# CLAUDE.md — gemma-curation-ui (apps/curation)

Orientation for this app. Pairs with the Python agent + API repo at
`../gemma-curation-agents`, the agents-side service that handles
backend work.

## Stack

React + TypeScript + Vite + TanStack Query + Tailwind. Path alias
`@/` → `src/`.

**Checks, in the order they're cheapest to run:**

| What | Command |
|---|---|
| Types | `npx tsc -p tsconfig.app.json --noEmit` |
| Unit / render (vitest) | `npm run test` |
| Lint | `npm run lint` |
| E2E, mocked | `npm run e2e:critical` |
| E2E, needs a live backend | `npm run e2e:live` |

Typecheck must name `tsconfig.app.json` — the root `tsconfig.json`
has empty `files` and skips the app code, so running it directly
catches nothing.

Dev server:
`npm run dev` → `:5173`. Vite proxies `/rest`, `/propose`, `/audit`,
`/find-publication`, `/find-term` to the local_api curation server
(default `:8082`). Auth token `dev-token-123`. Override via
`apps/curation/.env` (`GEMMA_CURATION_URL`). Start the backend:

```sh
cd path/to/gemma-curation-agents && ./run_local.sh --port 8082
```

The local server is a full standalone curation backend that doesn't
talk to real Gemma — used for dev work AND for the portable
review-package workflow (`calibration_packages/`). Future **remote
mode** points this app at the real Gemma REST API instead.

## Cross-repo collaboration

- Wire shapes live in `../gemma-curation-agents` Pydantic models
  (`gemma_curation_agents/agents/audit/schemas.py`,
  `gemma_curation_agents/proposer_service.py`, etc.). The TS mirrors
  live in `src/api/*.ts` and lag — when shapes disagree, **the
  Python is canonical**. Regenerate the TS when the agents side lands
  a schema change.
- Don't edit the Python repo. Read it for context; file questions
  or new-field requests against that repo.
- Local-server data behaving oddly?
  `sqlite3 ../gemma-curation-agents/local_curation.sqlite` and
  inspect directly.

## Code conventions worth re-stating

- **Design-data panels read the draft, not the saved server design.**
  Use `useDesignDraft()` for any tab showing factors / FVs / samples
  / tags. Loading-guard order: check `loadError` first, then
  `isLoading || !draft` — never error on a transient null draft
  during a refetch.
- **Per-experiment durable flags scope by experiment id and clear on
  Reset.** Mirror `src/features/proposal/paperDismissal.ts`; clear
  from the Reset success handler.
- **Routes are hash-based.** `parseRoute` / `navigate` /
  `experimentRoute` in `src/routes.ts`. Tab switches inside the
  same experiment skip the dirty-draft confirmation.
- **Audit `target_id` slug rule mirrors
  `gemma-curation-agents/agents/audit/target_ids.py` exactly.**
  Divergence breaks the inline dot resolver silently. UI mirror
  lives at `src/features/audit/targetIds.ts`.

## Where things live

| Area | Path |
|---|---|
| Audit feature (sidebar, dots, inbox, detail page) | `src/features/audit/`, `src/api/audit*.ts`, `src/lib/scrollToAuditTarget.ts` |
| Samples table + popover | `src/features/samples/`, `src/lib/scrollToSample.ts` |
| Design editor | `src/features/design/` (mutations in `mutations.ts`, draft buffer in `DesignDraftContext.tsx`) |
| Overview / banner / publications | `src/features/overview/`, `src/features/experiment/` |
| Proposals (existing flow) | `src/features/proposal/`, `src/api/proposals.ts`, `src/api/proposeStream.ts` |
| Landing dashboard / inboxes | `src/features/landing/`, `src/features/inbox/` |
| Generic UI primitives | `src/components/ui/` |

## Big-picture context

The proposer + auditor cover a middle slice of the Gemma curation
pipeline (turning a raw imported experiment into a fully-annotated
one — design factors, ontology-grounded tags, sample assignments).
A later product area is **experiment workflow management** — driving
the rest of the pipeline (batch info, preprocessing, differential
expression, diagnostics, pre-public checklist, publish) from this UI.
