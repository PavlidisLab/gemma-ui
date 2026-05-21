# Heatmap UI — spec

Owner: gemma-ui browser app · Pairs with Gemma's
`GET /datasets/{id}/heatmap-data` endpoint (Java side, planned).
Builds on the existing widget at
[`src/lib/heatmap/`](./src/lib/heatmap/).

## 1. Scope

The heatmap is a curator/researcher view of an expression dataset:
rows are probes/genes, columns are samples, cells are normalized
expression values. Sample columns carry an annotation strip stack
above the matrix showing how each sample assigns to the experiment's
experimental factors.

This spec covers three additions to the existing v1 widget:

1. **Continuous annotation strips** with an appropriate per-factor
   numeric scale (today only categorical strips render).
2. **Pick a row in the annotation stack** to elevate that factor to
   the *main grouping factor*, which reorders the columns to cluster
   samples by factor level (or by numeric value for continuous).
3. **Expose full per-cell / per-sample annotation detail** on hover
   (lightweight tooltip) and click (pinned side panel) — including the
   statement triples and ontology URIs that the wire payload carries.

Non-goals for this round:
- Row clustering / hierarchical row reordering (existing static order
  stays).
- Sub-cell zoom or per-cell histograms.
- Cross-dataset comparison.

## 2. Wire input

The wire payload is the Gemma `HeatmapDataValueObject` documented in
[`HEATMAP_REWRITE_RECCE.md` §5.2](../../../eclipseworkspace/Gemma/HEATMAP_REWRITE_RECCE.md)
on the Java side. The fields this spec depends on:

```ts
interface HeatmapPayload {
  datasetId: number;
  matrix: {
    values: number[][] | string;   // double[][] or base64-Float32
    encoding: 'json' | 'base64f32';
    rows: number; cols: number;
    quantitationType: { name; isPreferred; isRatio; scale };
  };
  rows: Array<{
    designElementId: number;
    designElementName: string;
    geneIds: number[];
    geneSymbols: string[];
    pvalue?: number;     // diffex-driven requests only
    validated?: boolean; // diffex highlight
  }>;
  columns: Array<{
    bioAssayId: number;
    bioMaterialId: number;
    name: string;
    outlier: boolean;
    factorValueIds: Record<number /*factorId*/, number /*factorValueId*/>;
  }>;
  factors: Factor[];   // mirrors curation-ui src/features/experiment/types.ts
}
```

`Factor` and its nested `FactorValue` / `Statement` / `OntologyTerm`
types are the same shape the curation app already uses
([`apps/curation/src/features/experiment/types.ts`](../curation/src/features/experiment/types.ts)).
Key fields used by the heatmap:

- `Factor.id`, `name`, `category: OntologyTerm`, `description`,
  `type: 'categorical' | 'continuous'`, `baseline_relevance`,
  `factor_values: FactorValue[]`.
- `FactorValue.id`, `free_text_label`, `is_baseline`, `statements[]`,
  `numeric_value` (for continuous).
- `Statement.subject / predicate / object: OntologyTerm` —
  `{ label, uri? }`.

Server-side ordering is deliberately absent: columns come in their
natural BioAssay order, no sort. The client owns all reordering.

## 3. Annotation strips

The widget renders one strip per factor, stacked above the heatmap
matrix in the order returned by the server. Each strip is the full
column width and a fixed pixel height
(`config.annotationStripHeight`, default 10), separated by
`config.annotationStripGap` (default 2).

### 3.1 Categorical strips (existing — refresh)

Today's `CategoricalAnnotation` (see
[`src/lib/heatmap/types.ts`](./src/lib/heatmap/types.ts)) ships its
own per-strip palette as a `Record<string, string>`. That's a sketch
convenience — when reading the new payload, the widget constructs the
palette client-side from `factor.factor_values[]`:

- Stable palette per factor across reloads: hash each FV's
  `(factor.id, fv.id)` to pick a slot in a fixed 12-color qualitative
  ramp (Tailwind 500-shade tableau: blue, emerald, amber, violet,
  rose, teal, indigo, lime, pink, cyan, fuchsia, orange).
- The baseline FV (`is_baseline: true`) always gets slot 0 (neutral
  gray-400) so the eye reads it as "reference".
- Missing FV assignment (sample isn't in any of the factor's FVs)
  renders as `config.nanColor`.

### 3.2 Continuous strips (new)

Factors with `type: 'continuous'` ship per-sample numeric values
either via `factor_values[].numeric_value` (one FV per sample, each
carrying its scalar) OR via a denormalized
`continuousMeasurements: Record<bioAssayId, number>` on the wire (TBD
with the Java side — recce §5.2 leaned to the per-factor map; this
spec assumes that shape).

