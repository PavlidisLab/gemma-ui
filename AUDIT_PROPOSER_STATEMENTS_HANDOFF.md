# Audit findings: structured proposer statements (S-P-O glyph parity)

Filed 2026-05-08 from the GUI session.

## Symptom

The proposer-suggestion panel on an audit finding renders the
agent's pick as a single `Term` chip — `Foxp3 wild type` italic
+ grey when free-text, label + green chip + URI when grounded.
That's right for tag-shape findings (a tag has a single value
term).

But it's incomplete for FV-shape findings, where the proposer's
real output is a **structured statement** (subject · predicate ·
object). Today the UI shows `Foxp3 wild type` italic-grey and the
curator has to guess whether:
- the *subject* is free-text (free-text gene name, predicate is
  fine), OR
- the entire statement is unmapped (subject + predicate + object
  all unresolved).

The proposal card already has the answer for this — it renders
the SVG `StatementGlyph`: three discs joined by short lines, one
per (S, P, O), green disc per URI-mapped slot, slate disc per
free-text slot, plus an `×N` count for multi-statement FVs.

## Ask

Add structured statement payload to `AuditFinding` so the audit
panel can render the same `StatementGlyph` and curators get the
same at-a-glance shape signal:

```python
class AuditFinding(_Strict):
    ...
    # Existing single-term field — keep as fallback for tag findings
    # that don't have a structured statement. Auditor judges and
    # calibration extras both rely on this for the simple case.
    proposer_term: Optional[OntologyTerm] = None

    # NEW: full structured statements as the proposer would have
    # emitted them. Empty for tag-shape findings (use proposer_term
    # only) and for findings with no proposer alternate. Populated
    # for FV / factor-shape findings where the term-only render
    # loses information.
    proposer_statements: list[StatementProposal] = Field(default_factory=list)
```

Source for the statements is the matched `FactorValueProposal` in
`AuditEvidence.comparison_proposal` — the calibration / FV judges
already know which FV they're commenting on (they used it to
build `proposer_term` and `proposer_suggestion`); threading the
parallel `statements` field through is plumbing.

## UI follow-up

Once the field lands:

1. Move `StatementGlyph` from `src/features/proposal/ProposalCardV2.tsx`
   to a shared location (probably `src/components/ui/StatementGlyph.tsx`)
   so the audit panel can import it without duplicating the SVG /
   popover code.
2. In `ProposerSuggestionPanel`:
   - When `proposer_statements.length > 0` → render
     `<StatementGlyph statements={proposer_statements} />` and skip
     the single-term `<Term>` (the glyph carries it).
   - When `proposer_statements` is empty but `proposer_term` is set
     → render the existing single `<Term>` (today's fallback path).
   - When both empty but `proposer_suggestion` (legacy string) is
     set → today's plain-text fallback.
3. The free-text vs URI signal is the disc colour — italic-grey
   `<Term>` becomes the *fallback* signal rather than the primary
   one. Curators don't have to learn "italic = free-text" because
   the disc colour is more direct.

## Cross-repo compatibility

Pure additive on `AuditFinding`. Older UIs ignore the new field
and fall back to `proposer_term`. Newer UIs prefer the structured
shape when present. No `MIN_UI_VERSION` bump.

## Why this matters

- **Free-text vs unmapped slot.** Today's italic-Term render reads
  as "this is free-text" but doesn't say *which slot* — curators
  who get used to "italic = free-text" still don't know whether
  the predicate / object are resolved. The glyph names each slot.
- **Consistency with the proposal card.** Curators reviewing the
  audit are the same curators who reviewed the proposal earlier
  in the workflow. The shape signal should be the same in both
  places — italic chip on one surface and disc-cluster on another
  is a learnability tax.
- **Multi-statement FVs.** A "ULK1 and ULK2 double knockout" FV
  has two statements; today's audit-finding render collapses that
  to one term. The glyph's `×N` indicator surfaces the structure.
