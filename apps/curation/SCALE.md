# UI scale plan

Most Gemma experiments are small (≤ 24 samples). A few are large
(100s of samples; the largest production experiments push 1000+).
The current curator UI works fine on the small case; this is the
plan for the large one.

## What's currently in place

- **Sample assignment preview**: per-FV columns scroll vertically
  (`max-h-[28rem] overflow-y-auto`) so a 200-sample experiment
  doesn't blow the page height. A filter input dims non-matches
  rather than hiding them, so the assignment structure stays
  visible while a curator searches.
- **Sample Details panel**: search filter across name,
  characteristic values, and BioAssay short_name / name.
- **Validator banner**: warning lists already truncate at 4
  unassigned biomaterials with a "…" suffix.

## Deferred — implement when a real >100-sample experiment lands

### 1. Multi-select drag in the assignment preview

One-by-one drag-and-drop is fine for ≤30 samples; tedious at scale.
Add per-sample checkboxes plus a small floating "Move N selected
to…" toolbar. Click selects; shift-click range-selects; meta-click
adds to selection. Filter + "select all visible matches" is the
usual escape hatch for bulk reassignment by characteristic.

### 2. Bulk assign by characteristic

Most cohorts split on a single characteristic — `collection of
material: WT` vs `Zbp1 KO`, `disease: AD` vs `disease: control`,
etc. Add a "Auto-assign by characteristic" affordance: pick a
characteristic key and the picker proposes a one-shot assignment
mapping each FV's free-text label to a value of that key. Curator
reviews the diff, accepts.

### 3. Virtualized Sample Details table

The current `<table>` renders all rows. ~200 rows is fine, ~2000 is
not. Switch to `@tanstack/react-virtual` once we hit a real case.
Sticky header + sticky first column; row height fixed for fast
virtualization. Defer until needed — the optimisation has its own
maintenance cost.

### 4. FV-column overflow strategy

Today columns are `repeat(N_FVs, minmax(0, 1fr))` — fine for 2-6
FVs. With more FVs (rare; mostly factorial designs), columns
shrink to unreadability. Add a horizontal scroll wrapper around
the grid + a minimum column width (`minmax(14rem, 1fr)`) when more
than ~8 FVs are present.

### 5. Validator: collapse to count when long

The current "first-4 unassigned" truncation works up to ~50
unassigned. If a curator drops a factor (say) and 200 samples
become orphaned, the banner becomes useless. Collapse to a count
plus a "show all (N)" expander that links the user to the Sample
Details panel filtered to unassigned-in-this-factor.

### 6. Drag-drop performance

200+ draggable list items is fine for React; not fine for some
screen readers or keyboard-only users. Consider a non-drag
fallback path (a small "move to…" menu per row). Same UI helps
mobile, where HTML5 drag-and-drop is poorly supported.

## What I'm explicitly *not* worrying about

- DOM weight at 200 samples — modern browsers handle this trivially.
- Sample Details panel column width with many characteristic keys —
  curators rarely curate experiments with > 10 unique characteristic
  keys; the table's horizontal scroll handles it.
- Network volume — the design payload is ~10kB even on 200-sample
  experiments. No need for streaming or pagination on the read side.
