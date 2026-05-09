# `FindingEvidence.context` — bigger preview-and-expand context per finding

Filed 2026-05-08 from a calibration-audit session.

## Symptom

Curators reading audit findings on the calibration set hit a recurring
bottleneck: the inline `quote` field in `FindingEvidence` is a single
full sentence (per the original schema's "full-sentence rendering" rule),
but to actually triage a finding they often need surrounding context —
the paragraph the quote came from, the sample-names neighbourhood, the
characteristic block in context with siblings. Today they have to
leave the audit panel, open the paper / GEO record / Gemma sample
table separately, and come back. On a 30-finding calibration set
that's a real workflow tax.

Paul, verbatim:

> "A bottleneck is that the evidence provided by the proposer inline
> isn't enough. I need to see more context. It's fine if we show a
> preview, but we should grab 'a lot' more context."

## Ask

Extend `FindingEvidence` (in
`gemma_curation_agents/agents/audit/schemas.py`) with a longer-form
`context` field that carries the surrounding text. UI uses the
existing `quote` as the preview blockquote + adds a "Show more"
expander that reveals the larger block.

```python
class FindingEvidence(_Strict):
    quote: str            # unchanged — anchor sentence rendered as preview
    source: Literal[...]  # unchanged
    location: str = ""    # unchanged

    # NEW: surrounding text — several paragraphs / a sample-names
    # neighbourhood / the characteristic block in context with
    # siblings. UI renders the existing ``quote`` as the
    # collapsed-state blockquote and exposes ``context`` behind a
    # "Show more" affordance. Empty when no wider context applies
    # (single-line characteristics, etc.); UI hides the expander.
    context: str = ""

    # NEW: deep-link to the canonical source so the curator can
    # bounce out to the GEO record / PubMed / Gemma sample page
    # when context isn't enough. Renders as a small "open ↗" link
    # next to the source-label chip on each blockquote. Empty when
    # no stable URL applies; UI hides the link.
    source_url: str = ""
```

Suggested context + source-url payloads per source:

| `source` | `quote` (today, kept) | `context` (new) | `source_url` (new) |
|---|---|---|---|
| `paper` | the anchor sentence | the containing paragraph + the next paragraph; max ~1500 chars | PubMed (`https://www.ncbi.nlm.nih.gov/pubmed/<pmid>`), or DOI (`https://doi.org/<doi>`), or PMC for full-text. Section anchor when reachable (`#sec-3`); otherwise just the article URL. |
| `skeleton` | the anchor row | ±3 rows around it | the Gemma experiment page: `${GEMMA_BASE}/expressionExperiment/showExpressionExperiment.html?id=<eeid>` |
| `sample_names` | the matched names | the full ordered sample-names list (curator scans for outliers) | the GEO series page (`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=<gse>`) when the per-finding scope is the whole experiment; the per-sample GEO URL for single-sample findings |
| `geo_metadata` | the matched key/value | the full GEO `characteristics_ch1` / `source_name_ch1` block for that sample | the per-sample GEO page: `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=<gsm>` |
| `characteristic` | the matched key/value | every characteristic for that biomaterial, ordered | Gemma's biomaterial detail when accessible; otherwise GEO sample page |

Rationale for the per-source caps: `paper` and `skeleton` are
unbounded text — cap so the API payload doesn't blow up on long
review packets. `sample_names` / `geo_metadata` / `characteristic`
are naturally bounded (one experiment's worth) so render in full.

`source_url` is best-effort; empty is fine when no stable URL
applies (free-text characteristic without an obvious back-link,
paper without a PMID/DOI, etc.). UI hides the link when empty
rather than rendering a broken affordance.

## UI follow-up (this repo)

Once the fields land:

- `FindingEvidenceBlock` in
  `src/features/audit/AuditSidebarPanel.tsx`:
  - When `evidence.context` is set + non-empty AND differs from the
    `quote`: render a **"Show more"** button beneath the blockquote
    that toggles a sibling `<pre>` (preserving whitespace) with the
    `context` text. `whitespace-pre-wrap break-words` on the
    container so paragraphs read.
  - Toggle text flips to **"Show less"** when expanded.
  - When `evidence.source_url` is set: render a small
    `open ↗` link in the source-label header strip
    (next to the `paper` / `GEO` / `characteristic` chip).
    `target="_blank" rel="noopener noreferrer"`. `stopPropagation`
    on the click so the curator can pop out without toggling the
    expander or the parent finding card.
  - Closed-card grey-out (existing) still applies; the expander
    + link just change the visible content within the panel.
  - When `context` is unset / empty / equal to `quote`: hide the
    expander. When `source_url` is unset / empty: hide the link.
    Today's render is the floor.
- TS mirror: add `context?: string` and `source_url?: string` to
  `FindingEvidence` in `src/api/auditTypes.ts`.

No new endpoints. The ~1.5 KB-per-finding bump on report payloads
is well within budget for the calibration-set sizes (30 GSEs × N
findings) we're optimising for.

## Why option (1) over option (2: lazy fetch)

UI session sketched two paths — extend the existing payload
(option 1, this doc) vs. add a per-source `GET
/audit/{id}/findings/{target}/context?source=paper` endpoint that
the UI calls on expand (option 2). Picked (1) because:

- One round-trip per finding (already paid). Click on Show more is
  instant.
- No schema migration; pure additive field.
- The natural-bounded sources (sample_names, characteristics) fit
  fine; the unbounded ones (paper, skeleton) cap to ~1500 chars
  which is plenty for a paragraph or two.
- If curators routinely need >1500 chars of paper context, that's
  the signal to graduate to option 2 — and the UI's "Show more"
  expander becomes the natural call site.

## Cross-repo compatibility

Pure additive. Older UIs ignore `context` and render today's
blockquote-only view. Older agents emit reports without
`context`; the UI's "Show more" expander stays hidden when the
field is absent / empty. No `MIN_UI_VERSION` bump.
