# Per-factor baseline relevance — proposer enhancement

Filed from the GUI session 2026-05-06. Follow-up to the cell-line
no-baseline fix in `7e36060`.

## Where we are now

The UI's validator (`src/features/experiment/types.ts`
`factorRequiresBaseline`) decides whether a factor needs a baseline
FV from a static category-name list:

```ts
const NO_BASELINE_CATEGORIES = new Set([
  "block",
  "batch",
  "organism part",
  "cell type",
  "cell line",
  "cell_line",
]);
```

That covers the structural cases — panels of biologically-arbitrary
references where any baseline pick is meaningless.

## What the static list misses

Whether a baseline is relevant is **per-experiment**, not just
per-category. The proposer already knows this on a per-factor
basis but the signal isn't on the wire.

Concrete case Paul hit on 2026-05-06: cell-line factor on an
experiment the proposer flagged with
`S1_subset_verdict: subset_by_cell_line`. Each cell line gets its
own DEA contrast set; a "baseline cell line" within the factor is
structurally moot. The same factor on a *different* experiment
(say, two cell lines paired against a treatment, with the treatment
being the contrast) might genuinely have a natural reference.

Symmetric case for the other direction: a `treatment` factor on
an experiment subset by treatment (rare but real for dose-response
panels) — the treatment factor itself has no baseline because the
analysis runs separately within each treatment level.

## Ask

Add a per-factor "baseline relevance" hint to `FactorProposal`:

```python
# proposer/schemas.py
class FactorProposal(_Strict):
    ...
    baseline_relevance: Literal["required", "not_applicable", "uncertain"] = "required"
    baseline_relevance_reason: str = ""
```

Suggested logic in the proposer / S6 baseline picker:

| When | `baseline_relevance` | Reason string |
|---|---|---|
| Factor is the `S1_subset_verdict` axis | `not_applicable` | `"subset axis — analysis runs within each level"` |
| Category in {block, batch, cell type, organism part, cell line, cell_line} | `not_applicable` | `"no natural reference for category '<X>'"` |
| Factor type is `continuous` | `not_applicable` | `"continuous factors carry per-sample measurements"` |
| Factor has only one FV | `not_applicable` | `"single-level — no contrast"` |
| S6 baseline picker confidently picked a baseline | `required` | (verdict text) |
| Otherwise | `uncertain` | `"baseline picker did not select a clear reference"` |

Default to `"required"` for backwards compat (older agents) so the
UI's existing static-list short-circuit still works.

## UI follow-up (this repo)

When `baseline_relevance` lands:

- `factorRequiresBaseline` reads the field first; falls back to the
  static category list for older proposals or non-proposer-sourced
  factors (curator-added).
- For `not_applicable`: no warning bullet at all (matches today's
  behaviour for the static list).
- For `uncertain`: a **tiny flag** — small italic chip on the FV
  panel, e.g. "no baseline — soft" or just a `?` glyph next to
  the factor name. Hover shows `baseline_relevance_reason`.
  Important: not the loud amber banner, just a subtle nudge so the
  curator notices in case they reject the subsetting (or the
  uncertain pick) and *do* end up wanting a baseline.
- For `required`: today's behaviour (warning + block on missing /
  duplicate baseline).

## Why this matters beyond the immediate symptom

- **Per-experiment correctness.** Static lists work for the obvious
  cases but miss the design-conditional ones. A treatment factor
  shouldn't always demand a baseline; a cell-line factor sometimes
  should. The proposer is the right place to decide because it
  has the full design context.
- **Curator trust.** Loud baseline warnings on factors that don't
  need a baseline trains curators to ignore the warning entirely,
  which then masks the real cases.
- **Eval inputs.** "Did the curator override the baseline gate"
  is a useful signal for prompt-tuning, but only if the gate fires
  in the right places.
- **Subset-DEA loop.** The proposer's S1_subset_verdict is already
  on the wire; surfacing a per-factor consequence of it is the
  obvious next step.

## Cross-repo compatibility

Pure additive on `FactorProposal` — older UIs ignore the field and
fall back to the static category check (today's behaviour). New
UIs paired with new agents get the per-experiment refinement.

No `MIN_UI_VERSION` bump required; pair this with a UI release
that adds the tiny-flag rendering to get the full benefit.
