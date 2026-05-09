# CLAUDE.md — gemma-curation-ui

Orientation for me — the GUI Claude working this repo. Pairs with the
Python agent + API repo at `../gemma-curation-agents`, where **my
brother** (the agent-side Claude) handles backend work. Always say
"my brother" — never "sibling Claude", "the agents-side Claude", or
any third-person framing. (Slip-rule + reasoning live as a top-line
feedback memory; this line is the abbreviated reminder.)

## Stack

React + TypeScript + Vite + TanStack Query + Tailwind. Path alias
`@/` → `src/`. No formal test suite — `npx tsc --noEmit` for
correctness and the browser for everything else. Dev server:
`npm run dev` → `:5173`. Vite proxies `/rest`, `/propose`, `/audit`,
`/find-publication`, `/find-term` to the mock agent service on
`:8080` (started from the agent repo via `./run_mock.sh`; auth token
`dev-token-123`).

## Cross-repo collaboration

- Wire shapes live in `../gemma-curation-agents` Pydantic models
  (`gemma_curation_agents/agents/audit/schemas.py`,
  `gemma_curation_agents/proposer_service.py`, etc.). My TS mirrors
  live in `src/api/*.ts` and lag — when shapes disagree, **the
  Python is canonical**. Regenerate the TS when my brother lands a
  schema change.
- Don't edit the Python repo. Read it for context; file questions
  or new-field requests as comments in the relevant handoff doc and
  my brother picks them up next session.
- Mock data behaving oddly?
  `sqlite3 ../gemma-curation-agents/mock_curation.sqlite` and
  inspect directly.
- **Compatibility matrix** (which UI version pairs with which agent
  version) lives in [`CROSS_REPO_COMPAT.md`](./CROSS_REPO_COMPAT.md).
  Update it when shipping a release; same row goes on the agent side.

## Doc layout

- `*_FEATURE.md` — one per cross-cutting feature
  (`AUDIT_FEATURE.md`); lives at repo root; updated in the same
  commit as the code that satisfies it. Source of truth for the
  cross-repo wire contract for that feature.
- Narrower sub-handoffs use the same suffix style
  (`AUDIT_DISPOSITIONS.md`) — usually a child of a `*_FEATURE.md`.
- `WORKFLOW_MANAGEMENT.md` — product brief for the workflow management
  system (curation funnel, group types, two-world model).
- `WORKFLOW_MANAGEMENT_HANDOFF.md` — wire contract for that feature:
  Candidate entity, Group entity, pipeline status shape, API endpoints.
- `PROGRESS_SSE.md` — long-running protocol doc for the SSE stream
  taxonomy.
- `SCALE.md` — performance / scale notes.
- This file (`CLAUDE.md`) — meta orientation. Keep it short; link
  to handoff docs rather than inlining.

## Code conventions worth re-stating

(See `~/.claude/projects/-Users-pzoot-Dev-gemma-curation-ui/memory/`
for the full list — the rules below repeat here because forgetting
them costs time.)

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

The proposer + auditor cover steps 2–4 of the 14-step Gemma curation pipeline.
The next major product area is **experiment workflow management** — driving the
full pipeline (steps 5–14: batch info, preprocessing, DEA, diagnostics,
pre-public checklist, publish) from the new UI. See
[`WORKFLOW_MANAGEMENT.md`](./WORKFLOW_MANAGEMENT.md) for the full brief:
what the old ExtJS dataset manager does, what's wrong with it, and what we
want to build.

## Current open handoff

No active cross-repo handoffs. Recently-closed work (UI + agent
both shipped) covered: audit dispositions feedback loop,
continuous-factor proposer support, redo-with-notes (agent reads
`prior_feedback`; UI redo POST on SSE), reset drops proposals,
proposal accept/reject emits audit events, `strip_curation` keys
on evidence code, per-factor `baseline_relevance` hint with
soft-flag UI rendering, and structured proposer-suggestion on
audit findings (`proposer_term` / `proposer_defense` /
`supporting_evidence[]` rendering as green Term + defense
paragraph + per-source blockquotes).

**Still deferred:**
- `AuditDetailPage` / `AuditReportView` cross-experiment refactor
  (close/reopen affordances, dismiss chips, Mark resolved). Deferred
  because Apply & Focus needs design-context unavailable outside the
  Shell. In-experiment sidebar is the high-traffic path; this can
  wait for Phase 1 mutating handlers or curator feedback.
- Real mutating handlers in `src/features/audit/applyHandlers.ts`.
  Waiting on the structured-fix schema from my brother
  (`AuditFinding.suggested_fix` becoming a typed action). When it
  lands, drop per-issue-code handlers into `resolveApplyAction()`;
  `applied_fix` wires up automatically.
- Prominent "no within-level replication" warning chip + audit-
  pathway scan for replication-rule violations on already-curated
  experiments (continuous-factor open questions, agents-side ask).
- `body_json` (or at least `proposal_id`) on the `auditEvents` GET
  response so `ProposalSummaryCard` "full details ↗" can deep-link
  to the matching event row in History (today the link lands the
  curator on the History tab and the event is at-or-near the top
  of the list, but no auto-expand / scroll-to). Small agent-side
  add when the audit-event API surface gets its next pass.

**Next product area:** experiment workflow management — see
[`WORKFLOW_MANAGEMENT.md`](./WORKFLOW_MANAGEMENT.md).

## Memory

Session-persistent guidance lives in
`~/.claude/projects/-Users-pzoot-Dev-gemma-curation-ui/memory/`.
`MEMORY.md` is the index — auto-loaded into every session. Update
there for anything that should follow me across sessions; this file
is for repo-shape orientation a fresh session needs in front of
itself.
