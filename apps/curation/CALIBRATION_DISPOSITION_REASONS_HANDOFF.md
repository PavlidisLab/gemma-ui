# Calibration-specific disposition reasons

**Status:** Open ask, agents-side. Filed 2026-05-13 by Paul (UI).
**Sibling docs:** [`AUDIT_DISPOSITION_REASONS_HANDOFF.md`](./AUDIT_DISPOSITION_REASONS_HANDOFF.md) ·
[`FACTOR_CALIBRATION_FINDINGS_HANDOFF.md`](./FACTOR_CALIBRATION_FINDINGS_HANDOFF.md)

## Why

Calibration findings (`calibration_match`, `calibration_agent_extra`,
`calibration_gold_only_miss`, and the new factor-side variants)
ship with calibration-specific dismiss/accept chip sets because the
canonical `DismissReason` / `AcceptReason` enums don't cover the
verdicts curators most often want to lodge against an agent–gold
comparison.

UI v0.6.0 introduced those chips with calibration-specific keys
(`missed_evidence`, `no_evidence`, `gold_was_wrong`, `borderline`)
intending them to PATCH straight through as
`dismiss_reason` / `accept_reason`. The agent-side enums are closed
(`Literal[...]` in `gemma_curation_agents/agents/audit/schemas.py`),
so the validator rejects the PATCH with a 422 and the curator
sees a red error box. Repro on GSE105453: select "Disagree…" on
the calibration_gold_only_miss for `intermediate hypothalamic
region`, pick **Missed evidence** chip, confirm → red box.

UI v0.6.4 ships a client-side workaround: map calibration keys to
canonical enum values before PATCH, prefix the specific key into
`notes` as `[<key>] ...` so the analytic signal isn't lost. That
removes the error but folds three distinct signals into
`weak_evidence` / `other` server-side. The right fix is to extend
the enum.

## Ask: extend the enums

In `gemma_curation_agents/agents/audit/schemas.py`:

```python
DismissReason = Literal[
    # existing
    "redundant",
    "out_of_scope",
    "weak_evidence",
    "accepted_elsewhere",
    "wont_fix",
    "other",
    # additions for calibration disposition flow
    "missed_evidence",   # agent overlooked supporting evidence
    "no_evidence",       # agent had no support for its emission
    "borderline",        # close call — could go either way
]

AcceptReason = Literal[
    # existing
    "well_evidenced",
    "fills_gap",
    "more_specific",
    "other",
    # additions for calibration disposition flow
    "gold_was_wrong",    # Gemma's existing entry is wrong/outdated
    "borderline",        # close call — acceptable to accept
]
```

The mock API validator at `schemas.py:543` reads
`get_args(DismissReason)`, so extending the Literal flows through
to the request validation automatically.

## Why each addition matters for calibration analytics

- **`missed_evidence`** (dismiss on `calibration_gold_only_miss`):
  curator confirms gold is right and the agent FN'd. Specifically
  *because the agent overlooked something the curator can name*.
  Lumped with `weak_evidence` today, but the prompt-quality
  signal is different — `missed_evidence` says "the agent's
  retrieval / attention missed real signal," whereas
  `weak_evidence` says "the agent fabricated or overreached on
  the signal it found." Treating them as one in agg means we
  can't tell the proposer from the retriever apart.
- **`no_evidence`** (dismiss on `calibration_agent_extra`): agent
  proposed a tag without supporting evidence. Distinct from
  `weak_evidence` (which implies *some* evidence existed). Caught
  reasonably often when the proposer hallucinates a category.
- **`gold_was_wrong`** (accept on
  `calibration_gold_only_miss` — curator agrees gold should be
  removed): the gold curator's call was incorrect. The strongest
  positive calibration signal an agent can earn — TN against a
  bad gold — and currently buried under `other`.
- **`borderline`** (both): curator chose either way but it was
  close. Sufficiently distinct from `other` that it deserves
  its own row in analytics — borderlines accumulate at the
  prompt's decision frontier, where targeted iteration pays off
  most.

## UI side, after the enum ships

Drop the `toCanonicalDismissReason` / `toCanonicalAcceptReason`
mappers and the `tagPrefixedNotes` helper. The chip `key` becomes
the canonical enum value directly. No analytic-signal compression
in `notes`. Clean.

## Why now

Caught Friday morning (talk in two days). The red error box is the
most visible "demo blocker" symptom — fixing it agent-side before
Friday means the disposition flow during the GSE177029 walkthrough
works end-to-end without the curator-visible coupling to canonical
enums.
