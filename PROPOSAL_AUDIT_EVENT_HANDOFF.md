# Proposal accept/reject should emit audit events — agent-side ask

Filed from the GUI session 2026-05-06.

## Symptom

Curator accepts an agent proposal. The slim `ProposalSummaryCard`
shows the green ACCEPTED pill with a "full details ↗" link that
navigates to the experiment's History tab. **History is empty.** No
event for the curator's accept; no surface anywhere that shows what
was actually in the proposal they accepted.

If they go on to Commit the design after accepting, an
`ExperimentalDesignUpdatedEvent` lands in History — but that's the
*design as a whole*, not "the agent submitted X and the curator
accepted it." The proposal-as-a-thing is invisible to the audit
trail.

## Root cause

`mock_gemma_curation_api/storage.py` `Proposals.apply_feedback`
(line 563) updates the `proposals` row + appends to `feedback_log`,
but never calls `append_audit_event`. The History tab reads
`audit_events`, so it has nothing to render.

`feedback_log` has the curator's feedback JSON; `proposals.
current_json` has the agent's submission. The data is there — it
just doesn't reach the audit trail.

## Ask

Emit one audit event per terminal `apply_feedback` call:

| `feedback.status` | `event_type`                      |
|---|---|
| `accepted`        | `ProposalAcceptedEvent`           |
| `rejected`        | `ProposalRejectedEvent`           |
| `needs_changes`   | `ProposalNeedsChangesEvent`       |

Suggested column shape (matches the existing
`audit_events` schema):

```text
experiment_id : proposal.experiment_id
date          : feedback.reviewed_at (ISO)
performer     : feedback.reviewer
action        : "U"   (mirrors ExperimentalDesignUpdatedEvent's
                      conventions; the event_type discriminates)
event_type    : one of the three above
note          : one-line summary —
                "Proposal accepted: 2 factors, 3 tags
                 from gemma-curation-agents (claude-haiku)"
detail        : reviewer_notes verbatim (curator's own
                free-text rationale, when present)
body_json     : proposal.model_dump_json()  (the agent's
                full submission AT THE TIME OF REVIEW —
                NOT post-edits, so the trail records what
                the curator actually decided on)
```

Edge cases:

- The curator's `feedback.edits` (per-row exclusions / FV label
  edits) is meaningful provenance too. Two options:
  1. Stuff it under a top-level key in `body_json`
     (`{"proposal": ..., "curator_edits": ...}`) — the History tab
     can render a diff strip if both are present. Cleaner.
  2. Leave it on `feedback_log` and let the History tab cross-
     reference by `proposal_id`. Simpler agent-side, more work
     UI-side.
  Either's fine — pick whatever reads better; option 1 keeps the
  audit row self-contained.
- Status transitions back to `pending` (none today) — skip.
- Bulk accept-and-commit flows should still emit one proposal
  event + one design-updated event, in that order.

## UI follow-up (this repo)

Once the event lands:

- Extend `EventTypeBadge` in
  `src/features/history/HistoryPanel.tsx` with the three new
  types — green/slate/amber pills mirroring the proposal-status
  vocabulary.
- Render the body: factor + FV count strip, tags strip, the
  agent's `submitted_by` + model, an evidence-quote teaser,
  and the curator's `reviewer_notes` if present. Optional
  expander for the full subtask-decisions list (cheap reuse
  of `humanizeDecision` from `ProposalCardV2`).
- Wire `ProposalSummaryCard`'s "full details ↗" to deep-link
  the History tab AND auto-expand the matching event row
  (the proposal_id is on the source card; match against
  `body_json.proposal_id`).

## Compatibility

Pure additive: new event_types in an existing column. UIs that
don't recognise them today will already render via the catch-all
fallback (the EventTypeBadge default branch shows the raw
event_type string). No `MIN_UI_VERSION` bump required; pair this
with the matching UI release for the full curated experience.

## Why this matters beyond the immediate symptom

- **Audit completeness.** Production Gemma's audit trail is
  supposed to be the source of truth for "who decided what about
  this experiment." Proposal acceptance is the agent → human
  decision boundary; eliding it from the trail breaks that
  contract.
- **Eval inputs.** Curator review patterns (accept rate, time-
  to-decision, common rejection rationales) are what drive
  prompt-tuning and the tier-default decisions. Today they're
  derivable from `feedback_log` only — pulling them from the
  audit trail makes the eval pipeline simpler and matches what
  production Gemma will eventually expose.
- **Reset semantics.** Once the reset-drops-proposals ask lands
  (`RESET_DROP_PROPOSALS_HANDOFF.md`), the proposals themselves
  vanish on reset. Without an audit trail copy, the history of
  "agent proposed X, curator accepted X" is lost. The audit
  event is the durable record.
