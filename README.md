# gemma-curation-ui

Modernised curation interface for the [Gemma](https://gemma.msl.ubc.ca)
database. Replaces the legacy ExtJS / JSP curation pages with a React
+ TypeScript app that drives the curation REST API (mock in dev,
real Gemma later) and integrates agent-proposed designs / tags with a
structured curator-feedback loop.

## Stack

- **Vite + React 18 + TypeScript**
- **TanStack Query** — caches REST responses, manages loading/error
- **Tailwind CSS** — same utility classes as the original mockup
- **API types** — hand-written in `src/api/*.ts`; can regen from the
  live mock with `npm run gen-types` once shapes stabilise

## Running

```bash
# 1. Start the mock curation API (in the gemma-curation-agents repo)
cd ../gemma-curation-agents
./run_mock.sh                                 # preferred — handles keychain + GEMMA_RESOURCES_DIR

# 2. Start the UI
cd ../gemma-curation-ui
cp .env.example .env                          # one-time
npm install                                   # one-time
npm run dev                                   # → http://localhost:5173
```

The Vite dev server proxies `/rest/*` to the URL in
`GEMMA_CURATION_URL` (default `http://localhost:8080`). Bearer token
is read from `VITE_GEMMA_CURATION_API_KEY` at build time.

## What's in the editor

| Tab | What it does |
|---|---|
| **Design setup** | Editable factor table (name, category, description, type), per-factor FV cards with statement editing (subject / predicate / object), drag-drop sample reassignment, bulk-assign by characteristic, validator banner |
| **Sample details** | One row per biomaterial; characteristics, BioAssay names, factor-value assignments per factor, full-text filter |
| **Tags** | Experiment-level annotations (category + value pairs) with the same picker stack as Statements |
| **Diagnostics** | Pre-publish checklist (auto + manual items, persisted per-experiment, auto-cleared on design change), per-factor validator issues inline, per-factor coverage, characteristic distributions |
| **History** | Append-only commit log (timestamp, reviewer, shape deltas vs prior version) |
| **Quantitation types** | Placeholder — needs different read-only data |

The **CommitBar** at the bottom of the active tab summarises every
pending change (added / modified / deleted FVs, factor renames, new
tags, etc.) and is the single point of commit. Edits across tabs
share one draft buffer (`DesignDraftContext`), so switching from
Design to Tags mid-edit doesn't lose work.

The **Notes** drawer (toggled via the banner) is a per-experiment
scratchpad with its own save endpoint — not part of the design
commit flow.

## Pickers

- **CategoryPicker** — fixed-list typeahead over `/rest/v2/categories`
  (28 EFCs from `EFO.factor.categories.txt`). Used for Factor.category,
  Statement.category, Tag.category.
- **OntologyTermPicker** — debounced typeahead over
  `/rest/v2/annotations/search?query=…&category=…`. Each candidate
  shows green vs grey (ontology vs free text) and bold + count badge
  when previously used in Gemma. Used for Statement.subject,
  Statement.object, Tag.value.
- Mock loads ~660 ranked terms from
  `valueStringToOntologyTermMappings.txt`.

## Project layout

```
src/
  api/
    client.ts              # tiny fetch wrapper
    design.ts              # useDesign, useUpdateDesign
    proposals.ts           # useProposalsForExperiment, useReviewProposal
    categories.ts          # useCategories
    annotations.ts         # useAnnotationSearch
    notes.ts               # useNotes, useUpdateNotes
    history.ts             # useDesignHistory
  features/
    experiment/            # banner + tab bar + types
    design/
      DesignDraftContext.tsx  # shared draft buffer for all editing tabs
      DesignEditor.tsx
      FactorList.tsx
      FactorValueList.tsx
      FactorValueCard.tsx
      StatementEditor.tsx
      SampleAssignmentPreview.tsx   # drag-drop, filter, bulk-assign
      CategoryPicker.tsx
      OntologyTermPicker.tsx
      CommitBar.tsx
      ValidatorBanner.tsx
      diff.ts              # pure: saved vs draft → DesignDiff
      mutations.ts         # pure: Design → Design transformations
    samples/SampleDetailsPanel.tsx
    tags/TagsPanel.tsx
    diagnostics/DiagnosticsPanel.tsx
    history/HistoryPanel.tsx
    notes/NotesDrawer.tsx
    proposal/ProposalCard.tsx
  components/ui/            # Pill, Term, InlineText
  lib/cn.ts
  App.tsx                   # single-page shell, hard-coded to GSE277245
SCALE.md                    # what we'll do for 100s-of-samples experiments
```

## What's still TODO

1. **Routing** — TanStack Router; experiment-list landing →
   per-experiment detail, deep-linkable.
2. **Auth** — bearer token from a secure source rather than a build-
   time env var.
3. **Real Gemma integration** — at the moment the mock owns
   `/annotations/search` (with a usage_count synthesised from the
   value-mappings file). See `TODO-gemma-api.md` in the agents repo
   for the upstream gaps.
4. **Quantitation types tab** — needs a read-only data feed not yet
   plumbed.
5. **Ontology-resolver UI** — URI-level editing on terms (label is
   inline-editable, URI is auto-filled from the picker today;
   manual URI editing comes with a proper resolver UI).
6. **Multi-curator collaboration** — soft-locks, presence indicators.

## Multi-sample scaling

See `SCALE.md` for the current state and deferred items (multi-select
drag, virtualised Sample Details table when needed, etc.).

## License

Apache-2.0.