Rendering:

- **Scale**: per-strip, computed once on payload load.
  - Default: linear, `[min, max]` of the strip's observed values.
  - If `(max / min) > 100` AND `min > 0` → log10 scale. (Common case:
    library size, total counts, age-in-days vs age-in-years.)
  - If the strip's values include zero or are symmetric around zero
    (e.g. fold-change, scaled time-from-event) → diverging linear,
    `[-max(|min|,|max|), +max(|min|,|max|)]`.
- **Palette**: sequential `blackbody` (existing — black→red→orange→
  yellow→white) for non-negative; diverging `ambsky` for signed.
  Keep continuous strips visually distinct from categorical strips
  (which use qualitative palettes) so a curator scanning the stack can
  tell at a glance which strips are "buckets" vs "scales".
- **Missing**: `nanColor`.
- **Tooltip on hover**: every continuous cell shows the numeric value
  with the unit if it's encoded in the factor name (e.g. "age (years):
  86.0") — see §5.

### 3.3 Outlier indicator

`column.outlier === true` draws a thin red border around every cell
in that column (entire vertical stripe). Independent of which factor
is "main grouping". Surfaces curator-set outlier status without
hiding the sample's data.

## 4. Main grouping factor

### 4.1 Affordance

The leftmost gutter of each annotation strip (the area where a strip
label is normally drawn) is clickable. Hovering shows a 1px outline
+ pointer cursor + tooltip "Group columns by *factor.name*". Clicking
sets that factor as the **main grouping factor**.

State lives on the widget (not in the URL — this is an ephemeral
view setting):

```ts
const [mainGroupingFactorId, setMainGroupingFactorId] = useState<number | null>(null);
```

When `null`, the widget falls back to server-side column order.

### 4.2 Reorder rules

When `mainGroupingFactorId` is set:

- **Categorical factor**: sort columns by
  `factorValueIds[mainGroupingFactorId]`. Within an FV, preserve the
  server-side column order as a stable secondary sort. The order of
  FV groups themselves follows the order in `factor.factor_values[]`
  (the baseline FV — `is_baseline: true` — always rendered FIRST,
  then the remaining FVs in `factor_values[]` order).
- **Continuous factor**: sort columns by ascending
  `continuousMeasurements[bioAssayId]`. Samples with no measurement
  go to the right.
- **Gap markers**: insert a 4px column-gap between groups (categorical
  only — continuous gets a smooth ramp with no gaps). The gap is
  rendered as empty space in the matrix AND in the annotation strips,
  so the eye locks groups together visually.
- **Re-clicking the same strip's gutter** clears
  `mainGroupingFactorId` and returns to server-side order.
- **Selected strip's visual treatment**: a 2px solid border in
  `ACCENT_3` (amber-500, `#f59e0b`) on the strip's gutter, so the
  curator can always see which factor is "leading" the layout.

### 4.3 Multiple factors

This v1 supports exactly one main grouping factor. A future v2 may
chain primary + secondary (sort by tissue, then by treatment), but
v1's affordance + state shape leave room for a `groupingFactorIds:
number[]` extension without breaking the wire contract.

## 5. Annotation detail on hover & click

Three levels of detail, each progressively richer:

### 5.1 Hover (no click) — lightweight tooltip

Anchored to the cursor, follows it with a 4px offset. Plain text,
two-column layout:

```
PROBE        ILMN_2345678  (BRCA1)
SAMPLE       GSM1234567  ("liver, donor 4")
VALUE        2.34         (log2 ratio)
P-VALUE      0.0021       (diffex-driven only)
```

If the cursor is over an annotation strip (not a matrix cell), the
tooltip shows the factor + the sample's value:

```
FACTOR       tissue (OrganismPart)
SAMPLE       GSM1234567
VALUE        liver  (free-text: "liver, donor 4")
            ↳ subject: UBERON:0002107 (liver)
            ↳ baseline FV
