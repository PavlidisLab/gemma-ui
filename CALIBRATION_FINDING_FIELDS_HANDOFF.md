# Calibration findings: structured proposer_term + trimmer rationales

Filed 2026-05-08 from the GUI session.

## Symptom

Curator opened the audit sidebar on a calibration set and saw two
problems on `calibration_agent_extra` (and likely the other
calibration issue codes):

1. **Proposer suggestion renders as plain text**, not as the green
   linkified Term we wired into `ProposerSuggestionPanel` after
   `AUDIT_PROPOSER_SUGGESTION_HANDOFF`. Term chip + defense + evidence
   blockquotes only fire when `AuditFinding.proposer_term` is set;
   the calibration judge today only sets the legacy
   `proposer_suggestion` string ("chronic myelogenous leukemia (CML)
   patients").
2. **Rationale is too long.** Every calibration finding ends with
   ``"... Accept if this is real curation work the agent caught,
   dismiss if the agent was wrong."`` That sentence is dead
   weight — the disposition buttons literally say "Accept" and
   "Dismiss…". On a 30-finding calibration audit it's a lot of
   noise.

Concrete row from a screenshot Paul shared:

> Tag · calibration_agent_extra
> "Agent proposed `disease: chronic myelogenous leukemia` but the
> existing curation does not have it. Accept if this is real curation
> work the agent caught, dismiss if the agent was wrong."

## Asks

### 1. Populate `proposer_term` (and friends) on calibration findings

The structured fields landed in
`AuditFinding` per `AUDIT_PROPOSER_SUGGESTION_HANDOFF.md`:

- `proposer_term: OntologyTerm | None`
- `proposer_defense: str`
- `supporting_evidence: list[FindingEvidence]`

Calibration judges (`calibration_agent_extra`,
`calibration_agent_missing`, `calibration_agent_disagree`, …) emit
a string `proposer_suggestion` but skip the structured fields. They
should fill them:

- `proposer_term` from the matched `FactorProposal.factor_values[*].subject`
  / `TagProposal.value` in
  `AuditEvidence.comparison_proposal`. The data is right there in
  the evidence blob — same lookup the `proposer_suggestion` string
  is already doing.
- `proposer_defense` should carry the defender judge's one-sentence
  defense (today calibration findings don't get a defender pass; if
  that's by design, leave the field empty and only `proposer_term`
  + `supporting_evidence` need to populate).
- `supporting_evidence` from the source quote / characteristic /
  sample names that grounded the alternate. Same shape as the
  judge findings already use.

### 2. Drop the "Accept if … dismiss if …" suffix from rationales

The disposition affordance (Accept / Dismiss…) is rendered next to
every finding card; the curator does not need it described in
prose. Trimming the suffix gets every calibration card back to
just the **claim** ("Agent proposed X but the existing curation
does not have it"), which is what the curator actually needs.

Concretely: in whatever the calibration judge's rationale-template
is, drop the trailing imperative and stop at the period after the
core claim.

## UI side — already shipped today

To smooth the transition until the agent-side trim lands, the UI
runs `trimRationaleBoilerplate` over `finding.rationale` before
render (`src/features/audit/AuditSidebarPanel.tsx`). Strips:

```
\s*(?:^|\.\s+)Accept\s+(?:if|this)\b[^.]*?\bdismiss\s+if\b[^.]*?\.?\s*$
```

Conservative — only fires on the recognisable boilerplate ending,
returns the input untouched otherwise. Once you trim the rationales
agent-side, the regex becomes a no-op safely.

## Compatibility

Pure additive. `proposer_term` defaults to `None`; UI's structured
panel falls back to the legacy `proposer_suggestion` string when
the term is missing, so neither side breaks during the transition.
Trimming the rationales is also additive (UI side is defensive
either way).
