# `strip_curation` should key on evidence code, not `inferred` — agent-side ask

Filed from the GUI session 2026-05-08.

## Symptom

Curator runs **Reset experiment** on a freshly-loaded Gemma
dataset. Tags Gemma auto-attached at load time — the `bulk
RNA-seq` assay chip, organism / taxon chips, etc. — disappear
from the post-strip design. They should survive: a fresh-skeleton
state is "post-loading, pre-curation", not "blank slate."

## Root cause

`_is_curator_artifact` in
`gemma_curation_agents/mock_gemma_curation_api/import_from_gemma.py`
(around line 764) reads:

```python
def _is_curator_artifact(t) -> bool:
    if not getattr(t, "inferred", False):
        return True  # direct tags are curator-attached by definition
    code = (getattr(t, "evidence_code", "") or "").strip().upper()
    if code == "IC":
        return True
    src = (getattr(t, "inferred_source", "") or "").strip()
    if src == "FactorValue":
        return True
    return False
```

The first branch is wrong. Gemma's annotations feed reports
`object_class = "ExperimentTag"` for **both** curator-asserted
chips (e.g. a curator typing "Sample Study" into the tag editor)
**and** Gemma's own auto-attached experiment-level tags
(`bulk RNA-seq`, taxon, technology classifier, etc.).
`inferred=False` is set on both. The discriminator that actually
separates them is `evidence_code`:

- `IC` ("Inferred by Curator") = curator asserted; strip on reset.
- Anything else (empty, `IIA`, `IDA`, `IEA`, `TAS`, …) = auto-
  derived; survives reset.

## Ask

Rewrite `_is_curator_artifact` to key on the evidence code:

```python
def _is_curator_artifact(t) -> bool:
    code = (getattr(t, "evidence_code", "") or "").strip().upper()
    if code == "IC":
        return True  # explicit curator assertion
    src = (getattr(t, "inferred_source", "") or "").strip()
    if src == "FactorValue":
        return True  # synth chip, will orphan when its factor is stripped
    return False
```

Behaviour by tag class after the fix:

| Tag class                                  | `inferred` | `evidence_code` | `inferred_source` | Behaviour |
|---|---|---|---|---|
| Curator-asserted experiment tag            | False      | `IC`            | ""                | strip ✓ |
| Gemma auto-attached experiment tag (`bulk RNA-seq`) | False | "" / `IIA` / etc. | "" | **kept** (was being stripped) |
| BioMaterial-derived inferred tag           | True       | `IIA`           | `BioMaterial`     | kept |
| FactorValue-derived synth chip             | True       | "" / —          | `FactorValue`     | strip (orphan) |
| Curator-asserted "inferred" tag (rare)     | True       | `IC`            | (any)             | strip |

## Test the agent side already has

The existing tests in
`tests/test_strip_curation.py` (or wherever the
`_is_curator_artifact` coverage lives) probably assert the old
"direct → strip" rule. Those need to be updated too — direct
tags should be kept unless `IC`-coded.

Add a positive case for the bug above: a synthetic tag with
`inferred=False, evidence_code="", inferred_source=""` and a
plausible label like "bulk RNA-seq" should survive
`strip_curation`.

## UI side (this repo)

No UI change required — UI just renders whatever the post-strip
design contains. Once the fix lands, `bulk RNA-seq` and friends
will stick around through Reset and the experiment banner /
modality detection will keep working.

(If we ever want to *hide* IC-coded tags in the UI separately
from the strip logic, that's a different concern — not what this
ask is about.)

## Cross-repo compatibility

Pure agent-side bug fix. No wire-shape change. UI built before
this fix already renders auto-tags fine; it just sees them
disappear after Reset until the agent ships the fix.
