# Redo with notes — agent-side now actually reads the notes

Handoff from the agents-repo session 2026-05-05. Companion fix to the
GSE200314 investigation: the curator's "look at the sample names"
note in `redoWithNotes` was being logged but never reaching the
prompt. That ended now.

## What changed agent-side

`POST /propose/{accession}/stream` and `POST /propose/{accession}`
both accept a new `prior_feedback: string | null` field on the
request body. When set, the design-proposer prompt grows a
`## Curator feedback from previous attempt` block near the top —
ahead of S3's candidate-factors hint — so the curator's specific
override colours how the model reads the rest of the prompt. The
prompt instructs the model to treat the feedback as a strong,
specific override of its default behaviour.

Plumbed through:

- `proposer_service.ProposeRequest.prior_feedback` (the request body field).
- `_run_pipeline(...)` → `cp_pipeline.propose_curation(prior_feedback=...)`.
- `propose_design(..., prior_feedback=...)` → `_skeleton_to_input(prior_feedback=...)`.
- The `## Curator feedback` block lands in the user message before
  the candidate-factors block; the system prompt is unchanged.

Backwards compatible: missing field → behaviour identical to before.

## UI-side change to make this work

`ProposalCardV2.tsx` `redoWithNotes()` needs one extra field on the
`proposeStream.start` body:

```ts
proposeStream.start(String(proposal.experiment_id), {
  fresh_skeleton: true,
  refresh_cache: true,
  tier: retryTier,
  prior_feedback: feedback,   // ← add this
});
```

The toast message can drop the parenthetical caveat
(`(Notes don't yet shape the new prompt — coming when /retry lands.)`)
once the field is wired. Suggested replacement:

```ts
toast.show(
  feedback.trim()
    ? `Redo started${tierBlurb}. Notes wired into the new run; fresh cache.`
    : `Redo started${tierBlurb}. The new run uses a fresh cache.`,
  "info",
  6000,
);
```

The PATCH that logs `reviewer_notes` for prompt-tuning analytics
stays as-is — that's the persistent record. `prior_feedback` is the
prompt-shaping field.

## Companion fix in the same session: sample-assigner sees titles

The LLM sample-assigner's input was previously starved on
GSE200314-shape experiments (FV signal in sample TITLES, not
characteristics). Fixed agent-side: `_biomaterials_block` now
includes `BioMaterial.name`, `geo_fields.source_name`, and
`geo_fields.title` alongside characteristics. The system prompt
clarifies that `short_name` is just the GSM accession — the FV
signal lives in the descriptive fields. No UI change needed for
this one; it's pure agent-side input plumbing.

## Verification path on the next continuous-or-titled experiment

1. Curator clicks "redo with notes" with `feedback = "look at sample
   names — phenotype factor exists"` on GSE200314 with the strong
   tier.
2. Agent re-fetches a fresh skeleton, S3 still finds phenotype as a
   varying candidate, design proposer sees the curator note, sample
   assigner sees `name="Mouse_Diurnal_Liver_rep3"` for each BM.
3. Result: phenotype factor proposed AND samples assigned cleanly,
   not auto-unchecked as zero-coverage.

Failure mode to watch for: if the proposer still recommend_skips
after seeing the note, that's a prompt issue (the design_proposer
system prompt's skip rules out-rule the curator note's strength).
Worth raising the feedback block's priority in the prompt above the
skip rules if it shows up.

## Cross-repo compatibility

- Agent change is additive on the request body — UIs without the
  field still work, just don't get the benefit.
- No `MIN_UI_VERSION` bump required.
- Recommended UI version: pair with the change above so curators
  actually see the note take effect.

## UI implementation status (2026-05-06)

Wired in the same session as the redo-flow rewire to streaming. All
three asks from §"UI-side change to make this work" landed:

- **`TriggerProposalBody.prior_feedback`** — added to the TS mirror
  in `src/api/proposals.ts` with the recommended doc string.
- **`redoWithNotes`** body — now sends
  `prior_feedback: trimmedFeedback || null`. Empty notes serialise
  as `null` so the agent doesn't get an empty feedback block (avoids
  cluttering the prompt when the curator clicks redo without typing
  anything).
- **Toast copy** — dropped the "Notes don't yet shape the new prompt
  — coming when /retry lands" parenthetical. New copy when notes are
  present: "Notes wired into the new run; fresh cache."
- **Modal copy** — the "the new run uses a fresh cache but doesn't
  yet read these notes" warning replaced with "Your notes are
  threaded into the design-proposer prompt as a curator-feedback
  block, and also logged on the retired proposal for prompt-tuning."
  The empty-notes warning kept (still useful — without notes the
  agent has no extra signal) but rephrased so it doesn't claim the
  endpoint is missing.

Companion changes the same session — see this doc's twin in spirit,
plus the broader rewire described below — were:

1. Switching `redoWithNotes` from synchronous `POST /propose/{id}`
   to `proposeStream.start(...)` (`POST /propose/{id}/stream`) so
   the curator sees live progress instead of the previous run's
   stale terminal events on the panel. This was the actual root
   cause of "redo looks like a cache hit" — the panel never reset
   on the synchronous path.
2. Fixing `recentClosed` in `App.tsx` — the sidebar's
   most-recent-non-pending lookup was walking ASC results with
   `Array.find`, which surfaces the *oldest* rejected proposal once
   a curator has rejected more than one. Switched to an end-to-start
   walk; comment corrected to match what `storage.list_for_experiment`
   actually does.

Verified `npx tsc --noEmit` clean and 65/65 vitest tests pass.

## Companion fix follow-up — sample-assigner sees titles

The `_biomaterials_block` enrichment is pure agent-side; UI doesn't
need to do anything for the GSE200314-shape titles fix. Just noting
it landed agent-side so future investigators don't go looking for a
UI counterpart.
