# EE-tag evidence selection: design-context, not background

Filed 2026-05-08 from a calibration-audit session.

## Symptom

The proposer's evidence for "add `disease: hiv-associated
neurocognitive disorder`" is a paper sentence about disease
biology:

> "The neurodegenerative process in HIV encephalitis (HIVE) is
> associated with extensive damage to the dendritic and synaptic
> structure that often leads to cognitive impairment."

That tells the curator nothing about whether **this experiment**
studies HIVE / HAND. It's background introduction text — the kind
of sentence every paper on the topic would have whether or not the
samples in this dataset are from HAND patients.

The right evidence would be something like:

> "We profiled gene expression in frontal-cortex tissue from 14
> HIV-positive donors diagnosed with HIV-associated neurocognitive
> disorder (HAND), alongside 14 HIV-negative controls."

…or per-sample context like:

> "GSM310111: 'HAND patient, frontal cortex, post-mortem'"

The discriminator: **evidence should describe what samples
are**, not what the term means.

Generalises across all EE-tag proposer paths (disease, organism
part, cell type, treatment, …). Same failure mode: grab a
sentence that mentions the term, regardless of whether the
sentence is talking about the experimental cohort.

## What makes evidence "good" for EE-tagging

A sentence supports an EE tag iff it answers **one** of:

1. *Who are the samples?* — patient/animal cohort description, n,
   inclusion criteria.
   ("Post-mortem frontal-cortex tissue from 14 HAND patients…")
2. *What was profiled?* — the experimental design statement
   naming the condition / tissue / cell-type alongside the
   profiling step.
   ("We performed RNA-seq on liver biopsies from HCC patients
   undergoing partial hepatectomy.")
3. *What's the per-sample annotation?* — GEO `characteristics_ch1`
   key:value or sample title carrying the term verbatim.
   ("GSM310111: characteristics: 'disease state: HAND'")

Sentences that *mention the term but describe its biology /
mechanism / general etiology* are background, not evidence:

- "X is a leading cause of Y in adults aged …"
- "The pathophysiology of X involves …"
- "X has been linked to dysregulation of …"
- "Several studies have implicated X in …"

These are red flags. They're the kind of sentences every paper
about X has whether the dataset's samples are X-affected or not.

## Suggested prompt tuning for the EE-tag proposer

Add a Style / Evidence section to the tag-proposer prompt with:

```
EVIDENCE SELECTION FOR EE-TAG PROPOSALS

A proposed EE tag must be grounded in evidence that the *samples
in THIS experiment* have the property the tag asserts. Background
information about the disease / process / pathway in general
does NOT count, even when the term appears in it.

Prefer evidence sentences that answer ONE of:
  - "What are the samples?" — cohort description, n, inclusion
    criteria, sample types.
  - "What was profiled?" — the experimental-design statement
    that names the condition alongside the profiling action.
  - "Per-sample annotation" — GEO characteristics_ch1 or sample
    title carrying the term.

Reject sentences that describe the term's biology, mechanism, or
general etiology — these are introduction / background and are
not evidence the experimental cohort has the property:
  ✗ "X is a leading cause of Y…"
  ✗ "The pathophysiology of X involves…"
  ✗ "Several studies have implicated X in…"
  ✗ "X is associated with damage to…"

When the only candidate evidence is background prose, prefer
either:
  - Sample-level evidence from GEO characteristics or
    sample_names (high specificity).
  - Or DECLINE to propose the tag and emit a note that the
    evidence is background-only — a calibration_match miss is
    less harmful than a confident extra anchored on "X is a
    thing".

Sources, in priority order:
  1. ``characteristic`` (GEO characteristics_ch1)
  2. ``geo_metadata`` (source_name_ch1, sample title)
  3. ``sample_names`` (a list of titles where the cohort
     descriptor appears verbatim)
  4. ``paper`` Methods / Materials section
  5. ``paper`` Results section (study-design statements only —
     not Discussion / Background)
  6. ``paper`` Abstract (only when it carries the cohort
     description, e.g. "We profiled X tissue from N patients
     with Y")

NEVER use:
  - Paper Introduction / Background sections as primary
    evidence for an EE tag. They describe the term, not the
    cohort.
  - Discussion section's interpretive prose.

The audit panel renders ``quote`` as the curator's preview. A
curator who reads the quote should immediately be able to tell
whether the experiment's samples have the property — not just
that the term appears in the paper.
```

## Section-aware extraction (orthogonal infrastructure)

The above only works if the agent knows which section of the
paper a sentence comes from. Today's `paper_excerpt` is a 16K
contiguous slice; sentences are pulled by string match. Two
incremental upgrades:

1. **Section labels** in the biolit fetch — pass section
   metadata through the proposer so each candidate sentence
   carries `paper_section: "Introduction" | "Methods" | …`.
2. **Pre-filter** to Methods / Materials / Sample-Description
   sections before the LLM sees the candidate set. Drops the
   easy false positives without prompt-tuning.

Brother's `biolit + defender: prioritise Methods/Materials
sections` commit (3a5ad7b) already moves in this direction for
the defender — propagating the same prioritisation to the
EE-tag *proposer* would close the loop.

## Defender-style verification pass

Today's calibration_agent_extra finding fires when the agent
proposed something gold doesn't have. A cheap pre-emit check
agent-side:

> Before emitting a calibration_agent_extra, ask the defender:
> "Does the evidence quote describe what the experimental
> samples are? Or only what the term means in general?" If the
> latter, demote to a lower-confidence finding or drop.

This is a small per-finding LLM call but the calibration-set sizes
(30 GSEs × ~20 findings) make the cost trivial relative to the
curator's time spent dismissing background-only false positives.

## Why this matters

- **Calibration eval signal noise.** Background-only evidence
  pollutes `curator_wrong` dismissals: curators dismiss because
  the evidence is bad even when the agent's *term pick* might
  have been defensible from elsewhere. The eval can't tell the
  two failure modes apart.
- **Curator trust.** A handful of "X is a thing" sentences in
  the supporting-evidence panel teaches curators to ignore the
  panel — at which point all the per-finding evidence work
  upstream becomes wasted effort.
- **Generalises across EE tags.** The same heuristic — "evidence
  must describe the cohort, not the term" — applies to disease,
  organism part, cell type, treatment, strain, … All EE-tag
  judges share the failure mode.

## Cross-repo compatibility

Pure prompt + retrieval tuning. No schema impact. UI side
unchanged.
