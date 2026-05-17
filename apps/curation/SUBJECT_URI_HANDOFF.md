# Subject URI on identity-bearing FV statements

**Status:** Open ask, agents-side. Filed 2026-05-13 by Paul (UI).
**Sibling docs:** [`PREDICATE_URI_HANDOFF.md`](./PREDICATE_URI_HANDOFF.md) ·
[`AUDIT_FEATURE.md`](./AUDIT_FEATURE.md) ·
[`CROSS_REPO_COMPAT.md`](./CROSS_REPO_COMPAT.md)

## Why

UI v0.6.2 tightened the FV chip's URI lookup to **only** read the
subject slot. Previously `bestFvUri` scanned `object → subject →
predicate` and returned the first URI it found — needed at one
point because genotype-shape statements like `gene · has_genotype ·
wild-type-genotype (EFO:0005168)` put the meaningful URI on the
object, so the chip would have rendered the gene name as
ungrounded otherwise.

The cross-slot fallback caused the inverse failure (GSE105453:
`nonperforming · has_role · reference_subject_role (OBI:0000220)`
showed `nonperforming` falsely grounded by the role's URI). Picking
between the two failures, mis-grounding free-text as ontology is
the worse one — easier to spot a missing chip than to spot a
wrong chip. So the UI now strictly trusts the subject slot.

That means agent-side responsibility: when an FV's identity is
captured by an ontology term, the URI has to ride on the **subject**,
not the object.

## Shapes affected

Best to put the identity URI on the subject for any FV the agent
generates from a guideline-canonical pattern:

| Predicate | Current (often) | Should be |
|---|---|---|
| `has_role` (RO_0000087) | subj=free-text + obj=role-URI | subj=role-URI (or both URI'd if the substance is also ontology) |
| `has_genotype` (GENO_0000222) | subj=gene-name (free-text) + obj=mutation-type-URI | subj=gene-URI (NCBI_GENE) + obj=mutation-type-URI — both should ground when the curator's intent is `gene-X knockout` |
| `has_phenotype` (RO_0002200) | subj=gene-name + obj=phenotype-URI (e.g., SO_0002315 increased_gene_product_level) | subj=gene-URI + obj=phenotype-URI |
| baseline FVs (`has role · reference_substance_role`, etc.) | subj=substance-free-text + obj=baseline-URI | subj=substance-URI when the substance is in an ontology (DMSO → CHEBI), else free-text is fine |

The `has_role` case is the one that surfaced in GSE105453. The
underlying free-text term `nonperforming` is *genuinely* free-text
— no PATO term for "non-performing" exists — so subject correctly
has no URI. The bug was UI inheritance, fixed. No agent change
needed for that specific FV.

The shapes worth fixing agent-side are the ones where an ontology
term *does* exist for the subject but the agent didn't put it
there. Wild-type-genotype FVs are the most common: subject often
says "wild type" as free-text when EFO_0005168 ("wild type
genotype") could ride on the subject.

## Ask

When the FV's identity matches an ontology term in the
proposer / grounder's reach, emit that URI on `subject.uri`. The
grounder already resolves these terms downstream — the change is to
**which slot** the URI lands on, not to add resolution.

For mutation-type-on-gene shapes, the cleanest answer is to URI
both slots (subject = gene URI, object = mutation-type URI). The
glyph then renders `●─●─●` and the curator sees both are grounded.

## UI side

Already does the right thing with `subject.uri` when present:

- `bestFvUri` returns it as the FV chip's binding (green `Term`).
- `InlineStatementDetail.renderTerm` shows the CURIE link.
- `StatementGlyph` left dot turns green.

So once the agent emits `subject.uri` for these shapes, the FV
chips self-correct without any UI change. Same shape as
`PREDICATE_URI_HANDOFF.md`.

## How to verify

A wild-type-genotype FV that's currently rendering as `wild type`
(italic, no green chip) is the canary. After this lands, it should
render `wild type EFO:0005168` with the chip green, and the
StatementGlyph subject dot should be filled.

## Risk if not done

Wild-type and similar identity-bearing FVs render as if they're
free-text — visually equivalent to a curator typing a label without
picking an ontology term. Calibration scoring would treat them
correctly via URI comparison (the URI does exist on the object), but
the *curator-facing display* understates the agent's actual
grounding. For the Friday talk demo + future curator reviews this
makes the agent look worse than it is.
