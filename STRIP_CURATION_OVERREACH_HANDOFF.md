# Strip-curation over-strips publications + external_source

**Status:** open · filed for my brother · 2026-05-08
**UI commit at filing:** see `git log -1`
**Sibling docs:** [`AUDIT_FEATURE.md`](./AUDIT_FEATURE.md) ·
[`EE_TAG_EVIDENCE_QUALITY_HANDOFF.md`](./EE_TAG_EVIDENCE_QUALITY_HANDOFF.md)

## Problem

The "import with `strip_curation: true`" path used by the audit /
calibration flow is over-stripping. On a freshly stripped experiment
the design payload comes back with:

- `publications: []` — even when real Gemma has a linked PMID
- `external_source: null` — even when the GSE accession is known

Repro (stripped GSE27082, agent_id=14370 in Paul's mock as of
2026-05-08):

```
$ curl -s -H "Authorization: Bearer dev-token-123" \
    http://localhost:8080/rest/v2/datasets/14370/design \
    | jq '{publications, external_source, short_name}'
{
  "short_name": "GSE27082",
  "publications": [],
  "external_source": null
}
```

Real Gemma for this experiment has PMID `28747667` linked and the
GSE accession `GSE27082` recorded as the external source. Both
fields survived the original Gemma import; the strip pass is wiping
them.

## Why this matters (Paul's framing)

Two failures stack:

1. **Contract drift.** The "Reset experiment" tooltip in the UI
   (`App.tsx:779`) advertises *"clears factors and IC tags.
   Biomaterials and metadata stay."* Publications and the external
   source are squarely on the *metadata* side of that line —
   curators expect them to survive the strip. They don't.

2. **Evaluation contamination.** Paper-finding is a *separate*
   upstream task (`find_publication` agent). The audit's job is to
   evaluate the **proposer's term-selection** given a paper — not
   to re-test paper retrieval at the same time. Stripping the PMID
   forces the proposer back through `find_publication` on every
   audit run; if that agent picks the wrong paper, every downstream
   term-selection judgment inherits the failure. We can't tell
   whether a bad EE tag came from bad paper retrieval or bad
   term selection.

Same logic for the GEO accession — it's the input identifier, not
something the proposer is supposed to derive.

## Asked fix

In the strip-curation pass: keep `publications` and `external_source`
intact. Strip only:

- factors / factor_values / sample assignments
- statement-level IC (curation-assigned) tags

Anything else that the original Gemma import populated should
round-trip unchanged. The simplest framing: strip-curation should
restore the experiment to its *post-import, pre-curation* state —
not its *pre-import* state.

## UI consequences (none required)

UI renders the wire faithfully — `OverviewPanel` shows the
"PROPOSED PAPER · source: geo_linked_fulltext" card and the
"no external accession recorded — auto-search needs a GEO accession"
message both because the underlying fields are empty. Once the
agent stops stripping them, the existing UI surfaces them correctly
(publication chips + GEO link in the banner). No UI work blocked
on this.

## Open question for my brother

Does the strip pass live in `import_into_mock` itself or in a
post-import scrub? Easiest to fix in whichever owns the
`strip_curation` branch. If there's a deliberate reason
publications were being cleared (e.g., to test the
`find_publication` flow end-to-end), let's split it into a separate
flag — `strip_curation` shouldn't imply `strip_metadata`.
