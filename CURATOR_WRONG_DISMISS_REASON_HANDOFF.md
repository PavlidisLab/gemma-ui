# DismissReason: add `curator_wrong`

Filed 2026-05-08 from the GUI session.

## Symptom

On a `calibration_gold_only_miss` finding, the rationale (now
question-form) reads "Did the agent miss X?" If the curator
clicks Disagree…, the existing dismiss-reason picker has:

- `auditor_wrong` — "finding is incorrect / hallucinated"
- `redundant`
- `out_of_scope`
- `accepted_elsewhere`
- `wont_fix`
- `other`

None of those capture the actual case: **the agent was right
not to propose X; the existing curation has it but shouldn't**
(curator over-tagged at curation time).

`auditor_wrong` is the wrong fit semantically — it implies the
audit pipeline's framing was incorrect, not that the gold-side
curation has an extraneous tag. Forcing curators into
`auditor_wrong` for over-tagging cases pollutes the
prompt-quality eval signal: those dismissals look like the agent
hallucinated when actually the agent was correct and the gold
should change.

Symmetric case lives on `calibration_match` findings — when the
curator confirms-or-flags a same-tag concept and *both* the agent
and the gold have something that shouldn't be there.

## Ask

Add `curator_wrong` to the `DismissReason` enum (Pydantic
`Literal[...]`):

```python
DismissReason = Literal[
    "auditor_wrong",
    "curator_wrong",      # NEW
    "redundant",
    "out_of_scope",
    "accepted_elsewhere",
    "wont_fix",
    "other",
]
```

UI side has already:

- Added `"curator_wrong"` to the TS mirror in `src/api/auditTypes.ts`.
- Rendered the chip in `DismissDialog.tsx` next to `auditor wrong`
  with help copy "finding is right; existing curation is wrong
  (over-tagged / shouldn't be there)".

Until the agent-side enum lands, a curator who picks the new
chip will get a 422 from the server's PATCH validator — they can
fall back to `other` with a free-text note. Brother's commit
unblocks the chip.

## Eval-side note

`curator_wrong` is the dismiss-reason that says "agent was right;
gold is wrong on this concept" — the *positive* signal for the
agent prompts. Worth weighting differently from
`auditor_wrong` in the dispositions report: `auditor_wrong`
counts against the auditor's prompts, `curator_wrong` counts
against the gold curation (and is, indirectly, a quality signal
for the proposer).

## Cross-repo compatibility

Pure additive on the enum. Older UIs ignore the new value
(they don't know to render it). Newer UIs paired with the new
agent get the full chip set. Older agents 422 on the new value;
curators can pick `other` until the agent-side enum lands.
