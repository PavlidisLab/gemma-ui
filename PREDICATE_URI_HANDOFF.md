# Predicate URIs missing on StatementProposal

**Status:** Open ask, agents-side. Filed 2026-05-13 by Paul (UI).
**Sibling docs:** [`AUDIT_FEATURE.md`](./AUDIT_FEATURE.md) ·
[`CROSS_REPO_COMPAT.md`](./CROSS_REPO_COMPAT.md)

## Why

Caught on GSE105453. The FV `nonperforming · has_role · reference subject role`
rendered with:

- `nonperforming` (free-text subject) shown grounded — fixed in UI v0.6.2 by no
  longer falling back to the object URI for the FV chip.
- `has_role` predicate dot grey in the `StatementGlyph`, no CURIE in the inline
  S-P-O detail.

That second symptom is agent-side: `predicate.uri` is empty for canonical
predicates the curation guidelines spell out:

- `has_role` → `RO_0000087`
- `has_genotype` → `GENO_0000222`
- `has_phenotype` → `RO_0002200`
- `adjacent to` → `RO_0002220`
- `delivered at dose` → `TGEMO_00166`
- `delivered for duration` → `TGEMO_00167`
- `delivered to` → `TGEMO_00183`
- `induced by` → `TGEMO_00171`
- `has modifier` → `RO_0002573`
- `positive for product of gene` → `TGEMO_00169`
- `negative for product of gene` → `TGEMO_00170`
- `derives from cell line` → `CLO_0037210`
- `derives from cell` → `CLO_0037209`
- `derives from part of` → `ENVO_01003004`
- `derives from` → `RO_0001000`
- `has disease` → `RO_0016002`
- `has child with disease` → `TGEMO_00201`
- `has developmental stage` → `TGEMO_00168`
- `located in` → `RO_0001025`
- `toward` → `RO_0002503`
- `sampled after` → `TGEMO_00202`

Source: `src/lib/guidelines.ts` → `PREDICATE_GUIDELINE.bullets`. The same
list lives in the Confluence predicate guide.

## Ask

When emitting `StatementProposal`, populate `predicate.uri` from a
hard-coded label→URI map of the predicates above. This is a small,
deterministic post-pass — no LLM call needed; the label space is
closed and curator-defined.

Without it:

- `StatementGlyph` middle dot is grey, miscommunicating that the
  predicate is free-text when in fact it's a guidelines-canonical
  ontology term.
- The inline S-P-O detail (`InlineStatementDetail`) hides the CURIE
  on the predicate, making the curator second-guess whether the
  agent actually picked a real predicate or made up text.
- Grounder/defender can't disambiguate the predicate from
  curator-typed free-text in downstream audits.

## UI side

Already does the right thing with `predicate.uri` when present:

- `StatementGlyph.dotFill` → `term.uri ? green : grey`
- `InlineStatementDetail.renderTerm` → renders CURIE link when uri set

So once the agent emits `predicate.uri`, the GSE105453-style display
self-corrects without any UI change.

## Why now

Came up while polishing the audit sidebar for the 2026-05-15 talk
demo. Friday's GSE177029 walkthrough should look right, and the
predicate display is one of those "we resolve our ontology terms
properly" signals that lands well in the room.
