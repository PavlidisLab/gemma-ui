# gemma-curation-ui

Modernised curation interface for the [Gemma](https://gemma.msl.ubc.ca)
database. Replaces the legacy ExtJS / JSP curation pages with a React
+ TypeScript app that drives the curation REST API (local standalone
server in dev + for portable review packages; a remote mode against
real Gemma is planned) and integrates agent-proposed designs / tags
/ audits with a structured curator-feedback loop.

## Stack

- **Vite + React 18 + TypeScript**
- **TanStack Query** — caches REST responses, manages loading/error
- **Tailwind CSS** — same utility classes as the original mockup
- **API types** — hand-written in `src/api/*.ts`; shapes mirror the
  Pydantic models in
  [`gemma-curation-agents`](https://github.com/PavlidisLab/gemma-curation-agents)
  (the agent + local + remote REST repo). When the agent side ships a
  schema change, the doc updates first and the TS catches up.

## Running

```bash
# 1. Start the local curation server (in the gemma-curation-agents repo)
cd ../gemma-curation-agents
./run_local.sh --port 8082                    # handles keychain + GEMMA_RESOURCES_DIR

# 2. Start the UI
cd ../gemma-ui/apps/curation
cp .env.example .env                          # one-time
npm install                                   # one-time
npm run dev                                   # → http://localhost:5173
```

The Vite dev server proxies `/rest/*`, `/propose/*`, `/audit/*`,
`/find-publication`, and `/find-term` to the URL in
`GEMMA_CURATION_URL` (default `http://localhost:8082`). Auth is the
session bearer token issued by `useLogin` (dev token
`dev-token-123` against the local server).

🛑 **Whatever Gemma you point at, give the agent an account on it.**
Draft saves and curation locks go through the agent, which authenticates
to Gemma with `GEMMA_USERNAME` / `GEMMA_PASSWORD`. Those default to
`groupadmin`, which exists only in the local-mode Gemma. Aim at a real
Gemma without changing them and every draft save comes back
`save failed: 401` — which reads like your own session expiring, but
is the agent's credentials, not yours. Setup and the keychain entries:
[`docker/local-mode/README.md`](../../docker/local-mode/README.md).

## Landing dashboard

The landing page (`#/`) is the curator's experiments list, surfaced
as a unified dashboard:

- **Status pills** filter by curation flag (troubled, needs
  attention, has notes, has pending proposals, **audit issues** —
  unactioned blocker / major findings).
- **Status sort** weights audit blockers above troubled and audit
  major above pending proposals so the most actionable experiments
  surface first.
- **Audit chip** per row reflects the most recent audit (verdict
  pill or unactioned-finding count) and deep-links to the audit's
  detail view.
- **Import typeahead** at the top calls real Gemma via gemmapy to
  pull a fresh experiment into the mock; the same flow powers
  "Reset experiment" (re-import with curation stripped).

A **Proposals inbox** (`#/inbox`) and an **Audits inbox**
(`#/audits`) sit alongside for cross-experiment triage.

## What's in the per-experiment editor

| Tab | What it does |
|---|---|
| **Overview** | Identity / cohort summary, publications (auto-link via PubMed lookup), batch-confound + nuisance-factor diagnostics, experiment tags (formerly the Tags tab — folded in 2026-04-30) |
| **Design setup** | Editable factor table (name, category, description, type) with **per-factor and per-FV atomic revert**, FV cards with statement editing (subject / predicate / object), drag-drop sample reassignment, bulk-assign by characteristic, validator banner |
| **Sample details** | Internally-scrollable table with sticky column headers, per-row metadata popover, drag-resizable columns, factor columns first (block / batch nuisance factors at the right end, stone-tinted), full-text row search across every BM field even when the column is hidden |
| **Diagnostics** | Pre-publish checklist (auto + manual items, persisted per-experiment, auto-cleared on design change), per-factor validator issues inline, per-factor coverage incl. continuous factors, characteristic distributions |
| **History** | Append-only commit log (timestamp, reviewer, shape deltas vs prior version) |
| **Quantitation types** | Read-only listing of QT flags imported from Gemma |

The **CommitBar** at the bottom of the active tab summarises every
pending change (added / modified / deleted FVs, factor renames, new
tags, etc.) and is the single point of commit. Edits across tabs
share one draft buffer (`DesignDraftContext`), so switching from
Design to Samples mid-edit doesn't lose work. Per-element revert
links sit beside the change badges so curators don't need to nuke
the whole draft to undo a single bad edit.

The **Notes** drawer (toggled via the banner) is a per-experiment
scratchpad with its own save endpoint — not part of the design
commit flow.

## Audit feature

The **audit-existing-curation** feature is a joint build with the
agent side (`gemma-curation-agents`), which owns the wire contract
for audit findings and the disposition feedback loop.

Three integration surfaces in the UI:

- **A. Inline severity dots** on factor cards, FV cards, tag chips,
  and sample rows. Click → flips the per-experiment sidebar to the
  Audit view and scrolls the matching finding card into focus.
- **B. Per-experiment audit sidebar** with a `Proposals | Audit`
  toggle in the existing sidebar slot. Each finding card has:
  - **Apply & focus →** / **Focus →** primary action — runs a
    structured fix when there is one (none in Phase 1; registry is
    ready), then navigates to the affected element across tabs and
    ring-flashes it.
  - **Accept** / **✓ accepted (parked)** / **Mark resolved →** /
    **✓✓ resolved** — two-step accept (curator agrees vs curator
    agreed and acted).
  - **Dismiss…** opens a chip-picker dialog with the structured
    `dismiss_reason` enum.
  - **Close audit** / **Reopen** lifecycle on the sidebar header,
    with read-only treatment of finalized audits and 409 handling
    on stray PATCHes.
- **C. Cross-experiment surfaces** — `#/audits` (inbox with
  verdict-filter tabs) and `#/audits/{audit_id}` (single-audit
  detail). The detail page still uses the older
  `AuditReportView`; the new Apply & Focus flow there is a known
  follow-up.

The **trigger dialog** lets curators pick scope (factors / FVs /
tags / assignments) and tier (fast / standard / strong) before
running an audit. Streaming progress reuses the existing
`ProposeProgressPanel` event taxonomy.

## Pickers

- **CategoryPicker** — fixed-list typeahead over `/rest/v2/annotations/categories`
  (28 EFCs from `EFO.factor.categories.txt`). Used for Factor.category,
  Statement.category, Tag.category.
- **OntologyTermPicker** — debounced typeahead over
  `/rest/v2/annotations/search?query=…&category=…`. Each candidate
  shows green vs grey (ontology vs free text) and bold + count badge
  when previously used in Gemma. Used for Statement.subject,
  Statement.object, Tag.value.
- The local server loads ~660 ranked terms from
  `valueStringToOntologyTermMappings.txt` on first start.

## Project layout

```
src/
  api/
    client.ts              # fetch wrapper + bearer-token + ApiError
    session.ts             # useMe, useLogin, useLogout
    design.ts              # useDesign, useUpdateDesign
    datasets.ts            # useDatasets (landing), useImportFromGemma, ...
    proposals.ts           # useProposalsForExperiment, useReviewProposal
    proposeStream.ts       # SSE client for /propose/{id}/stream
    audits.ts              # useAuditsForExperiment, usePatchDisposition,
                           # useFinalizeAudit, useReopenAudit, ...
    auditStream.ts         # SSE client for /audit/{id}/stream
    auditTypes.ts          # AuditFinding, AuditReport, dispositions, ...
    categories.ts          # useCategories
    annotations.ts         # useAnnotationSearch
    notes.ts               # useNotes, useUpdateNotes
    history.ts             # useDesignHistory
    curation.ts            # curation_note + flags
  features/
    landing/               # ExperimentList (dashboard), ImportPrompt
    inbox/                 # ProposalsInbox, AuditsInbox
    experiment/            # banner + tab bar + types
    design/
      DesignDraftContext.tsx
      DesignEditor.tsx
      FactorList.tsx
      FactorValueList.tsx
      FactorValueCard.tsx
      StatementEditor.tsx
      SampleAssignmentPreview.tsx
      CategoryPicker.tsx
      OntologyTermPicker.tsx
      CommitBar.tsx
      ValidatorBanner.tsx
      diff.ts              # pure: saved vs draft → DesignDiff
      mutations.ts         # pure: Design → Design (incl. revertFactor[Value])
    samples/
      SampleDetailsPanel.tsx
      BiomaterialMetaPopover.tsx
    overview/OverviewPanel.tsx     # publications, tags, batch-confound
    diagnostics/
      DiagnosticsPanel.tsx
      PrePublishChecklist.tsx
    history/HistoryPanel.tsx
    notes/NotesDrawer.tsx
    proposal/
      ProposalCardV2.tsx
      ProposeProgressPanel.tsx
      ProposalReviewContext.tsx
    audit/
      AuditContext.tsx              # report + dispositions + lifecycle
      AuditSidebarPanel.tsx         # surface B
      AuditDot.tsx                  # surface A
      AuditReportView.tsx           # surface C body
      AuditDetailPage.tsx           # surface C page
      AuditsInbox.tsx               # under features/inbox/
      AuditTriggerDialog.tsx
      DismissDialog.tsx             # dismiss-reason chip picker
      applyHandlers.ts              # Apply & focus registry
      firstSeen.ts                  # client-side "seen since" tracking
      targetIds.ts                  # mirrors agent-side target_ids.py
  components/ui/            # Pill, Term, InlineText, HelpPopup, ...
  lib/
    cn.ts
    useStickyState.ts       # sticky view preferences
    useEscape.ts
    scrollToSample.ts       # cross-tab "scroll to BM in samples"
    scrollToAuditTarget.ts  # cross-tab "focus audit target"
    gemmaUrls.ts
  routes.ts                 # hash router (parseRoute / navigate)
  App.tsx                   # shell + cross-tab listeners
CLAUDE.md                   # meta orientation for this app
```

## What's still TODO

1. **Real Gemma integration** — at the moment the local server owns
   `/annotations/search` itself (with a usage_count synthesised from
   a value-mappings file); a genuine remote-mode integration against
   real Gemma is still ahead.
2. **AuditDetailPage Apply & Focus** — the cross-experiment audit
   page doesn't yet wire the Apply & Focus flow; it needs cross-tab
   navigation from outside an experiment Shell.
3. **Mutating apply handlers** — Phase 1 audit is focus-only; per-
   issue handlers (`missing_factor` lifts from `comparison_proposal`,
   `missing_fv` adds, etc.) drop into
   `src/features/audit/applyHandlers.ts` once the structured-fix
   schema lands on the agent side.
4. **Ontology-resolver UI** — URI-level editing on terms (label is
   inline-editable, URI is auto-filled from the picker today;
   manual URI editing comes with a proper resolver UI).
5. **Multi-curator collaboration** — soft-locks, presence indicators.

## Compatibility with the agent service

This UI talks to the [`gemma-curation-agents`](https://github.com/PavlidisLab/gemma-curation-agents)
service over HTTP / SSE. The two are independent processes — no
build-time dependency — but the wire contract (REST shapes, SSE
event taxonomy, dispositions schema) couples them, so mismatched
versions of the two repos can drift out of sync silently. Keep them
updated together.

## License

Apache-2.0.
