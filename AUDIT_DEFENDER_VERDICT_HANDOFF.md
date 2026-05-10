# Audit UI: surface the defender's verdict on each finding

Filed 2026-05-09. Companion to `AUDIT_FEATURE.md` and
`AUDIT_PROPOSER_SUGGESTION_HANDOFF.md`.

## Policy shift

Original calibration design: curators stayed blind to the
defender's call during review so their disposition wouldn't be
biased. New stance (Paul, 2026-05-09): "I want the curators to
have as much information as possible for evaluation." The
defender's verdict now rides on the finding payload and the UI
should render it alongside the proposer suggestion.

## What's new on the wire

`AuditFinding` (in `gemma_curation_agents/agents/audit/schemas.py`)
gains an optional field:

```python
class AttachedDefenderVerdict(BaseModel):
    side: str         # "agent_extra" | "agent_missed_gold"
    verdict: str      # one of the defender's enum values (see below)
    rationale: str    # one-paragraph explanation
    citation: str     # rule-section the defender cited
                      # (e.g. "09_experiment_tags.md § Sample applicability")

class AuditFinding(...):
    ...
    defender_verdict: Optional[AttachedDefenderVerdict] = None
```

Pure additive — older payloads have `defender_verdict = null` and
older UIs ignore the field cleanly. As of calibration package v9
(`/tmp/calibration_packages/calibration_calibration-2026-05-09-v9`),
every `calibration_agent_extra` and `calibration_gold_only_miss`
finding carries a verdict when the defender row matched
(side + lowercased category + lowercased value); `calibration_match`
findings have `defender_verdict = null` because the defender
doesn't run on matches.

## Defender verdict enum

Six values, side-constrained:

**Side: `agent_missed_gold` (gold-only-miss findings)**
- `agent_miss_genuine` — gold tag should have been proposed; agent
  missed it. Strong signal that curator should keep the existing
  tag.
- `agent_correct_inherited` — gold duplicates an annotation already
  inherited from a FactorValue / BioMaterial; agent rightly didn't
  add it. Curator might consider removing the gold tag.
- `agent_correct_overzealous_gold` — gold isn't supported by the
  evidence; curator over-tagged. Same direction as above —
  consider removing.

**Side: `agent_extra` (agent-extra findings)**
- `extra_genuine_new` — well-evidenced tag the curator missed.
  Strong signal to add the agent's proposal.
- `extra_inherited_redundant` — agent's extra duplicates an
  inherited annotation. Curator can dismiss.
- `extra_unsupported` — agent's extra isn't well-evidenced.
  Curator can dismiss with confidence.

## UI render — what shipped (2026-05-09)

Final design diverges from the chip-and-card sketch below. Curator-
facing wording uses **"Judge"** (not "defender"); the verdict is
folded into the existing surfaces rather than getting its own panel:

1. **Proposer-suggestion header** changes from `proposer suggestion`
   to `weak suggestion` / `strong suggestion` based on the verdict
   (no chip, no enum exposed):
   - strong: `extra_genuine_new`, `agent_correct_inherited`,
     `agent_correct_overzealous_gold`
   - weak: `agent_miss_genuine`, `extra_inherited_redundant`,
     `extra_unsupported`
2. **Judge one-liner** appended at the bottom of the proposer panel —
   small grey italic, prefixed `Judge:`, body = `dv.rationale`.
   `dv.citation` rendered as a tooltip rather than inline text.
