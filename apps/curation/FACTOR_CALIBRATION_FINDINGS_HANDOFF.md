# Factor calibration findings — capture curator evaluation of factors

**Status:** Open ask, agents-side. Filed 2026-05-13 by Paul (UI).
**Sibling docs:** [`AUDIT_FEATURE.md`](./AUDIT_FEATURE.md) ·
[`AUDIT_DISPOSITION_REASONS_HANDOFF.md`](./AUDIT_DISPOSITION_REASONS_HANDOFF.md) ·
[`DESIGN_COMPARISON_HANDOFF.md`](./DESIGN_COMPARISON_HANDOFF.md)

## Why

Calibration audits today emit findings for **tags only**
(`calibration_match`, `calibration_agent_extra`,
`calibration_gold_only_miss`). Factors are surfaced in the
`comparison_proposal.factors` panel with a one-way "+ add" button
that pushes the agent's factor into the curator's design draft —
useful, but it captures **no feedback** about the curator's verdict.

We want factor-level decisions to be first-class evaluation signal,
mirroring how tag decisions already feed the calibration loop:

- Curator agrees with an agent-proposed factor not in Gemma → agent
  TP for that factor.
- Curator declines a proposed factor → agent FP.
- Curator says "Gemma already has the equivalent factor under a
  different label, agent's renaming/restructuring is correct" → can
  be modelled as accept-with-replace (drop the Gemma factor, take
  the agent's).
- Curator says "Gemma has a factor the agent didn't propose; keep
  it" → agent FN.
- Curator says "Gemma has a factor the agent didn't propose; the
  agent's right, remove it" → agent TN.

Paul's 2026-05-13 framing: *"If the curator accepts a factor and
deletes a factor already present, or says 'no', we want to capture
that as feedback."*

## Ask: emit factor-level calibration findings

Mirror the existing tag flow in
`scripts/build_calibration_batch.py`. For every factor pair (or
solo gold / solo agent factor), emit one `AuditFinding` with
`target_kind="factor"`, severity per the table below, and a
calibration-namespaced `issue_code`. The UI will route them through
the same `FindingActionRow` flow tag findings use today — accept /
disagree / park dialogs all already exist.

### Proposed issue codes + target_id formats

| Case | issue_code | severity | target_id |
|---|---|---|---|
| Agent and Gemma both have the factor (category match) | `calibration_factor_match` | `ok` | `factor:<existing_id>` (Gemma's factor id) — fall back to `calibration:factor_match:<agent-category>` when no Gemma id available |
| Agent proposes a factor Gemma doesn't have | `calibration_factor_extra` | `minor` | `calibration:factor_extra:<agent-category>` |
| Gemma has a factor the agent didn't propose | `calibration_factor_gold_only_miss` | `minor` | `factor:<existing_id>` (Gemma's factor id) — fall back to `calibration:factor_miss:<gemma-category>` |
| Agent renames a Gemma factor (close match, different label) | `calibration_factor_renamed` *(optional)* | `minor` | `factor:<existing_id>` |

The `*_renamed` variant is nice-to-have — could fold into
`*_extra` + `*_gold_only_miss` if simpler. Curator's choice ("keep
agent's name" vs "keep Gemma's") becomes the feedback signal.

### Rationale templates

Mirror the tag rationales so the UI's `rewriteCalibrationRationale`
helper handles them with a one-line addition:

- `calibration_factor_match`: ``"Is `<category>` correctly captured?"``
- `calibration_factor_extra`: ``"Should we add factor `<category>`?"``
- `calibration_factor_gold_only_miss`: ``"Should factor `<category>` be removed from the curation? (the agent did not propose it.)"``
- `calibration_factor_renamed`: ``"Agent proposes renaming `<gemma-category>` → `<agent-category>`. Accept?"``

The UI dedupe filter at
`src/features/audit/AuditReportView.tsx:638` already keys on the
backticked `<category>: <value>` pair in the rationale to drop
factors from the comparison panel that already have findings —
will need a parallel key for factor findings (likely just
`<category>` since factors don't have values at this level). I'll
land that mirror once findings ship.

### Apply actions

Same shape as tag findings — `ApplyAction(kind=...)` so the UI's
"Apply & focus" button can do the structural mutation in one click.

| issue_code | accept = apply_action |
|---|---|
| `calibration_factor_match` | `remove_factor` (only when curator dismisses with `curator_wrong` — the match is wrong and Gemma's factor should go) |
| `calibration_factor_extra` | `add_factor` (with `new_factor_payload` carrying the agent's FactorProposal — UI uses it to push into the design draft, same path the current "+ add" button uses) |
| `calibration_factor_gold_only_miss` | `remove_factor` (when curator accepts — agent's right, drop Gemma's factor) |
| `calibration_factor_renamed` | `rename_factor` (set Gemma factor's category label to agent's proposed label) |

The `ApplyAction` enum needs the new kinds. UI side:
`src/features/audit/applyHandlers.ts` will gain handlers — small
diff, mostly forwarding into `applyDraft`.

### Disposition chip sets

Same accept / dismiss / not-sure dialog the tag findings use today.
The chips need new copy keyed off the new issue codes — I'll mirror
the calibration tag chip-set patterns (`CAL_EXTRA_DISMISS_CHIPS`
etc.) once we agree on the issue codes above.

## Why this matters

Calibration runs are only as informative as the disposition signal
the curator leaves behind. Today the factor side of the design
proposal is **invisible to calibration analytics** — we can tell
that an agent proposed `cell type` for GSE51059 but not whether
the curator agreed, disagreed, or thought the existing Gemma
factor was correctly named. Without that, factor-proposer
calibration v17+ has nothing to converge on. Tag-side calibration
has been driving useful prompt iteration for weeks; factor-side
needs the same loop.

## UI shape, for reference

Already in place — no UI work blocks this ask:

- `FindingActionRow` is target-kind-agnostic; pass any
  `AuditFinding` and it renders Agree / Disagree / Park with the
  right chip sets per `issue_code`.
- `MatchFindingRow` (new, 2026-05-13) renders match findings as
  compact green-check rows in the sidebar finding list — factor
  matches will fold in for free.
- `DesignComparisonPanel`'s factor rows will collapse into the
  finding list the same way tag proposals already do once factor
  findings are emitted.

## Notes / questions for my brother

- Continuous factors: not in scope for v1 of this ask — the
  comparison proposer doesn't yet emit continuous-factor proposals
  in a way that pairs cleanly. Stick to categorical for the first
  pass.
- FV-level findings (`calibration_fv_extra` etc.): also out of
  scope for v1. Factor-level is the higher-signal coarsest grain
  to start with; FV-level can follow once the factor flow is
  proving itself in calibration v18+.
- The dedupe filter on the UI side keys on rationale text — if you
  want a more robust key, mirror the tag approach and also emit a
  conceptual target_id suffix the UI can parse
  (`calibration:factor_extra:<category>`). Either works; I'll
  follow whatever you ship.
