# Design comparison panel — handoff

Filed 2026-05-12.

The calibration package now contains agent-proposed experimental designs for
every GSE. Curators need to be able to see them. Currently the UI shows
nothing — there are no tag findings for design disagreements, and the
`comparison_proposal.factors` data in `audit.json` is never rendered.

## Where the data lives

In each `data/<gse>/audit.json`:

```
evidence.comparison_proposal.factors   ← agent's proposed factors
```

In each `data/<gse>/design.json`:

```
experimentalDesign.experimentalFactors  ← Gemma's current factors
```

Both are already loaded for the experiment detail view (audit.json is loaded
for tag findings; design.json is loaded for the existing design display).

## What to build

A **design comparison panel** on the experiment detail view, below the
tag findings. Two columns:

| **Gemma design** | **Agent proposal** |
|---|---|
| from `design.json → experimentalDesign.experimentalFactors` | from `audit.json → evidence.comparison_proposal.factors` |

### Gemma factors (left column)

Each factor from the existing design:
- Category label (e.g. "treatment")
- Factor values: list of value labels

Schema path:
```
experimentalDesign.experimentalFactors[].category.factorType  // "CATEGORICAL" or "CONTINUOUS"
experimentalDesign.experimentalFactors[].factorValues[].value  // FV label
```

### Agent factors (right column)

Each `FactorProposal`:
```json
{
  "category": { "label": "treatment", "uri": "..." },
  "factor_type": "categorical",
  "factor_values": [
    {
      "free_text_label": "reference substance role",
      "biomaterial_short_names": ["GSM1", "GSM2", ...],
      "statements": [
        {
          "subject": { "label": "reference substance role", "uri": "..." },
          "predicate": null,
          "object": null
        }
      ]
    }
  ]
}
```

Render per factor:
- Category label + URI chip
- `factor_type` badge (categorical / continuous)
- Each FV: `free_text_label`, n_samples count, and optionally the first
  statement subject label + URI (the ontology grounding)

### Highlighting disagreements

Colour-code to make mismatches obvious:

- **Matched** (same category label, case-insensitive) → neutral
- **Agent-only** (in proposal but not in Gemma) → yellow / amber
- **Gemma-only** (in Gemma but not in proposal) → grey / muted

Match on `category.label.toLowerCase()` vs
`experimentalFactors[].category.factorType` (or its display label).

### No findings, no dispositions

There are no `AuditFinding` objects for design disagreements — this panel
is read-only, informational only. Curators inspect it and form their own
judgment; no Agree/Disagree buttons needed for this panel in v1.

## Example disagreements in the current package

These GSEs have interesting design-level disagreements worth testing with:

| GSE | Agent proposed | Gemma has |
|---|---|---|
| GSE105453 | age, cognitive performance | treatment, developmental stage |
| GSE279611 | disease model, timepoint, treatment | block, treatment, disease |
| GSE46279 | treatment, timepoint | timepoint, block, genotype, collection of material |
| GSE76734 | polarization state, donor | treatment |

## Schema reference

`FactorProposal` (TypeScript shape):

```typescript
interface FactorProposal {
  category: { label: string; uri: string | null };
  name_in_design: string;
  factor_type: "categorical" | "continuous";
  factor_values: FactorValueProposal[];
}

interface FactorValueProposal {
  free_text_label: string;
  biomaterial_short_names: string[];
  statements: StatementProposal[];
}

interface StatementProposal {
  subject: { label: string; uri: string | null };
  predicate: { label: string; uri: string | null } | null;
  object: { label: string; uri: string | null } | null;
}
```

`comparison_proposal.factors` is `FactorProposal[]`.  It is `[]` for GSEs
where the design proposer skipped (recommend_skip=true or no factors proposed).
In that case hide the agent column or show "(no proposal)".
