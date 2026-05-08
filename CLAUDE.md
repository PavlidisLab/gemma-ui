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

**Continuous-factor proposer support** — see
[CONTINUOUS_FACTORS_HANDOFF.md](./CONTINUOUS_FACTORS_HANDOFF.md). UI
side landed 2026-05-05: `factor_type` / `numeric_value` on TS
mirrors, `applyProposalToDesign` threads them into the draft (was
hardcoding `"categorical"`), `ContinuousFactorView` prefers
`numeric_value` over parsing `free_text_label`, Decisions tab
renders `S5_continuous_populator` + `S8_dea_usability`, and the
"Not DEA-usable" warning chip rides the Triage strip. Backwards-
compatible — no matrix bump.

**Reset should drop proposals** — see
[RESET_DROP_PROPOSALS_HANDOFF.md](./RESET_DROP_PROPOSALS_HANDOFF.md).
Filed for my brother. `strip_curation` clears factors / curator tags
but leaves the `CurationProposal` rows attached, so the proposal
sidebar persists "accepted" history through reset. Once dropped
agent-side, UI follow-up: extend `useImportFromGemma` `onSuccess`
to invalidate `["proposals"]`.

**Proposal accept/reject should emit audit events** — see
[PROPOSAL_AUDIT_EVENT_HANDOFF.md](./PROPOSAL_AUDIT_EVENT_HANDOFF.md).
Filed for my brother. `apply_feedback` updates the proposal +
`feedback_log` but never calls `append_audit_event`, so the
History tab is empty after an accept/reject and the
`ProposalSummaryCard` "full details" link lands on a blank
History. Asks for `ProposalAccepted/Rejected/NeedsChangesEvent`
with `body_json = proposal.model_dump_json()`; UI follow-up
extends `EventTypeBadge` + `HistoryPanel` to render them.

**`strip_curation` should key on evidence code** — see
[STRIP_CURATION_BY_EVIDENCE_CODE_HANDOFF.md](./STRIP_CURATION_BY_EVIDENCE_CODE_HANDOFF.md).
Filed for my brother. `_is_curator_artifact` strips every
non-inferred tag, but Gemma reports both curator-asserted *and*
auto-attached experiment-level tags (`bulk RNA-seq`, taxon, etc.)
as `inferred=False`. The right discriminator is
`evidence_code == "IC"`. Until fixed, Reset wipes Gemma's auto
tags and breaks modality detection on the post-strip skeleton.

**Per-factor baseline relevance** — see
[BASELINE_RELEVANCE_HANDOFF.md](./BASELINE_RELEVANCE_HANDOFF.md).
Filed for my brother. UI's baseline-required logic is a static
category list (`NO_BASELINE_CATEGORIES`); a per-experiment refine
would have the proposer emit `baseline_relevance: "required" |
"not_applicable" | "uncertain"` per factor, keyed off
`S1_subset_verdict` axis + S6 baseline-picker outcome. UI follow-
up renders a *tiny flag* (not the loud banner) for the `uncertain`
case so curators notice without being yelled at. Default
`"required"` keeps backwards compat with older agents.

**Redo with notes** — see
[REDO_WITH_NOTES_HANDOFF.md](./REDO_WITH_NOTES_HANDOFF.md). Done both
sides as of 2026-05-06. Agent now reads `prior_feedback` and threads
it into the design-proposer prompt; UI sends it on the redo body.
Same session also rewired the redo POST from synchronous to
SSE-streaming (`proposeStream.start`) so the progress panel resets
and reflects the redo run instead of the original propose's
terminal events; and fixed `recentClosed` in `App.tsx` (was using
`Array.find` against an ASC list, surfacing the *oldest* non-pending
proposal).

**Audit dispositions feedback loop** — see
[AUDIT_DISPOSITIONS.md](./AUDIT_DISPOSITIONS.md). All 6 asks are
done on both sides (UI + agent) as of 2026-05-01. The dispositions
report at `scripts/eval_analysis/audit_dispositions.py` lights up
once curators start finalizing audits.

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

**Next product area:** experiment workflow management — see
[`WORKFLOW_MANAGEMENT.md`](./WORKFLOW_MANAGEMENT.md).

## Memory

Session-persistent guidance lives in
`~/.claude/projects/-Users-pzoot-Dev-gemma-curation-ui/memory/`.
`MEMORY.md` is the index — auto-loaded into every session. Update
there for anything that should follow me across sessions; this file
is for repo-shape orientation a fresh session needs in front of
itself.
