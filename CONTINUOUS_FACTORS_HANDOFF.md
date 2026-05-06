# Continuous-factor proposer support — UI implications

Handoff from the agents-repo session (2026-05-05) that added
explicit `factor_type` plumbing on the proposer side. The UI is
already partially aware of continuous factors (`FactorType` literal,
`ContinuousFactorView`, `<option value="continuous">` in
`FactorList.tsx`); this doc enumerates what the agents repo now
emits so you can wire the rest.

## UI implementation status (2026-05-05)

All four asks from this handoff landed in one pass:

- **TS mirrors** (`src/api/types.ts`) —
  `FactorProposal.factor_type` and `FactorValueProposal.numeric_value`
  added; both optional/nullable so older proposals (no populator) still
  parse.
- **Design-side type extension** (`src/features/experiment/types.ts`) —
  `FactorValue.numeric_value?: number | null` added so the canonical
  scalar survives proposal → design conversion. Validator already
  honoured `factor.type === "continuous"` (no baseline / no per-sample
  partition) — just needed the upstream conversion to set it.
- **`applyProposalToDesign`** (`src/features/design/mutations.ts`) — was
  hardcoding `type: "categorical"` for every accepted proposal; now
  reads `p.factor_type` and threads `numeric_value` per FV. This is
  what makes CommitBar stop demanding a baseline on accepted continuous
  proposals.
- **`ContinuousFactorView`** (`src/features/design/`) — prefers
  `numeric_value` over parsing `free_text_label` (so "86 years"-style
  human renderings still plot). Histogram bar tooltip surfaces the
  human label alongside the count when available.
- **Decisions tab + Triage strip** (`src/features/proposal/ProposalCardV2.tsx`) —
  - `S5_continuous_populator` renders as "Continuous factor populated?"
    with Yes / No (handles `NOT POPULATED:` prefix).
  - `S8_dea_usability` renders as "Suitable for DEA?" with Yes / No,
    AND hoists into the Triage strip as a "Not DEA-usable" warning chip
    when `not_usable` (informational; never blocks acceptance).
  - Decisions-tab group labels: "Continuous-factor population" (S5),
    "DEA usability" (S8).

Verified `npx tsc --noEmit` clean and 65/65 vitest tests pass. Not
browser-tested — needs a continuous-factor proposal in the mock to
exercise (run the proposer against an experiment with a numeric
characteristic and no within-level replicates).

Open questions from §"Open questions / not-yet-done" remain
agents-side (audit-pathway scan, prominent no-replication chip).

## Schema changes (`gemma_curation_agents/agents/curation_proposer/schemas.py`)

Two additive fields on the proposal payload:

```python
class FactorProposal(_Strict):
    category: OntologyTerm
    name_in_design: str = ""
    factor_type: str = "categorical"   # NEW: "categorical" | "continuous"
    factor_values: list[FactorValueProposal]

class FactorValueProposal(_Strict):
    free_text_label: str = ""
    is_baseline: bool = False
    statements: list[StatementProposal]
    biomaterial_short_names: list[str]
    biomaterial_assignment_meta: list[BiomaterialAssignmentMeta]
    numeric_value: float | None = None  # NEW: per-FV scalar for continuous
```

`factor_type` is the same string set the UI's `FactorType` already
uses (`"categorical"` | `"continuous"`); naming lines up so reads
should be a one-line type-import update.