3. **Suggested-fix card** shows a brief human-readable override for
   "weak" verdicts where the curator should *not* take the agent's
   action (e.g. "Dismiss — judge: the agent's pick isn't well-
   evidenced."). Strong verdicts keep the agent's
   `finding.suggested_fix` unchanged.

Source: `src/features/audit/AuditSidebarPanel.tsx` — helpers
`verdictStrength()` and `shortFixForVerdict()` next to
`ProposerSuggestionPanel`.

Original chip-and-card sketch (kept below for diff context):

A new "DEFENDER" panel inside each finding card, sibling to the
existing "PROPOSER SUGGESTION" panel:

```
┌─ FINDING ────────────────────────────────────────┐
│  Should `organism part: arcuate nucleus of       │
│  hypothalamus` be removed?                       │
│                                                  │
│  ┌─ PROPOSER SUGGESTION ──────────────────────┐  │
│  │  (… existing render …)                     │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌─ DEFENDER (second opinion) ────────────────┐  │
│  │  ⚑ agent_miss_genuine                      │  │
│  │  Paper Methods explicitly states           │  │
│  │  "Hypothalamic ARC regions were            │  │
│  │  dissected and total RNA was isolated,"    │  │
│  │  establishing that the profiled samples    │  │
│  │  derive from the arcuate nucleus of        │  │
│  │  hypothalamus, a specific organism part    │  │
│  │  not captured by the inherited "brain"     │  │
│  │  tag.                                      │  │
│  │  cite: 09_experiment_tags.md § When tags…  │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  [Agree (remove)]  [Disagree...]  [Not sure]     │
└──────────────────────────────────────────────────┘
```

Suggested visual treatment for the `verdict` chip:

| verdict | colour | meaning |
|---|---|---|
| `agent_miss_genuine` | amber / warning | "defender thinks gold is right; keep it" |
| `agent_correct_inherited` | slate / muted | "redundant with inheritance; safe to remove" |
| `agent_correct_overzealous_gold` | slate / muted | "evidence weak; safe to remove" |
| `extra_genuine_new` | emerald / positive | "defender thinks agent is right; add it" |
| `extra_inherited_redundant` | slate / muted | "redundant with inheritance; safe to dismiss" |
| `extra_unsupported` | red / caution | "defender thinks agent is wrong; safe to dismiss" |

The `citation` field is short (a rule-section reference). Render
inline as a small grey "cite: …" suffix on the rationale; if the
rule-section markdown lives somewhere browseable, link it.

## Data path

Same shape as `proposer_term` / `proposer_defense` /
`supporting_evidence`: read straight off the finding object the
audit endpoint already returns. No new endpoint needed; no UI
state machine; render-if-present, hide-if-null.

## Compatibility

- Older calibration packages (≤ v8): `defender_verdict = null` on
  every finding — UI hides the panel. Today's render unchanged.
- Older agents emitting fresh audits (non-calibration): same;
  field absent from the payload, UI hides.
- The original `calibration_defender_verdicts` storage table
  still receives the same data via `setup.py` — owner-side
  aggregator paths unchanged.

## Phase 2 (out of scope here)

For ad-hoc audits where the defender hasn't run (today's calibration
packages have it; freshly-audited live experiments don't), Paul
flagged a future "investigate further" button that triggers a
synchronous defender-style LLM call on demand. Same render shape
as this; just lazy-fetched. Filed in
`todo_self_revision_pass.md` / project memory.

---

## 2026-05-09 update — strength is now producer-side (calibration v10+)

`AttachedDefenderVerdict` gains a `strength` field — calibration
package v10 onward (commit `5b1f811`):

```python
class AttachedDefenderVerdict(BaseModel):
    side: str
    verdict: str
    strength: Literal["weak", "moderate", "strong"] = "moderate"  # NEW
    rationale: str = ""
    citation: str = ""
```

Per Paul: lift the strength signal out of the UI helper
(`verdictStrength()`) and into the data layer so future producers
(the curator-triggered "extra review" / investigator landing
soon) can emit the same field shape without forcing UI to grow
more enum-mapping helpers as the verdict catalogue expands.

### Mapping (mirrored from `verdictStrength()` exactly)

| verdict | strength |
|---|---|
| `extra_genuine_new` | `strong` |
| `agent_correct_inherited` | `strong` |
| `agent_correct_overzealous_gold` | `strong` |
| `extra_inherited_redundant` | `weak` |
| `extra_unsupported` | `weak` |
| `agent_miss_genuine` | `weak` |

Three levels (not two) so future investigator verdicts that
aren't open-and-shut have a natural slot.

- **strong** — judge agrees with the proposer's cued action;
  curator can take the suggested fix with confidence.
- **moderate** — judge has a view but the case isn't binary.
  *(Default for unknown verdict strings; the natural slot for
  future investigator output that isn't a clean strong/weak
  call.)*
- **weak** — judge thinks the proposer's suggestion is likely
  wrong; curator should override.

### What I'd suggest changing in the UI

Both options work — pick whichever is less code:

**Option A (smallest diff):** keep `verdictStrength()` for v9-and-
older packages, but prefer the field when present:

```ts
const strength = dv.strength ?? verdictStrength(dv.verdict);
```

Same with `shortFixForVerdict()` if/when the producer starts
emitting that too.

**Option B (cleaner):** delete the helpers and rely on
`dv.strength` only, since:
- v10+ packages all carry the field.
- Future investigator producers will set it.
- Older packages without the field would default to `"moderate"`
  via the schema default (Pydantic fills it in on serialize/
  deserialize) — slightly less informative than the helper for
  legacy verdicts but loses zero data going forward.

Suggest A for now; B once v10 has been the standard for a couple
of weeks and there's no v9-or-older traffic.

### Future producers will use the same shape

When the curator-triggered "investigate further" / "extra review"
button lands (per `todo_pipeline_iteration_and_gestalt.md`
direction A), its output will be a sibling `investigator_verdict:
AttachedJudgement | None` field on `AuditFinding` carrying the
SAME `(verdict, strength, rationale, citation)` shape. The
`strength` axis is what lets the UI render both producers
through one code path.