```

For continuous strip hover:

```
FACTOR       age  (TimeSinceBirth, continuous)
SAMPLE       GSM1234567
VALUE        86 years
```

Tooltip is dismissed by `mouseleave` from the widget. It does NOT
follow keyboard focus.

### 5.2 Click on a matrix cell or strip cell — pinned side panel

Opens a side panel docked to the right of the heatmap, ~360px wide,
sticky while the curator scrolls the matrix. Closes via × button,
`Esc`, or click outside.

The panel content depends on what was clicked:

**Matrix cell click** shows three sections:

1. **Probe / gene** — designElementName, gene symbol list (each linked
   to `/gene/{geneId}`), the QT name + scale + isRatio + isPreferred
   flag, p-value + `validated` chip if present.
2. **Sample** — bioAssayId, bioMaterialId, name, outlier badge. Plus
   the FULL factor-assignment table:
   - One row per factor in `payload.factors[]`.
   - Columns: factor name (+ ontology link via
     `factor.category.uri`), assigned FV's `free_text_label`, the
     statement summary if more than one statement
     (`subject / predicate / object`), and an "is baseline" chip
     if applicable.
   - For continuous factors, show the numeric value with the unit.
3. **Value** — the cell value, the row's row-standardized z-score (if
   row-standardize is on), and a sparkline of the same probe's values
   across all samples (small inline plot, shows where this sample sits
   in the distribution).

**Strip cell click** opens the same panel scoped to that factor only:

- Factor metadata (name, category w/ ontology URI, description,
  type, baseline_relevance, baseline_relevance_reason).
- The full list of `factor_values[]` for that factor with sample
  counts per FV; the clicked FV is highlighted.
- The clicked sample's statement list (subject/predicate/object
  triples, each ontology term linking to its URI).

### 5.3 Statement triple rendering

Statements in the panel render as:

```
[subject.label] → [predicate.label] → [object.label]
   ↳ UBERON:0002107      RO:0002576           CL:0000182
```

Each `OntologyTerm.label` is a link to `term.uri` (open in new tab).
A statement with only `subject` (the typical "wild type genotype"
shape) just renders the subject. Per-statement `category` (when
diverging from the parent factor's category) shows as a small label
above the triple.

### 5.4 Continuous-factor detail

When the side panel shows a sample's continuous-factor assignment:

- Numeric value + unit (parsed from factor name when present).
- A mini-histogram of all samples' values for that factor with the
  current sample marked.
- The factor's `baseline_relevance`: continuous factors are normally
  `not_applicable` per the curation-agents schema; show this as a
  "no baseline applies" muted note rather than a warning.

## 6. Implementation notes

- The widget stays canvas-based for matrix + strips (existing
  `render.ts`). The tooltip + side panel are React components
  composed alongside.
- Hit-testing for strip clicks uses the existing
  `RenderResult.cellAt(x, y)` extended to recognize strip Y-bands
  (the renderer already knows where each strip lives via
  `matrix.y` offset).
- The reorder result must be a stable, pure derivation from
  `(payload, mainGroupingFactorId, rowConfig)` — no in-place mutation
  of the input payload. The widget should compute a
  `columnOrder: number[]` array and index through it when rendering.
- Continuous strip scale + palette construction goes in a new
  `src/lib/heatmap/strips/continuous.ts`; categorical-strip palette
  hashing in `src/lib/heatmap/strips/categorical.ts`. Both are pure
  functions of `Factor + column data`.
- Side panel reuses curation-app's `OntologyTermPicker` /
  ontology-link rendering helpers if available
  ([`apps/curation/src/features/design/`](../curation/src/features/design/));
  otherwise factor out a small `<OntologyTermLink>` into a shared
  `lib/ontology/` if both apps need it.

## 7. Open questions

1. **Continuous-factor wire shape** — per-factor
   `measurements: Record<bioAssayId, number>` (recce lean) or
   per-FactorValue `numeric_value` (curation-ui current type)? The
   spec assumes the per-factor map; confirm with the Java endpoint
   author when Session 2 lands.
2. **Diffex highlight** — `rows[].validated: boolean` for the diffex
   row chip is in the wire spec; this UI spec uses it but the visual
   treatment (highlighted row label? row outline? icon?) is TBD with
   curators.
3. **Row clustering / reorder** — explicitly out-of-scope here. If a
   future row-grouping factor concept lands (e.g. cluster rows by
   pathway), the affordance probably lives in a separate row-strip
   stack on the LEFT side.
4. **URL persistence** — should the main grouping factor + side-panel
   pinned sample be reflected in the URL so curators can share a
   heatmap link? Probably yes for the grouping factor (it's a layout
   knob), probably no for the pinned sample (ephemeral).
5. **Mobile / touch** — currently desktop-first. Strip-click
   affordance is fine on touch (taps work), but the hover tooltip
   isn't reachable. Defer touch refinement to a later phase.

## 8. Out-of-band touches

- The browser app's existing `HeatmapDemo` and `HomeHeatmap` consume
  synthetic / placeholder data. Once the Java endpoint lands, swap
  one of those to render a real EE's heatmap to validate the
  end-to-end shape.
- The curation app does not currently embed the heatmap; if/when it
  does (e.g. on the "review proposed design" screen), the same widget
  + payload-adapter should slot in unchanged.