`numeric_value` is the canonical scalar reading for a continuous FV
(mirrors Gemma's `FactorValue.measurement.value`). Categorical FVs
leave it `null`. The proposal-side populator (deterministic, not the
LLM) fills this from the matching biomaterial characteristic, so
every continuous FV in a proposal will have it set on arrival.

## Behavioural shape on the wire

For a continuous factor the proposer now emits **one FV per distinct
numeric value**, with `numeric_value` set, `biomaterial_short_names`
populated, and `is_baseline=false` on every FV (continuous factors
have no baseline by convention — the baseline-picker subtask returns
n/a). `free_text_label` carries a human rendering ("86 years", "0.5
mg/ml") taken from the source characteristic — useful to display
alongside the numeric value on the histogram if you want.

The `proposal.evidence.subtask_decisions` list will include a new
`subtask = "S5_continuous_populator"` entry per continuous factor,
verdict like `"continuous factor 'age'; populated from characteristic
'age': 35 distinct value(s) across 41 sample(s)"`. Render this on
the Decisions tab so curators see what the populator did.

## New SubtaskDecision the Decisions tab should render

* `S5_continuous_populator` — per continuous factor: which BM
  characteristic was matched, how many distinct values, how many
  samples covered. `confidence` is unset; treat verdict as the
  display string. Negative case (no matching characteristic) prefixes
  the verdict with `"NOT POPULATED:"`.
* `S8_dea_usability` — experiment-level. `confidence = "high"` when
  any factor satisfies its DEA requirement (categorical with ≥1 FV
  with ≥2 samples, or continuous with ≥3 distinct values);
  `confidence = "low"` otherwise. Verdict starts with `"usable:"` or
  `"not_usable:"` and names the supporting / unsupporting factors.
  Informational, not a skip — gold curates non-DEA-able experiments
  routinely (Sample Study tags). The UI may want to surface a
  one-line warning chip when `not_usable`, but should not block
  acceptance.

## Validators that change behaviour for continuous factors

These are agents-side and don't directly affect the UI, but matter
for what UI consumers see:

* **Term validator (S10)** skips per-FV statement validation for
  continuous factors. Numeric FV subjects ("86 years") are free-text
  by design and no longer surface as `invalid_terms` findings.
* **Baseline picker (S6)** returns "no baseline applicable" for
  continuous factors and unflags any `is_baseline=true` the LLM may
  have set. CommitBar should not warn "missing baseline" on
  continuous factors.

## Experiment-tag note (no UI change required, just FYI)

When a proposed design is flagged `S8_dea_usability: not_usable`, the
existing TGEMO-tag vocabulary (`Sample Study` TGEMO:00020,
`Cell Line Sample Study` TGEMO:00033) names the same condition at
the experiment-tag level. There's no current TGEMO term for "time-
course without replicates" — if curators want to tag those, that's a
TGEMO-vocabulary question rather than a UI one.

## What the proposer prompt was changed to do

Three rule additions in `prompts/design_proposer.md` worth being aware
of so curator-facing copy stays consistent:

* **Replication rule** — numeric-valued factor (timepoint, age, dose,
  duration) with no within-level replicates → continuous; with
  replicates → categorical. Documented also in the canonical
  `docs/curation_rules/04_efc_catalog.md`.
* **In-vivo / in-vitro split for developmental stage** — UBERON
  stages are organismal; in-vitro time-courses (hESC differentiation,
  organoid maturation) use Timepoint, not Developmental stage.
* **Continuous-factor placeholder pattern** — proposer emits ONE
  placeholder FV per continuous factor; per-sample numeric values are
  populated downstream (deterministic, no LLM enumeration of N
  values). UI should not be surprised by a proposal with a single
  placeholder FV in transit (between LLM emit and populator) — but in
  practice, by the time the proposal reaches the UI, the populator
  has already expanded it.

## TMTOWTDI alternates layer (eval-side only)

Not a UI concern — the alternates file (`alternates/<accession>.yaml`)
lives in the eval pipeline and is consumed by `compare_structural`
to recognise multiple-valid-curations cases. UI never sees it. Noted
here only so you don't get confused when you see references to
`alternate_cross_type` / `alternate_partition` / `alternate_split`
matches in eval JSONL output.

## Cross-repo compatibility

Schema additions are backwards compatible (both new fields default-
valued). UI built before this change still reads proposals fine —
the new fields are just unused. Bumping `MIN_UI_VERSION` is **not**
required for this change set, but if you want to gate on the UI
actually displaying continuous factors properly, that's a separate
versioning decision.

## Open questions / not-yet-done

* No pipeline-level "this design has no within-level replication"
  warning chip in the UI (S8 just emits a SubtaskDecision; UI may
  want a more prominent surface).
* Composition alternates (gold = 1 composite, agent = N components)
  are eval-only and have no UI surface.
* The audit pathway hasn't been updated to scan existing curated
  experiments for replication-rule violations (categorical-with-
  singletons in {timepoint, age, dose, duration}). When that lands,
  the audit-disposition UI should treat the new finding type the
  same way it handles existing type-mismatch findings.
