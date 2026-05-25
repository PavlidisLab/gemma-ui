# Handoff — Review-export bundle: works for polished gold; two small nice-to-haves

**From:** eval-side Claude (gemma-curation-agents-eval session, 2026-05-25)
**Re:** Set export button shipped today (`bundle_kind: gemma_curation_set_export`, `bundle_version: 1`).
**Sample inspected:** `gemma-set-0066-calibration50-half-1-gen4-dirty-6a0f4f8-28-gses-2026-05-25T07-10-00-812Z.json.gz` (28 experiments, ~1.1 MB uncompressed).

## Bottom line

**Works for the actual use case.** Spot-checked GSE302188 (the one experiment in the export the curator had actually committed a proposal for): the `design` block carries 3 factors (block, organism part, age) with realistic FVs, full biomaterial assignments (165 BMs, FVs assigned to 30+ samples each), UBERON URIs on organism-part values, and 5 tags. That's exactly the polished-gold shape downstream scoring needs.

For proposal-mode review (= 0066/0067), the final `design` state is the whole story. No separate disposition log needed.

## Two small nice-to-haves

Both additive (backwards-compatible — old consumers ignore new fields).

### 1. Per-experiment review-status block

The export ships all 28 experiments uniformly, but only 1–2 actually had curator-committed proposals; the rest are untouched Gemma seed shape. Adding one field would let me filter to just the reviewed subset in one pass:

```jsonc
{
  "member_id": 91222,
  "experiment_id": 91222,
  "review_status": {
    "kind": "proposal",                      // or "audit"
    "is_finalized": true,
    "finalized_at": "2026-05-25T06:55:12Z",
    "finalized_by": "amaximo-ubc",
    "review_id": "uuid-here"                 // local-api curation_review row id
  } | null,                                  // null = no review row, i.e. seed shape only
  "design": { ... }
}
```

`null` (or `"untouched"`) on the experiments where the curator didn't commit anything lets the receiver triage cheaply. Without it I'm reduced to "does the design look non-trivial" heuristics to decide which entries are real.

### 2. Set-level rollup

Same shape, set-level summary:

```jsonc
"set": {
  ...,
  "n_finalized": 2,
  "n_untouched": 26
}
```

## Out of scope (skip these)

- ~~Embedding per-finding `findings` + `dispositions` logs~~ — not needed for proposal-mode. If/when audit-mode (= agent reviews existing curation) starts shipping through the same export, revisit.
- ~~Per-experiment proposal-vs-final delta~~ — same reason; final design state suffices for polished-gold scoring.

## What I'm doing on my side

Writing `scripts/score_review_export.py` (eval repo) against bundle v1 shape — pull each experiment's `design` and treat it as polished gold for downstream agent-run scoring. The filter step will hand-code a "looks reviewed" heuristic until §1 lands; then switch to `review_status != null`.

## Contact

eval-side Claude, 2026-05-25. Sample file at `/Users/pzoot/Downloads/gemma-set-0066-...-2026-05-25T07-10-00-812Z.json.gz`; inspection copy at `/tmp/uib_export.json` for this session.
