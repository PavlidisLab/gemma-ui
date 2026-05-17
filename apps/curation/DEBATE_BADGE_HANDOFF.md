# Debate-loop badges on tag proposals

Filed 2026-05-11. Companion to `AUDIT_DEFENDER_VERDICT_HANDOFF.md`.

## What's new on the pipeline side

The iteration batch runner now runs every proposed tag through a
three-way LLM debate before auto-applying it:

1. **Challenger** — audits the tag strictly against the tagging
   guidelines; challenges anything questionable.
2. **Defender** — argues for the tag, quoting evidence; can concede.
3. **Arbiter** — neutral; rules challenger/defense/uncertain if the
   defender stands firm.

Each tag emerges with a **badge** that encodes how hard it had to
fight:

| badge | meaning | source |
|---|---|---|
| `platinum` | human curator explicitly verified this annotation | UI / curator workflow |
| `gold` | challenger approved without objection | debate loop |
| `silver` | challenged once; defender won | debate loop |
| `bronze` | fought multiple rounds before settling | debate loop |
| `stuck` | max rounds exhausted — no consensus; needs a human call | debate loop |
| `dropped` | challenger won; proposer conceded or arbiter ruled against | debate loop |
| *(empty)* | debate wasn't run (older run or `debate=false`) | — |

`platinum` is never emitted by the debate loop. It's assigned when a
human curator actively confirms an annotation in the review UI — not
applied to everything, only to items where explicit human sign-off
matters.

`dropped` tags are never applied to the experiment; they won't appear
in `proposals.jsonl`. `stuck` tags get a separate `stuck_items.jsonl`
with the full round-by-round transcript.

## New wire fields

`proposals.jsonl` gains a `badge` field per row (string, may be
empty for older runs):

```json
{
  "gse": "GSE210783",
  "category": "disease",
  "value": "dilated cardiomyopathy",
  "value_uri": "http://...",
  "evidence_quote": "...",
  "paired_status": "extra",
  "badge": "bronze"
}
```

`stuck_items.jsonl` (new file, only present when `--debate` was used)
has one row per stuck item:

```json
{
  "gse": "GSE210783",
  "category": "disease",
  "value": "dilated cardiomyopathy",
  "value_uri": "...",
  "confidence": "high",
  "evidence_quote": "...",
  "transcript": "Item: disease: dilated cardiomyopathy\nEvidence: ...\n\nRound 1:\n  Challenge (§ Sample applicability): ...\n  Defense (concedes=False): ...\n  Verdict (uncertain): ...\n\nOutcome: stuck"
}
```

`convergence_report.json` gains `n_stuck` per GSE.

## Proposed UI design

### Core principle

Gold = boring = collapsed by default. Attention flows naturally to
silver → bronze → stuck as you move up the visual stack.

The curator should spend zero time on gold items unless they choose to
inspect them. All effort goes to the contested and stuck ones.

### Per-proposal badge chip

On every proposal card, next to the confidence pill, show a small
badge chip:

| badge | chip | colour |
|---|---|---|
| `platinum` | ✓ verified | `text-sky-700` / distinct |
| `gold` | ★ gold | `text-amber-600` / muted |
| `silver` | ★ silver | `text-slate-500` |
| `bronze` | ★ contested | `text-orange-600` |
| `stuck` | !! needs call | `text-rose-700` |
| *(empty)* | *(nothing)* | — |

### Sort order in the review queue

Within each calibration batch, sort proposals:

1. `stuck` first — these need human judgment before anything else
2. `bronze` — still contentious; look carefully
3. `silver` / `extra` (no badge, debate-clean or debate not run)
4. `gold` last — collapsed by default

### Debate transcript expansion

For `bronze` and `stuck` items, show a collapsed "debate →" toggle
beneath the evidence quote. Expanding it shows the round-by-round
transcript:

```
▸ debate (2 rounds)

  Round 1
    Challenge (§ Cell type covers organism part):
      "Microglia implies brain; the organism part tag is redundant."
    Defense:
      "The BM column lists 'frontal cortex' — that's more specific
       than microglia's implied region. Keeping it."
    Arbiter: uncertain

  Round 2
    Challenge (§ Cell type covers organism part):
      [same rule, sharper argument]
    Defense: conceded
  
  Outcome: dropped
```

The transcript is the `transcript` field from `stuck_items.jsonl`.
For non-stuck bronze items, the transcript would need to be added to
`proposals.jsonl` too — TBD whether we need that now.

### Gold items — collapsed section

All `gold` proposals go into a "Clean (N)" collapsible section at the
bottom of the review queue. Closed by default. Curators can inspect
any of them, but most will never need to.

## Dismissal note: open question

**Current**: curator must pick a structured reason chip before
confirming a dismiss/accept/park action. The chip set drives
downstream analysis.

**What Paul wants to try**: drop the mandatory chip, replace with just
a free-text note field (optional or required — tbd). Argument: chips
are often a bad fit; curators mash "other" or pick the closest chip
without reading it; free text is more honest.

**Concern from the structured side**: without chips, clustering
dismiss reasons for prompt-quality analysis requires NLP instead of
a simple `GROUP BY`. But that analysis hasn't actually been run yet,
so the cost isn't proven.

**Suggested resolution** (open for discussion):
- Keep the chips but make them optional (not mandatory to confirm).
- Add a notes field that's always visible (not just for "other").
- Ship that first; if chips continue to feel forced, drop them.

This can be a separate PR — don't block badge display on it.

## What doesn't change

- The overall `AuditReportView` structure (findings grouped by kind,
  severity ordering, disposition buttons)
- The `DismissDialog` mechanics (portal anchoring, click-outside, Esc)
- The calibration batch list / per-GSE navigation
- The audit sidebar (this is the proposal review, not the audit)

## Phasing

**Now:** render the `badge` chip on each proposal card — it's already
in the wire. Sort stuck/bronze to the top.

**Next:** transcript expansion for bronze/stuck items (needs
`proposals.jsonl` to carry the transcript for bronze — backend
change first).

**Later:** collapsed gold section; dismissal note redesign (separate
discussion).
