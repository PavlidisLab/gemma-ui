# Debate transcripts + 50-GSE calibration package

Filed 2026-05-12. Companion to `DEBATE_BADGE_HANDOFF.md`.

## Current package ready to load

`calibration-2026-05-12-50gse` — 44 experiments, 93 findings.

Six of the 50 sampled GSEs are absent: the agent proposed nothing AND
Gemma has no EE tags for them, so there are no findings either way.

**Finding breakdown:**

| issue_code | count | has debate_badge |
|---|---|---|
| `calibration_agent_extra` | 32 | ✓ all 32 (27× gold, 5× silver) |
| `calibration_gold_only_miss` | 47 | ✗ (agent didn't debate tags it never proposed) |
| `calibration_match` | 14 | ✓ all 14 (14× gold) |

32 of 93 findings have `supporting_evidence` populated (paper /
biomaterial quote located by substring match). The other 61 are empty
— mostly `calibration_gold_only_miss` rows where the agent has no
quote.

No `stuck` or `bronze` items in this batch — all debates settled in
≤ 1 challenge round. So the transcript expansion UI can stay dormant
for now (won't break anything if it renders, just won't trigger).

## New pipeline file: `debate_transcripts.jsonl`

From this session forward, `run_iteration_batch.py --debate` writes
`debate_transcripts.jsonl` alongside `proposals.jsonl` — one row per
tag that received at least one challenge round (GOLD-with-no-challenge
items are omitted since there's nothing to show).

**Schema:**

```json
{
  "gse": "GSE138272",
  "category": "strain",
  "value": "CD1 mus strain",
  "value_uri": "http://www.ebi.ac.uk/efo/EFO_0005180",
  "badge": "silver",
  "rounds": [
    {
      "challenge_citation": "§ Strain applicability",
      "challenge_reason": "The study says ICR mice; CD1 is an alias but not confirmed.",
      "defense_concedes": false,
      "defense_response": "ICR is the Charles River stock Crl:CD1(ICR); see our strain table.",
      "verdict_side": "defense",
      "verdict_reason": "Alias is well-documented; defense wins."
    }
  ]
}
```

The current package was built from the run that *predated* this
change, so `data/<gse>/debate_transcripts.json` files are absent.
The next run will populate them. The build script already writes
them when present — no further build-side changes needed.

## Package layout (per GSE)

```
data/<gse>/
  design.json                  — existing Gemma design (factors + tags)
  audit.json                   — AuditReport with all findings
  defender_disagreements.json  — legacy defender verdicts (empty this run)
  debate_transcripts.json      — ← NEW (absent this run; present next run)
```

## What the UI needs for debate transcripts

When `debate_transcripts.json` is present for a GSE:

1. Load it alongside `audit.json` on the experiment detail view.
2. For each finding with a non-gold badge, look up `(category, value)`
   in the transcript list.
3. Show a collapsible "debate →" section below the evidence quote
   (already specified in `DEBATE_BADGE_HANDOFF.md`).
4. Each round renders: challenge citation + reason → defense response
   → verdict side + reason.

The `transcript` field in `stuck_items.jsonl` (plain text) is the
legacy format for stuck items. `debate_transcripts.json` is the
structured replacement — prefer it when available.

## `calibration_match` rationale

The rationale-rewrite logic in `rewriteCalibrationRationale()` covers
`calibration_agent_extra` and `calibration_gold_only_miss`. There are
also 14 `calibration_match` findings (both sides agree). Suggested
copy for those:

> "Agent and Gemma both have `{category}: {value}`. Is this correct?"

These findings have severity `ok` and sort to the bottom — curators
will rarely look at them. But the current rationale text (whatever the
raw `rationale` field says) might read oddly without a rewrite. Low
priority.

## Agent-proposed design — now in comparison_proposal

The agent's proposed design (factors + FV assignments) is now wired
into `evidence.comparison_proposal.factors` on every `AuditReport` in
the package. 44/44 GSEs have agent factors populated; 81 factors
total.

Each `FactorProposal` has:
- `category.label` / `category.uri` — the proposed EFC
- `factor_type` — `"categorical"` or `"continuous"`
- `factor_values[].free_text_label` — the FV label
- `factor_values[].biomaterial_short_names` — sample assignments

The existing `design.json` per GSE is still Gemma's current design
(unchanged). The UI can compare the two side-by-side:
- `design.json` → curator's existing factors
- `audit.json → evidence.comparison_proposal.factors` → agent's proposed factors

No findings are emitted for design disagreements yet — that's a future
audit judge. For now, the proposed design is visible data that the
curator can inspect alongside the EE tag findings.
