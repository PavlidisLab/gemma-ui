# Reset should drop proposals — agent-side ask

From the GUI session 2026-05-05.

## Symptom

After running reset (`useResetExperiment` → mock REST `import` with
`strip_curation: true`), the proposal sidebar still shows the
previously-accepted / -rejected proposals for that experiment. The
curator expects reset to land them on a clean curator-starting state,
including no proposal history visible.

## Root cause

`strip_curation` in
`gemma_curation_agents/mock_gemma_curation_api/import_from_gemma.py`
(around line 751) only clears factors + curator-attached tags. The
proposal table is untouched, so the UI faithfully renders proposals
that still exist server-side.

## Ask

Extend `strip_curation` to also delete every `CurationProposal` row
attached to the experiment. Rationale:

- Matches the docstring intent ("reproduce the day-to-day curator
  starting state") — a freshly-loaded experiment has no proposal
  history.
- The LLM disk cache (`cache_dir`, keyed by accession+model) lives
  outside the SQLite proposal store, so it survives this. Re-running
  `propose` after reset is still a cache hit; we don't pay LLM cost
  to test the loop.
- Audit findings already get re-evaluated against the new design;
  proposals should be retired the same way.

## UI-side follow-up (not blocking)

Once this lands, the UI's `useImportFromGemma` `onSuccess` should
also invalidate `["proposals"]` so the sidebar / cross-experiment
inbox repaint without the manual page reload Paul currently needs.
The current invalidations cover only `["datasets"]`,
`["design", id]`, and `["audit-events", id]`.

## Compatibility

Pure deletion within the existing `strip_curation` branch — no
schema or wire changes. UI built before this lands keeps working;
it just keeps showing stale proposals (today's behaviour) until
the curator reloads.
