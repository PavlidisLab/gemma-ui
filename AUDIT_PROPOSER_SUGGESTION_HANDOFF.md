# Audit findings: structured proposer suggestion + per-finding evidence

Filed from the GUI session 2026-05-08.

## Symptom

The audit-finding card renders a "PROPOSER SUGGESTION" panel that's
just a one-line string today (e.g. `"chronic myelogenous leukemia
(CML) patients"`). Curators viewing a finding need:

1. The **proposer's ontology term** rendered as a green linkified
   chip (clickable to the term's ontology page) — same affordance
   as everywhere else in the UI.
2. The **defense** — the agent's short rationale for why this term
   on this target. Today's `rationale` is the *finding's* rationale
   (why the gold curation is wrong), not the proposer's defense for
   its alternate.
3. **Supporting evidence per finding** — the paper sentence /
   skeleton row / sample name pattern that grounded the proposer's
   pick. Rendered as a proper blockquote with full sentences. The
   report-level `evidence.paper_excerpt` / `skeleton_excerpt` is
   too coarse — every finding sees the same excerpt, not the
   per-finding piece that mattered.
4. The **cited guideline** — already on `AuditFinding.citation` /
   `citation_url`. Already rendered. ✓ no change needed there.

## Ask

Augment `AuditFinding` (Pydantic class in
`gemma_curation_agents/agents/audit/schemas.py`):

```python
class AuditFinding(_Strict):
    ...
    # Existing string field — keep for backwards compat / fallback
    # rendering on older UIs.
    proposer_suggestion: str = ""

    # NEW: structured rendering of the same suggestion.
    proposer_term: OntologyTerm | None = None
    """The ontology term the proposer would have used. UI renders
    as a green linkified Term chip. Null when the suggestion is
    structural (a missing factor, a removed tag) rather than a
    term swap."""

    proposer_defense: str = ""
    """One-sentence rationale from the proposer (or its silent
    defender judge) for why this term was the right pick.
    Distinct from ``rationale`` (which is the *finding's*
    rationale — i.e. why the gold curation is wrong)."""

    supporting_evidence: list[FindingEvidence] = []
    """Per-finding evidence anchors. Empty when no specific quote
    grounds the suggestion (the report-level paper / skeleton
    excerpts still apply as fallback)."""


class FindingEvidence(_Strict):
    """A single quote / row that grounded the proposer's pick.
    Rendered in the UI as a blockquote with the source labelled."""

    quote: str
    """Full-sentence rendering. Whole sentences please —
    half-sentence fragments read as cherry-picked even when they
    aren't."""

    source: Literal["paper", "skeleton", "sample_names",
                    "geo_metadata", "characteristic"]
    """What the quote came from. Drives the source-label chip the
    UI renders next to the blockquote."""

    location: str = ""
    """Optional pointer back to the source — e.g. paper section,
    sample short_name list, characteristic key. Empty when the
    source itself is sufficient."""
```

## Where the data already exists

The silent comparison proposer's full output is at
`AuditReport.evidence.comparison_proposal` — `Proposal` with
`factors: FactorProposal[]` and `tags: TagProposal[]`. Each
FactorProposal carries the structured term (subject + URI),
statements, and biomaterial assignments. The judge that produced
the finding *already knew* which FactorProposal /
FactorValueProposal was the alternate; threading it onto the
finding is mostly plumbing.

For `proposer_term`: pull from the matched FactorValueProposal's
subject (or the TagProposal's value).

For `proposer_defense`: the defender judge run already produces
this for calibration findings — surface it on the finding row
instead of folding it into `rationale`.

For `supporting_evidence`: the proposer's
`subtask_decisions` / `evidence.skeleton_excerpt` /
`evidence.paper_excerpt` carry the candidate snippets. The judge
narrows them per finding; the same narrowing should land on the
finding.

## UI follow-up (this repo)

Once the fields land:

- In `AuditSidebarPanel.tsx` `CompactFindingCard`, replace the
  current `proposer_suggestion` string render with:
  - `<Term uri={finding.proposer_term?.uri}>{label}</Term>` —
    green when URI present, italic grey when free-text.
  - The `proposer_defense` text below the term, slate-700.
  - A `<blockquote>` per `supporting_evidence` entry: full
    sentence text + small chip naming the source ("paper",
    "skeleton", "sample names", etc.).
- Citation + citation_url already render — keep as-is.
- The existing string `proposer_suggestion` becomes a fallback
  caption shown only when `proposer_term` is null (older
  reports, or structurally non-term findings).

Until the agent ships, the UI keeps showing today's one-line
render — backwards compatible.

## Cross-repo compatibility

Pure additive on `AuditFinding`. Older UIs ignore the new fields
and render the existing string `proposer_suggestion`. Newer UIs
fall back to the string when `proposer_term` is null. No
`MIN_UI_VERSION` bump.

## Why this matters

- **Decision quality.** Curators are choosing whether to accept,
  dismiss, or mark needs-more-info on each finding. Without the
  proposer's defense + supporting quote, that decision is made
  on partial information; curators either rubber-stamp or scroll
  back to the paper themselves.
- **Calibration loop.** The disposition feedback is the eval
  signal for the proposer / defender prompts. Curators who can't
  see the defense will dismiss for the wrong reason ("agent
  hallucinated") when the agent actually had a real quote — and
  the wrong-reason dismissal trains the prompts in the wrong
  direction.
- **Linkified terms** are a house-style affordance everywhere
  else in the UI. The audit panel feeling "less linked" makes it
  read as draft surface.
