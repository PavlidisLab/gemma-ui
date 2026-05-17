# Design debate — handoff

Filed 2026-05-12. Companion to `DEBATE_TRANSCRIPT_HANDOFF.md`.

The next calibration package (`calibration-2026-05-12-50gse-v2`, building
now) adds two things on the design side:

1. **Statements are now populated** on every `FactorValueProposal`.
2. **Design debate transcripts** — a new `data/<gse>/design_debate_transcripts.json`
   sidecar that records how each proposed factor was reviewed.

---

## 1. Statements on FactorValueProposal

Previously `factor_values[].statements` was always `[]`.  From this run
forward each FV carries the ontology triples the agent proposed:

```json
{
  "free_text_label": "Sox2 KO",
  "biomaterial_short_names": ["GSM1", "GSM2"],
  "statements": [
    {
      "subject":   { "label": "Sox2",         "uri": "http://identifiers.org/MGI:98364" },
      "predicate": { "label": "has_genotype",  "uri": "..." },
      "object":    { "label": "homozygous negative", "uri": "http://purl.obolibrary.org/obo/PATO_0002035" }
    }
  ]
}
```

These live on `evidence.comparison_proposal.factors[].factor_values[].statements`
in the `AuditReport`.  The UI can surface them when a curator expands an FV
in the proposed-design panel — they are the machine-readable grounding behind
the free-text label.

Low-priority for the first pass: the free-text label is usually readable
on its own.  But showing the subject URI at minimum ("grounded to: Sox2
MGI:98364") would help curators validate the ontology choice.

---

## 2. design_debate_transcripts.json

**Schema** (one object per factor that received at least one challenge round):

```json
{
  "gse": "GSE138272",
  "factor_category": "genotype",
  "factor_category_uri": "http://www.ebi.ac.uk/efo/EFO_0000510",
  "badge": "gold",
  "rounds": [
    {
      "challenge_citation": "§ Single-value properties belong in tags, not factors",
      "challenge_reason": "Only one non-baseline FV — may not represent true variation.",
      "defense_concedes": false,
      "defense_response": "BM columns show two distinct genotype groups across all samples.",
      "verdict_side": "defense",
      "verdict_reason": "Defense cites BM column evidence; factor is correct."
    }
  ]
}
```

Badge values: `gold` (approved or defense won), `silver` (1 contested round,
defense won), `bronze` (2+ rounds), `dropped` (challenger won — factor
removed from proposal), `stuck` (unresolved — rare).

Factors the challenger approved without objection are **omitted** from this
file (nothing to show).

---

## What the UI needs

### Where to put it

On the experiment detail view, alongside the existing proposed-design panel
(the `comparison_proposal.factors` comparison).  Each proposed factor row
should show:

- A **debate badge chip** if the factor has a transcript entry (same
  visual language as `DebateBadgeChip` on tag findings — gold/silver/bronze/
  dropped).  No chip = challenger approved silently.
- A collapsible **"design debate →"** section (same expand pattern as EE
  tag debates) that renders each round:
  `challenge citation + reason → defense response → verdict side + reason`.

### Loading

```
data/<gse>/design_debate_transcripts.json   ← load alongside audit.json
```

Look up a factor by `(factor_category, factor_category_uri)` to find its
transcript entry.  Fall back to label-only match if URI is absent.

### Absent file

If `design_debate_transcripts.json` is missing for a GSE (e.g. run was
built without `--debate-design`), treat all factors as silently approved —
no chip, no expand section.  The UI should not break.

### `dropped` factors

A `dropped` factor was removed from the proposal by the debate — it will
**not** appear in `comparison_proposal.factors` (the pipeline filtered it
before building the package).  So you won't need to render dropped factors
in the design panel; the transcript is informational only if you ever want
to show "factors the agent considered but rejected".  Skip for now.

---

## Package timeline

The v2 package (`calibration-2026-05-12-50gse-v2`) will be ready in
~40 minutes.  It will have:

- `data/<gse>/audit.json` — same as before, `comparison_proposal.factors`
  now has statements populated
- `data/<gse>/design_debate_transcripts.json` — present for any factor
  that was challenged (may be absent for GSEs where all factors were
  silently approved)
- `data/<gse>/debate_transcripts.json` — EE tag debates (same as before)
