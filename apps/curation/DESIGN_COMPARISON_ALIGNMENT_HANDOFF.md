# Design Comparison Alignment — Pre-computed Metadata

Filed 2026-05-12. Ask for my brother.

## Problem

`DesignComparisonPanel` renders the agent's proposed factors and EE tags
alongside Gemma's existing curation. It currently computes alignment
client-side:

- **Factor exact match**: label equality (lowercased).
- **Factor close match**: any FV statement URI overlaps with any URI
  across all Gemma FV statements. This catches the canonical
  "timepoint" vs "treatment" rename only because `EFO:0004425` happens
  to appear in both. A rename to a different ontology branch, or
  a factor with no URI on either side, is silently dropped.
- **Tag match**: category+value URI or label checked against
  `Design.tags`. Works only when URIs are present.

These heuristics are fragile. The agent has full access to the Gemma
skeleton it evaluates against, so alignment can be computed exactly
once, at proposal time, rather than re-approximated on every render.

## Requested wire fields

All fields are **optional** (`None` = unknown / pre-landing run).
The UI falls back to its current heuristics when they are absent.

### `FactorProposal` (in `comparison_proposal.factors[]`)

```python
match_type: Literal["exact", "close", "new"] | None = None
# "exact"  — label matches a Gemma factor (case-insensitive)
# "close"  — different label but FV ontology terms substantially overlap
# "new"    — no Gemma factor corresponds to this proposal

gemma_ref: dict[str, str | None] | None = None
# {"label": str, "uri": str | None} — which Gemma factor this aligns to;
# None on "new" factors
```

### `FactorValueProposal` (in each factor's `factor_values[]`)

```python
match_type: Literal["exact", "close", "new"] | None = None
# "exact"  — a Gemma FV for the same factor carries the same
#            primary object URI or free-text label
# "close"  — URI overlap with a different FV in the same factor
# "new"    — no Gemma FV matches

gemma_ref: dict[str, str | None] | None = None
# {"label": str, "uri": str | None} — the matching Gemma FV label;
# None on "new" FVs
```

### `TagProposal` (in `comparison_proposal.tags[]`)

```python
match_type: Literal["exact", "close", "new"] | None = None
# "exact"  — Gemma already carries this category+value (same URI, or
#            same label if URI absent)
# "close"  — same category, different value but related URI (e.g.
#            parent/child term)
# "new"    — Gemma has no tag in this category matching this value

gemma_ref: dict[str, str | None] | None = None
# {"label": str, "uri": str | None} — the nearest matching Gemma tag;
# None on "new" tags
```

## Where to compute this

In `agents/audit/pipeline.py`, after `_run_silent_proposer` returns
`comparison_proposal` (line ~409), the `snap` (Snapshot) built from
the skeleton is already in scope. `snap.factors` carries Gemma's
existing design; `snap.tags` (or the skeleton's raw tag list) carries
Gemma's EE tags. Walk `comparison_proposal.factors` and
`comparison_proposal.tags`, compare against snap, and annotate
in-place before the proposal rides into `AuditEvidence`.

A standalone `_annotate_alignment(proposal, snap)` helper keeps
`audit_curation` readable.

## UI behaviour when fields are present

When `match_type` is present the panel reads it directly instead of
running the heuristic. `gemma_ref` lets the panel show "aligns to
Gemma factor X" on hover without a separate lookup. Absent fields →
existing heuristic path unchanged.

## What doesn't change

- `AuditEvidence` and `AuditReport` shapes are unmodified.
- The proposer pipeline itself (`propose_curation`) is not touched —
  annotation happens in the audit layer after the silent run.
- Existing audit reports (no `match_type` fields) render exactly as
  today.
